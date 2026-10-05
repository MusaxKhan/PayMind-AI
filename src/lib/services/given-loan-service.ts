import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { toDateInputValue } from "@/lib/utils/format";
import type {
  GivenLoanRow,
  GivenLoanInstallmentRow,
  GivenLoanPaymentRow,
} from "@/types/database";
import type {
  GivenLoanFormValues,
  GivenLoanPaymentFormValues,
} from "@/lib/validations/given-loan";

export class GivenLoanServiceError extends Error {}

export type GivenLoanStatus = "ACTIVE" | "OVERDUE" | "COMPLETED";

export interface GivenLoanInstallment {
  id: number;
  installmentNumber: number;
  dueDate: string;
  installmentAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: "PENDING" | "PARTIAL" | "PAID";
  isOverdue: boolean;
}

export interface GivenLoanPayment {
  id: number;
  amountPaid: number;
  remainingBalance: number;
  paymentDate: string;
  paymentMethod: string | null;
  remarks: string | null;
}

export interface GivenLoan {
  id: number;
  loanCode: string;
  clientId: number | null;
  borrowerName: string;
  borrowerPhone: string | null;
  reason: string | null;
  amount: number;
  numberOfInstallments: number;
  amountPerInstallment: number;
  loanDate: string;
  expectedEndDate: string;
  amountRepaid: number;
  outstandingBalance: number;
  /** Derived at read time from installment due dates, never stored, so it cannot go stale. */
  status: GivenLoanStatus;
  overdueMonths: number;
  overdueAmount: number;
  nextDueDate: string | null;
  createdAt: string;
}

export interface GivenLoanWithDetails extends GivenLoan {
  installments: GivenLoanInstallment[];
  payments: GivenLoanPayment[];
}

const num = (v: number | string) => Number(v);
const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

