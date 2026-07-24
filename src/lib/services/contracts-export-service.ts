import ExcelJS from "exceljs";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { ContractStatus, InstallmentStatus } from "@/types/database";

export class ContractsExportServiceError extends Error {}

export interface ExportInstallment {
  installmentNumber: number;
  dueDate: string;
  installmentAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InstallmentStatus;
}

export interface ExportContract {
  id: number;
  contractCode: string;
  startDate: string;
  clientName: string;
  clientCode: string;
  productName: string;
  productDescription: string | null;
  purchasePrice: number;
  totalPrice: number;
  profitPercent: number;
  remainingBalance: number;
  installments: ExportInstallment[];
}

/**
 * Fetches everything the contracts Excel export needs in two rounds of
 * queries (contracts+client, then all their installments) rather than
 * one query per contract. Both are paginated via fetchAllRows — a bare
 * .select() is silently capped at whatever the Supabase project's
 * max_rows is set to, which would mean a "print all contracts" export
 * quietly leaves contracts out past that row count with no error. The
 * installment IDs are also chunked for the second query so a very
 * large contract set doesn't build one oversized `.in()` filter.
 */
export async function getContractsForExport(
  status?: ContractStatus
): Promise<ExportContract[]> {
  const supabase = await createClient();

  const contracts = await fetchAllRows<{
    id: number;
    contract_code: string;
    start_date: string;
    purchase_price: number;
    total_price: number;
    profit_percent: number;
    remaining_balance: number;
    product_name: string;
    product_description: string | null;
    client: { name: string; client_code: string };
  }>((from, to) => {
    let query = supabase
      .from("contracts")
      .select(
        "id, contract_code, start_date, purchase_price, total_price, profit_percent, remaining_balance, product_name, product_description, client:clients(name, client_code)"
      )
      .order("start_date", { ascending: true });

    if (status) {
      query = query.eq("status", status);
    }

    return query.range(from, to);
  }).catch((err) => {
    throw new ContractsExportServiceError(
      `Failed to load contracts for export: ${err.message}`
    );
  });

  if (contracts.length === 0) return [];

  const contractIds = contracts.map((c) => c.id);

  // Chunk the IN(...) filter itself, independent of row-limit paging,
  // so a very large contract set doesn't produce one oversized filter.
  const CHUNK_SIZE = 500;
  const idChunks: number[][] = [];
  for (let i = 0; i < contractIds.length; i += CHUNK_SIZE) {
    idChunks.push(contractIds.slice(i, i + CHUNK_SIZE));
  }

  const installments: {
    contract_id: number;
    installment_number: number;
    due_date: string;
    installment_amount: number;
    paid_amount: number;
    remaining_amount: number;
    status: InstallmentStatus;
  }[] = [];

  try {
    for (const chunk of idChunks) {
      const chunkRows = await fetchAllRows<{
        contract_id: number;
        installment_number: number;
        due_date: string;
        installment_amount: number;
        paid_amount: number;
        remaining_amount: number;
        status: InstallmentStatus;
      }>((from, to) =>
        supabase
          .from("installments")
          .select(
            "contract_id, installment_number, due_date, installment_amount, paid_amount, remaining_amount, status"
          )
          .in("contract_id", chunk)
          .order("installment_number", { ascending: true })
          .range(from, to)
      );
      installments.push(...chunkRows);
    }
  } catch (err) {
    throw new ContractsExportServiceError(
      `Failed to load installments for export: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }

  const installmentsByContract = new Map<number, ExportInstallment[]>();
  for (const inst of installments) {
    const list = installmentsByContract.get(inst.contract_id) ?? [];
    list.push({
      installmentNumber: inst.installment_number,
      dueDate: inst.due_date,
      installmentAmount: inst.installment_amount,
      paidAmount: inst.paid_amount,
      remainingAmount: inst.remaining_amount,
      status: inst.status,
    });
    installmentsByContract.set(inst.contract_id, list);
  }

  return contracts.map((c) => ({
    id: c.id,
    contractCode: c.contract_code,
    startDate: c.start_date,
    clientName: c.client.name,
    clientCode: c.client.client_code,
    productName: c.product_name,
    productDescription: c.product_description,
    purchasePrice: c.purchase_price,
    totalPrice: c.total_price,
    profitPercent: c.profit_percent,
    remainingBalance: c.remaining_balance,
    installments: installmentsByContract.get(c.id) ?? [],
  }));
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF133864" },
};
const PAID_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF57BB6E" },
};
const PARTIAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFB84D" },
};
const UNPAID_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8544B" },
};
const PAID_FONT_COLOR = "FF003D14";
const PARTIAL_FONT_COLOR = "FF5C3A00";
const UNPAID_FONT_COLOR = "FFFFFFFF";
const THIN_BORDER: Partial<ExcelJS.Border> = { style: "thin", color: { argb: "FFD9D9D9" } };

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Builds the "one complete row per contract" print/export workbook.
 * Installment columns are dynamic — as many as the contract with the
 * most installments in this export needs; contracts with fewer just
 * have blank trailing cells. Each installment cell displays the due
 * month inline via a per-cell custom number format, and is colored one
 * of three ways: green + full amount when PAID, amber + the remaining
 * (still-owed) amount when partially paid, or red + full amount when
 * nothing has been paid yet (PENDING/OVERDUE).
 */
export function buildContractsExportWorkbook(
  contracts: ExportContract[],
  filterLabel: string
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Sitara Traders";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Contracts", {
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  const maxInstallments = contracts.reduce(
    (max, c) => Math.max(max, c.installments.length),
    0
  );

  const fixedHeaders = [
    "Contract ID",
    "Start Date",
    "Customer Name",
    "Customer ID",
    "Item",
    "Purchase Price",
    "Sale Price",
    "Profit %",
  ];
  const installmentHeaders = Array.from(
    { length: maxInstallments },
    (_, i) => `Inst ${i + 1}`
  );
  const headers = [...fixedHeaders, ...installmentHeaders, "Subtotal", "Remaining Balance"];
  const totalCols = headers.length;
  const firstInstallmentCol = fixedHeaders.length + 1;
  const subtotalCol = firstInstallmentCol + maxInstallments;
  const remainingBalanceCol = subtotalCol + 1;

  // Title row
  sheet.mergeCells(1, 1, 1, totalCols);
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = `Sitara Traders — Contracts Export (${filterLabel}) — Generated ${new Date().toLocaleString(
    "en-PK"
  )}`;
  titleCell.font = { bold: true, size: 13 };
  sheet.getRow(1).height = 22;

  // Legend row
  const legendRow = sheet.getRow(2);
  legendRow.getCell(1).value = "Paid";
  legendRow.getCell(1).fill = PAID_FILL;
  legendRow.getCell(1).font = { color: { argb: PAID_FONT_COLOR }, bold: true };
  legendRow.getCell(2).value = "Partially Paid";
  legendRow.getCell(2).fill = PARTIAL_FILL;
  legendRow.getCell(2).font = { color: { argb: PARTIAL_FONT_COLOR }, bold: true };
  legendRow.getCell(3).value = "Unpaid / Overdue";
  legendRow.getCell(3).fill = UNPAID_FILL;
  legendRow.getCell(3).font = { color: { argb: UNPAID_FONT_COLOR }, bold: true };

  // Header row (row 4)
  const headerRowNumber = 4;
  const headerRow = sheet.getRow(headerRowNumber);
  headers.forEach((label, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = label;
    cell.fill = HEADER_FILL;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
  });
  headerRow.height = 20;
  sheet.views = [{ state: "frozen", ySplit: headerRowNumber, xSplit: 4 }];
  sheet.pageSetup.printTitlesRow = `${headerRowNumber}:${headerRowNumber}`;

  let rowNum = headerRowNumber + 1;
  for (const contract of contracts) {
    const row = sheet.getRow(rowNum);

    row.getCell(1).value = contract.contractCode;
    row.getCell(2).value = new Date(contract.startDate);
    row.getCell(2).numFmt = "dd-mmm-yyyy";
    row.getCell(3).value = contract.clientName;
    row.getCell(4).value = contract.clientCode;
    row.getCell(5).value = contract.productDescription
      ? `${contract.productName} (${contract.productDescription})`
      : contract.productName;
    row.getCell(6).value = contract.purchasePrice;
    row.getCell(6).numFmt = '"Rs. "#,##0';
    row.getCell(7).value = contract.totalPrice;
    row.getCell(7).numFmt = '"Rs. "#,##0';
    row.getCell(8).value = contract.profitPercent;
    row.getCell(8).numFmt = '0.0"%"';

    contract.installments.forEach((inst, idx) => {
      const cell = row.getCell(firstInstallmentCol + idx);
      const due = new Date(inst.dueDate);
      const monthLabel = `${MONTH_ABBR[due.getMonth()]} '${String(due.getFullYear()).slice(2)}`;

      const isPaid = inst.status === "PAID";
      // Treat as partial whenever some (but not all) of the installment has
      // been paid, regardless of the exact status label — this is what
      // should get the amber color and the still-owed amount, not the red
      // "nothing paid" color with the full original installment amount.
      const isPartial = !isPaid && inst.paidAmount > 0 && inst.remainingAmount > 0;

      if (isPartial) {
        // Show what's still owed on this installment, not the full amount —
        // the full amount would overstate what's left and misrepresent it
        // as unpaid.
        cell.value = inst.remainingAmount;
        cell.numFmt = `#,##0" due – ${monthLabel}"`;
        cell.fill = PARTIAL_FILL;
        cell.font = { color: { argb: PARTIAL_FONT_COLOR }, bold: true };
      } else {
        cell.value = inst.installmentAmount;
        cell.numFmt = `#,##0" – ${monthLabel}"`;
        cell.fill = isPaid ? PAID_FILL : UNPAID_FILL;
        cell.font = { color: { argb: isPaid ? PAID_FONT_COLOR : UNPAID_FONT_COLOR } };
      }
    });

    // Subtotal is the contract's actual total price, taken directly from
    // the contract rather than SUM()'d from the installment cells above.
    // Partial installments intentionally display their remaining (not
    // full) amount now, so a SUM() formula would understate the true
    // total price whenever any installment in the row was only partly paid.
    const subtotalCell = row.getCell(subtotalCol);
    subtotalCell.value = contract.totalPrice;
    subtotalCell.numFmt = '"Rs. "#,##0';
    subtotalCell.font = { bold: true };

    const remainingCell = row.getCell(remainingBalanceCol);
    remainingCell.value = contract.remainingBalance;
    remainingCell.numFmt = '"Rs. "#,##0';
    remainingCell.font = {
      bold: true,
      color: { argb: contract.remainingBalance > 0 ? UNPAID_FONT_COLOR : PAID_FONT_COLOR },
    };

    for (let c = 1; c <= totalCols; c++) {
      row.getCell(c).border = {
        top: THIN_BORDER,
        bottom: THIN_BORDER,
        left: THIN_BORDER,
        right: THIN_BORDER,
      };
    }

    rowNum += 1;
  }

  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 13;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 14;
  sheet.getColumn(5).width = 26;
  sheet.getColumn(6).width = 14;
  sheet.getColumn(7).width = 14;
  sheet.getColumn(8).width = 10;
  for (let i = 0; i < maxInstallments; i++) {
    sheet.getColumn(firstInstallmentCol + i).width = 16;
  }
  sheet.getColumn(subtotalCol).width = 15;
  sheet.getColumn(remainingBalanceCol).width = 17;

  return workbook;
}