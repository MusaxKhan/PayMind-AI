import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export class CashLedgerServiceError extends Error {}

export type CashLedgerEntryType =
  | "investment"
  | "loan"
  | "payment_received"
  | "purchase"
  | "withdrawal"
  | "loan_repayment"
  | "business_expense"
  | "loan_given"
  | "loan_given_repayment";

export interface CashLedgerEntry {
  id: number;
  entryType: CashLedgerEntryType;
  amount: number;
  contractId: number | null;
  investorId: number | null;
  investmentId: number | null;
  loanId: number | null;
  withdrawalId: number | null;
  paymentId: number | null;
  businessExpenseId: number | null;
  givenLoanId: number | null;
  description: string | null;
  entryDate: string;
  createdAt: string;
}

/**
 * Writes one cash_ledger row. This is a thin, shared helper rather
 * than ad-hoc inserts scattered across contract-service.ts,
 * payment-service.ts, etc. — every place that moves cash calls this
 * exact function, so there's one place to look if the ledger ever
 * looks wrong.
 *
 * Takes an already-created Supabase client (rather than creating its
 * own) so callers can write the ledger entry as part of the same
 * request lifecycle as the operation that triggered it.
 */
export async function writeCashLedgerEntry(
  supabase: SupabaseClient<Database>,
  entry: {
    entryType: CashLedgerEntryType;
    amount: number;
    contractId?: number;
    investorId?: number;
    investmentId?: number;
    loanId?: number;
    withdrawalId?: number;
    paymentId?: number;
    description?: string;
    entryDate?: string;
  }
): Promise<void> {
  const { error } = await supabase.from("cash_ledger").insert({
    entry_type: entry.entryType,
    amount: entry.amount,
    contract_id: entry.contractId ?? null,
    investor_id: entry.investorId ?? null,
    investment_id: entry.investmentId ?? null,
    loan_id: entry.loanId ?? null,
    withdrawal_id: entry.withdrawalId ?? null,
    payment_id: entry.paymentId ?? null,
    description: entry.description ?? null,
    entry_date: entry.entryDate ?? new Date().toISOString().split("T")[0],
  });

  if (error) {
    throw new CashLedgerServiceError(
      `Failed to write cash ledger entry: ${error.message}`
    );
  }
}

/**
 * Keeps a contract's "purchase" cash_ledger entry in sync when the
 * contract's purchase price or start date is edited before any
 * payments exist (see updateContractRecord in contract-service.ts —
 * financial terms are frozen the moment a payment is recorded, so this
 * only ever runs pre-payment).
 *
 * Mirrors syncCashLedgerForPaymentEdit's approach: update the existing
 * linked row in place rather than appending a delta entry, since a
 * contract has exactly one purchase entry by construction (written
 * once, in createContractRecord, always with contractId set — there's
 * no legacy-data case to fall back through here).
 */
export async function syncCashLedgerForContractEdit(
  supabase: SupabaseClient<Database>,
  params: {
    contractId: number;
    newPurchasePrice: number;
    newStartDate: string;
  }
): Promise<void> {
  const { contractId, newPurchasePrice, newStartDate } = params;

  const { data: rows, error: findError } = await supabase
    .from("cash_ledger")
    .select("id")
    .eq("contract_id", contractId)
    .eq("entry_type", "purchase");

  if (findError) {
    throw new CashLedgerServiceError(
      `Failed to look up the purchase cash ledger entry for contract #${contractId}: ${findError.message}`
    );
  }

  if (!rows || rows.length !== 1) {
    throw new CashLedgerServiceError(
      rows && rows.length > 1
        ? `Contract #${contractId} has ${rows.length} purchase cash ledger entries — refusing to guess which to update. Please reconcile cash_ledger manually.`
        : `Contract #${contractId}'s purchase price was updated, but no matching cash ledger entry was found — cash-in-hand could not be synced. Please reconcile cash_ledger manually.`
    );
  }

  const { error: updateError } = await supabase
    .from("cash_ledger")
    .update({ amount: -newPurchasePrice, entry_date: newStartDate })
    .eq("id", rows[0].id);

  if (updateError) {
    throw new CashLedgerServiceError(
      `Contract #${contractId} was updated but its cash ledger entry could not be synced: ${updateError.message}`
    );
  }
}

export async function getCashInHand(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_cash_in_hand");

  if (error) {
    throw new CashLedgerServiceError(
      `Failed to fetch cash in hand: ${error.message}`
    );
  }

  return Number(data ?? 0);
}

