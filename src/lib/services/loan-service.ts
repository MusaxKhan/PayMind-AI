import { createClient } from "@/lib/supabase/server";

export class LoanServiceError extends Error {}

export interface Loan {
  id: number;
  lenderName: string;
  amount: number;
  reason: string | null;
  loanDate: string;
  amountRepaid: number;
  outstandingBalance: number;
  status: "ACTIVE" | "REPAID";
  createdAt: string;
}

function mapLoan(row: {
  id: number;
  lender_name: string;
  amount: number;
  reason: string | null;
  loan_date: string;
  amount_repaid: number;
  status: "ACTIVE" | "REPAID";
  created_at: string;
}): Loan {
  const amount = Number(row.amount);
  const amountRepaid = Number(row.amount_repaid);
  return {
    id: row.id,
    lenderName: row.lender_name,
    amount,
    reason: row.reason,
    loanDate: row.loan_date,
    amountRepaid,
    outstandingBalance: Math.max(0, amount - amountRepaid),
    status: row.status,
    createdAt: row.created_at,
  };
}

export async function listLoans(): Promise<Loan[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("loans")
    .select("*")
    .order("loan_date", { ascending: false });

  if (error) {
    throw new LoanServiceError(`Failed to list loans: ${error.message}`);
  }
  return (data ?? []).map(mapLoan);
}

export async function getTotalOutstandingLoans(): Promise<number> {
  const loans = await listLoans();
  return loans.reduce((sum, l) => sum + l.outstandingBalance, 0);
}

/**
 * Creates a loan and its cash-in ledger entry atomically via
 * create_loan() in migration 004 — same reasoning as
 * distribute_contract_profit / create_withdrawal_with_balance_check:
 * the loan row and the ledger entry must both succeed or both fail,
 * never one without the other.
 */
export async function createLoan(values: {
  lenderName: string;
  amount: number;
  reason?: string;
  loanDate: string;
}): Promise<Loan> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("create_loan", {
    p_lender_name: values.lenderName,
    p_amount: values.amount,
    p_reason: values.reason || null,
    p_loan_date: values.loanDate,
  });

  if (error) {
    throw new LoanServiceError(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new LoanServiceError("Loan could not be created — no row returned.");
  }
  return mapLoan(row);
}

/**
 * Records a manual repayment against a loan. Deliberately separate
 * from any automatic cash-recovery logic — repaying a loan is always
 * a distinct action someone takes, never inferred from a contract
 * completing.
 */
export async function recordLoanRepayment(values: {
  loanId: number;
  amount: number;
  repaymentDate: string;
}): Promise<Loan> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("record_loan_repayment", {
    p_loan_id: values.loanId,
    p_amount: values.amount,
    p_repayment_date: values.repaymentDate,
  });

  if (error) {
    throw new LoanServiceError(error.message);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    throw new LoanServiceError(
      "Repayment could not be recorded — no row returned."
    );
  }
  return mapLoan(row);
}

/**
 * Deletes a loan and, in the same atomic transaction, decides what
 * happens to cash-in-hand via delete_loan() in migration 008 — same
 * reasoning as deleteContract:
 *   - reverseCash = true ("full undo"): removes every cash_ledger row
 *     tied to this loan (the original inflow AND every repayment made
 *     against it), so cash-in-hand ends up exactly where it would be
 *     if this loan had never happened. Refused by the Postgres function
 *     if that would take cash-in-hand below zero (the inflow may
 *     already be spent elsewhere).
 *   - reverseCash = false ("keep cash history"): the loan's
 *     cash_ledger rows are kept (cash-in-hand and historical totals
 *     stay exactly as they are) but detached from the loan record.
 *
 * Requires admin privileges; checked both here and again inside the
 * Postgres function.
 */
export async function deleteLoan(
  loanId: number,
  reverseCash: boolean
): Promise<void> {
  const { requireAdmin, UserServiceError } = await import("./user-service");
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UserServiceError) {
      throw new LoanServiceError(err.message);
    }
    throw err;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("delete_loan", {
    p_loan_id: loanId,
    p_reverse_cash: reverseCash,
  });

  if (error) {
    // The Postgres function's RAISE EXCEPTION messages (not found,
    // would go cash-negative, not admin) come through as error.message
    // and are already human-readable.
    throw new LoanServiceError(error.message);
  }
}