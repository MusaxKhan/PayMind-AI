import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { mapBusinessExpense } from "./mappers";
import type {
  BusinessExpense,
  ContractPurchaseExpense,
} from "@/types/domain";
import type {
  BusinessExpenseFormValues,
  BusinessExpenseEditFormValues,
} from "@/lib/validations/business-expense";

export class BusinessExpenseServiceError extends Error {}

/**
 * Records a business expense (rent, fuel, salaries, etc. — anything NOT
 * tied to a contract) and deducts it from cash-in-hand, atomically, via
 * create_business_expense_with_balance_check() in migration 005. If
 * cash-in-hand can't cover the amount, the whole call fails and nothing
 * is written — this is a hard block, not a warning.
 */
export async function createBusinessExpense(
  values: BusinessExpenseFormValues
): Promise<BusinessExpense> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "create_business_expense_with_balance_check",
    {
      p_title: values.title,
      p_amount: values.amount,
      p_category: values.category,
      p_expense_date: values.expenseDate,
      p_notes: values.notes || null,
      p_receipt_reference: values.receiptReference || null,
    }
  );

  if (error) {
    throw new BusinessExpenseServiceError(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new BusinessExpenseServiceError(
      "Expense could not be recorded — no row returned."
    );
  }

  return mapBusinessExpense(row);
}

/**
 * Edits a business expense — title, amount, category, date, notes, or
 * receipt reference — and keeps its linked cash_ledger row in sync in
 * the same atomic transaction, via
 * update_business_expense_with_balance_check() in migration 007. If the
 * new amount would take cash-in-hand below zero, the whole call fails
 * and nothing is written, same as creating a new expense.
 */
export async function updateBusinessExpense(
  values: BusinessExpenseEditFormValues
): Promise<BusinessExpense> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(
    "update_business_expense_with_balance_check",
    {
      p_expense_id: values.expenseId,
      p_title: values.title,
      p_amount: values.amount,
      p_category: values.category,
      p_expense_date: values.expenseDate,
      p_notes: values.notes || null,
      p_receipt_reference: values.receiptReference || null,
    }
  );

  if (error) {
    throw new BusinessExpenseServiceError(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new BusinessExpenseServiceError(
      "Expense could not be updated — no row returned."
    );
  }

  return mapBusinessExpense(row);
}

export async function listBusinessExpenses(): Promise<BusinessExpense[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_expenses")
    .select("*")
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new BusinessExpenseServiceError(
      `Failed to list business expenses: ${error.message}`
    );
  }

  return (data ?? []).map(mapBusinessExpense);
}

/**
 * Read-only: contract purchase costs already get deducted from
 * cash-in-hand automatically when a contract is created (see
 * contract-service.ts). This just surfaces that existing data on the
 * Expenses page — it never writes anything.
 */
export async function listContractPurchaseExpenses(): Promise<
  ContractPurchaseExpense[]
> {
  const supabase = await createClient();

  const rows = await fetchAllRows<{
    id: number;
    contract_code: string;
    product_name: string;
    product_description: string | null;
    purchase_price: number;
    start_date: string;
    status: ContractPurchaseExpense["status"];
    client: { name: string } | null;
  }>((from, to) =>
    supabase
      .from("contracts")
      .select(
        "id, contract_code, product_name, product_description, purchase_price, start_date, status, client:clients(name)"
      )
      .order("start_date", { ascending: false })
      .range(from, to)
  ).catch((err) => {
    throw new BusinessExpenseServiceError(
      `Failed to list contract purchases: ${err.message}`
    );
  });

  return rows.map((row) => ({
    contractId: row.id,
    contractCode: row.contract_code,
    productName: row.product_name,
    productDescription: row.product_description,
    clientName: row.client?.name ?? "Unknown client",
    purchasePrice: Number(row.purchase_price),
    purchaseDate: row.start_date,
    status: row.status,
  }));
}

/**
 * Total of everything ever spent: every contract's purchase cost, plus
 * every business expense. Reads straight from cash_ledger (the same
 * source of truth cash-in-hand itself is derived from) rather than
 * re-summing two separate tables, so this can never drift from what
 * actually left cash-in-hand.
 */
export async function getTotalExpenses(): Promise<number> {
  const supabase = await createClient();

  const rows = await fetchAllRows<{ amount: number }>((from, to) =>
    supabase
      .from("cash_ledger")
      .select("amount")
      .in("entry_type", ["purchase", "business_expense"])
      .range(from, to)
  ).catch((err) => {
    throw new BusinessExpenseServiceError(
      `Failed to compute total expenses: ${err.message}`
    );
  });

  return rows.reduce((sum, r) => sum + Math.abs(Number(r.amount)), 0);
}