export async function listCashLedgerEntries(params?: {
  limit?: number;
}): Promise<CashLedgerEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cash_ledger")
    .select("*")
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(params?.limit ?? 200);

  if (error) {
    throw new CashLedgerServiceError(
      `Failed to list cash ledger entries: ${error.message}`
    );
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    entryType: row.entry_type as CashLedgerEntryType,
    amount: Number(row.amount),
    contractId: row.contract_id,
    investorId: row.investor_id,
    investmentId: row.investment_id,
    loanId: row.loan_id,
    withdrawalId: row.withdrawal_id,
    paymentId: row.payment_id,
    businessExpenseId: row.business_expense_id,
    givenLoanId: row.given_loan_id,
    description: row.description,
    entryDate: row.entry_date,
    createdAt: row.created_at,
  }));
}

/**
 * Keeps the cash_ledger row created for a payment in sync when that
 * payment's amount is edited after the fact (see editPaymentAmount in
 * payment-service.ts). Cash-in-hand, the dashboard, the cash ledger page,
 * and the graphs page are all derived from cash_ledger, so if this isn't
 * called on every payment edit those views silently keep showing the
 * pre-edit amount forever even though the payment itself shows the new one.
 *
 * Resolution order:
 *  1. Look up the ledger row directly via payment_id (the normal case for
 *     any payment recorded after migration 004).
 *  2. Fall back to matching an un-linked legacy row by contract + date +
 *     the payment's amount *before* this edit, and link it going forward.
 *     Only acts if the match is unambiguous.
 *  3. If neither resolves, throw rather than guess — silently corrupting
 *     cash-in-hand is worse than a clear error asking for manual review.
 */
export async function syncCashLedgerForPaymentEdit(
  supabase: SupabaseClient<Database>,
  params: {
    paymentId: number;
    contractId: number;
    entryDate: string;
    oldAmount: number;
    newAmount: number;
  }
): Promise<void> {
  const { paymentId, contractId, entryDate, oldAmount, newAmount } = params;

  const { data: linkedRows, error: linkedError } = await supabase
    .from("cash_ledger")
    .select("id")
    .eq("payment_id", paymentId)
    .eq("entry_type", "payment_received");

  if (linkedError) {
    throw new CashLedgerServiceError(
      `Failed to look up cash ledger entry for payment #${paymentId}: ${linkedError.message}`
    );
  }

  if (linkedRows && linkedRows.length === 1) {
    const { error: updateError } = await supabase
      .from("cash_ledger")
      .update({ amount: newAmount })
      .eq("id", linkedRows[0].id);

    if (updateError) {
      throw new CashLedgerServiceError(
        `Payment #${paymentId} was updated but its cash ledger entry could not be synced: ${updateError.message}`
      );
    }
    return;
  }

  if (linkedRows && linkedRows.length > 1) {
    throw new CashLedgerServiceError(
      `Payment #${paymentId} has more than one linked cash ledger entry — refusing to guess which to update. Please reconcile cash_ledger manually.`
    );
  }

  // No linked row (legacy data from before migration 004). Try an
  // unambiguous fallback match on the un-linked candidates.
  const { data: candidates, error: candidatesError } = await supabase
    .from("cash_ledger")
    .select("id")
    .is("payment_id", null)
    .eq("entry_type", "payment_received")
    .eq("contract_id", contractId)
    .eq("entry_date", entryDate)
    .eq("amount", oldAmount);

  if (candidatesError) {
    throw new CashLedgerServiceError(
      `Failed to look up legacy cash ledger entry for payment #${paymentId}: ${candidatesError.message}`
    );
  }

  if (!candidates || candidates.length !== 1) {
    throw new CashLedgerServiceError(
      candidates && candidates.length > 1
        ? `Payment #${paymentId}'s amount was updated, but ${candidates.length} matching legacy cash ledger entries were found — cash-in-hand could not be safely synced. Please reconcile cash_ledger manually for contract #${contractId}.`
        : `Payment #${paymentId}'s amount was updated, but no matching cash ledger entry was found — cash-in-hand could not be synced. Please reconcile cash_ledger manually for contract #${contractId}.`
    );
  }

  const { error: linkUpdateError } = await supabase
    .from("cash_ledger")
    .update({ amount: newAmount, payment_id: paymentId })
    .eq("id", candidates[0].id);

  if (linkUpdateError) {
    throw new CashLedgerServiceError(
      `Payment #${paymentId} was updated but its legacy cash ledger entry could not be synced: ${linkUpdateError.message}`
    );
  }
}