/** Derives status/overdue figures from a loan row and its UNPAID installments. */
function mapLoan(
  row: GivenLoanRow,
  unpaid: Pick<GivenLoanInstallmentRow, "due_date" | "remaining_amount">[],
  today: string
): GivenLoan {
  const amount = num(row.amount);
  const amountRepaid = num(row.amount_repaid);
  const overdue = unpaid
    .filter((i) => i.due_date < today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const nextDue =
    [...unpaid].sort((a, b) => a.due_date.localeCompare(b.due_date))[0]?.due_date ?? null;

  let overdueMonths = 0;
  if (row.status !== "COMPLETED" && overdue.length > 0) {
    const days =
      (new Date(today).getTime() - new Date(overdue[0].due_date).getTime()) / 86_400_000;
    overdueMonths = Math.max(1, Math.floor(days / 30));
  }

  const status: GivenLoanStatus =
    row.status === "COMPLETED" ? "COMPLETED" : overdue.length > 0 ? "OVERDUE" : "ACTIVE";

  return {
    id: row.id,
    loanCode: row.loan_code,
    clientId: row.client_id,
    borrowerName: row.borrower_name,
    borrowerPhone: row.borrower_phone,
    reason: row.reason,
    amount,
    numberOfInstallments: row.number_of_installments,
    amountPerInstallment: num(row.amount_per_installment),
    loanDate: row.loan_date,
    expectedEndDate: row.expected_end_date,
    amountRepaid,
    outstandingBalance: Math.max(0, round2(amount - amountRepaid)),
    status,
    overdueMonths,
    overdueAmount:
      status === "OVERDUE"
        ? round2(overdue.reduce((s, i) => s + num(i.remaining_amount), 0))
        : 0,
    nextDueDate: row.status === "COMPLETED" ? null : nextDue,
    createdAt: row.created_at,
  };
}

export async function listGivenLoans(): Promise<GivenLoan[]> {
  const supabase = await createClient();
  const today = toDateInputValue(new Date());

  let loans: GivenLoanRow[];
  let unpaid: Pick<
    GivenLoanInstallmentRow,
    "given_loan_id" | "due_date" | "remaining_amount"
  >[];
  try {
    [loans, unpaid] = await Promise.all([
      fetchAllRows<GivenLoanRow>((from, to) =>
        supabase
          .from("given_loans")
          .select("*")
          .order("loan_date", { ascending: false })
          .order("id", { ascending: false })
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("given_loan_installments")
          .select("given_loan_id, due_date, remaining_amount")
          .neq("status", "PAID")
          .order("id")
          .range(from, to)
      ),
    ]);
  } catch (err) {
    throw new GivenLoanServiceError(
      `Failed to list given loans: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }

  const byLoan = new Map<number, typeof unpaid>();
  for (const i of unpaid) {
    const list = byLoan.get(i.given_loan_id) ?? [];
    list.push(i);
    byLoan.set(i.given_loan_id, list);
  }

  return loans.map((row) => mapLoan(row, byLoan.get(row.id) ?? [], today));
}

export async function getGivenLoanById(
  id: number
): Promise<GivenLoanWithDetails | null> {
  const supabase = await createClient();
  const today = toDateInputValue(new Date());

  const { data: row, error } = await supabase
    .from("given_loans")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new GivenLoanServiceError(`Failed to fetch loan: ${error.message}`);
  }
  if (!row) return null;

  const [{ data: instRows, error: instError }, { data: payRows, error: payError }] =
    await Promise.all([
      supabase
        .from("given_loan_installments")
        .select("*")
        .eq("given_loan_id", id)
        .order("installment_number"),
      supabase
        .from("given_loan_payments")
        .select("*")
        .eq("given_loan_id", id)
        .order("payment_date", { ascending: false })
        .order("id", { ascending: false }),
    ]);

  if (instError || payError) {
    throw new GivenLoanServiceError(
      `Failed to fetch loan details: ${(instError ?? payError)?.message}`
    );
  }

  const installments = (instRows ?? []) as GivenLoanInstallmentRow[];
  const payments = (payRows ?? []) as GivenLoanPaymentRow[];
  const base = mapLoan(
    row as GivenLoanRow,
    installments.filter((i) => i.status !== "PAID"),
    today
  );

  return {
    ...base,
    installments: installments.map((i) => ({
      id: i.id,
      installmentNumber: i.installment_number,
      dueDate: i.due_date,
      installmentAmount: num(i.installment_amount),
      paidAmount: num(i.paid_amount),
      remainingAmount: num(i.remaining_amount),
      status: i.status,
      isOverdue: i.status !== "PAID" && i.due_date < today,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      amountPaid: num(p.amount_paid),
      remainingBalance: num(p.remaining_balance),
      paymentDate: p.payment_date,
      paymentMethod: p.payment_method,
      remarks: p.remarks,
    })),
  };
}

export interface GivenLoanDashboardSummary {
  totalOutstanding: number;
  activeCount: number;
  overdueCount: number;
  overdueAmount: number;
  dueSoonCount: number;
  worstOverdue: {
    id: number;
    loanCode: string;
    borrowerName: string;
    overdueMonths: number;
    overdueAmount: number;
  }[];
}

/** Everything the dashboard notifier and stat card need. */
export async function getGivenLoanDashboardSummary(): Promise<GivenLoanDashboardSummary> {
  const loans = await listGivenLoans();
  const today = new Date();
  const soon = new Date(today);
  soon.setDate(soon.getDate() + 7);
  const todayStr = toDateInputValue(today);
  const soonStr = toDateInputValue(soon);

  const open = loans.filter((l) => l.status !== "COMPLETED");
  const overdue = open.filter((l) => l.status === "OVERDUE");

  return {
    totalOutstanding: round2(open.reduce((s, l) => s + l.outstandingBalance, 0)),
    activeCount: open.length,
    overdueCount: overdue.length,
    overdueAmount: round2(overdue.reduce((s, l) => s + l.overdueAmount, 0)),
    dueSoonCount: open.filter(
      (l) =>
        l.status === "ACTIVE" &&
        l.nextDueDate !== null &&
        l.nextDueDate >= todayStr &&
        l.nextDueDate <= soonStr
    ).length,
    worstOverdue: [...overdue]
      .sort((a, b) => b.overdueMonths - a.overdueMonths || b.overdueAmount - a.overdueAmount)
      .slice(0, 3)
      .map((l) => ({
        id: l.id,
        loanCode: l.loanCode,
        borrowerName: l.borrowerName,
        overdueMonths: l.overdueMonths,
        overdueAmount: l.overdueAmount,
      })),
  };
}

export async function createGivenLoan(
  values: GivenLoanFormValues
): Promise<GivenLoanRow> {
  const supabase = await createClient();
  const isClient = values.borrowerType === "client";

  const { data, error } = await supabase.rpc("create_given_loan", {
    p_client_id: isClient ? values.clientId ?? null : null,
    p_borrower_name: isClient ? null : values.borrowerName || null,
    p_borrower_phone: isClient ? null : values.borrowerPhone || null,
    p_reason: values.reason || null,
    p_amount: values.amount,
    p_number_of_installments: values.numberOfInstallments,
    p_loan_date: values.loanDate,
  });

  if (error) {
    // RAISE EXCEPTION messages (not enough cash, bad date, ...) are already readable.
    throw new GivenLoanServiceError(error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new GivenLoanServiceError("Loan could not be created: no row returned.");
  }
  return row;
}

export async function recordGivenLoanPayment(
  values: GivenLoanPaymentFormValues
): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_given_loan_payment", {
    p_given_loan_id: values.givenLoanId,
    p_amount: values.amount,
    p_payment_date: values.paymentDate,
    p_payment_method: values.paymentMethod || null,
    p_remarks: values.remarks || null,
  });
  if (error) {
    throw new GivenLoanServiceError(error.message);
  }
}

/** Admin only: checked here and again inside delete_given_loan(). */
export async function deleteGivenLoan(
  givenLoanId: number,
  reverseCash: boolean
): Promise<void> {
  const { requireAdmin, UserServiceError } = await import("./user-service");
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UserServiceError) {
      throw new GivenLoanServiceError(err.message);
    }
    throw err;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_given_loan", {
    p_given_loan_id: givenLoanId,
    p_reverse_cash: reverseCash,
  });
  if (error) {
    throw new GivenLoanServiceError(error.message);
  }
}
