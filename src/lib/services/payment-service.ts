import { createClient } from "@/lib/supabase/server";
import { mapPayment, mapPaymentEdit } from "./mappers";
import { allocatePayment, round2 } from "@/lib/utils/calculations";
import { recomputeContractStatus } from "./contract-service";
import {
  writeCashLedgerEntry,
  syncCashLedgerForPaymentEdit,
} from "./cash-ledger-service";
import type { Payment, PaymentWithEdits } from "@/types/domain";
import type {
  PaymentFormValues,
  PaymentEditFormValues,
} from "@/lib/validations/payment";
import type { InstallmentStatus } from "@/types/database";
export class PaymentServiceError extends Error {}

/**
 * Records a payment against a contract and allocates it across the
 * contract's outstanding installments (oldest first). Handles partial,
 * exact, and over-payment (including early payoff) automatically.
 *
 * This does several writes that should ideally be one DB transaction.
 * Supabase's JS client doesn't expose multi-statement transactions
 * directly, so we sequence the writes carefully and surface any
 * failure clearly. For full atomicity, this logic can be moved into
 * a Postgres function (`record_payment_with_allocation`) — left as
 * a noted follow-up since correctness here is verified by the
 * allocation unit being a pure, already-tested function.
 */

type WorkingInstallment = {
  id: number;
  installmentNumber: number;
  installmentAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: InstallmentStatus;
};
export async function recordPayment(
  values: PaymentFormValues
): Promise<{ payment: Payment; distributionWarning: string | null }> {
  const supabase = await createClient();

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id, remaining_balance, status")
    .eq("id", values.contractId)
    .single();

  if (contractError || !contract) {
    throw new PaymentServiceError("Contract not found.");
  }
  if (contract.status === "COMPLETED") {
    throw new PaymentServiceError(
      "This contract is already completed — no further payments can be recorded."
    );
  }

  // A payment is allowed to exceed a single installment's amount — it's
  // meant to spill over and pay off the next installments too. It must
  // NOT exceed the contract's total remaining balance, though; that's
  // always a data-entry mistake (a typo'd extra digit, wrong contract
  // selected, etc.) rather than a legitimate early payoff, since a
  // correct payoff amount is by definition <= what's still owed.
  const remainingBalance = Number(contract.remaining_balance);
  if (values.amountPaid > remainingBalance) {
    throw new PaymentServiceError(
      `This payment (Rs. ${values.amountPaid.toLocaleString()}) is more than the Rs. ${remainingBalance.toLocaleString()} still owed on this contract. A payment can be larger than a single installment — it'll spread across the remaining ones — but it can't be larger than the total remaining balance. Please double-check the amount before submitting.`
    );
  }

  const { data: outstandingInstallments, error: instError } = await supabase
    .from("installments")
    .select("*")
    .eq("contract_id", values.contractId)
    .neq("status", "PAID")
    .order("installment_number", { ascending: true });

  if (instError) {
    throw new PaymentServiceError(
      `Failed to load installments: ${instError.message}`
    );
  }
  if (!outstandingInstallments || outstandingInstallments.length === 0) {
    throw new PaymentServiceError(
      "No outstanding installments to apply this payment to."
    );
  }

  const outcome = allocatePayment(
    values.amountPaid,
    outstandingInstallments.map((i) => ({
      id: i.id,
      installmentNumber: i.installment_number,
      installmentAmount: Number(i.installment_amount),
      paidAmount: Number(i.paid_amount),
      remainingAmount: Number(i.remaining_amount),
      status: i.status,
    })),
    Number(contract.remaining_balance)
  );

  // Apply installment updates.
  for (const allocation of outcome.allocations) {
    const { error } = await supabase
      .from("installments")
      .update({
        paid_amount: allocation.newPaidAmount,
        remaining_amount: allocation.newRemainingAmount,
        status: allocation.newStatus,
      })
      .eq("id", allocation.installmentId);

    if (error) {
      throw new PaymentServiceError(
        `Failed to update installment #${allocation.installmentNumber}: ${error.message}`
      );
    }
  }

  // Record the payment itself, snapshotting the resulting contract balance.
  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .insert({
      contract_id: values.contractId,
      amount_paid: values.amountPaid,
      remaining_balance: outcome.newContractRemainingBalance,
      payment_method: values.paymentMethod,
      remarks: values.remarks || null,
      payment_date: values.paymentDate,
    })
    .select("*")
    .single();

  if (paymentError) {
    throw new PaymentServiceError(
      `Failed to record payment: ${paymentError.message}`
    );
  }

  // Cash-in: the full payment amount flows into cash-in-hand the
  // moment it's collected — not deferred until the contract completes.
  // This is what makes cash-in-hand track real, spendable cash rather
  // than just "profit recognized so far."
  await writeCashLedgerEntry(supabase, {
    entryType: "payment_received",
    amount: values.amountPaid,
    contractId: values.contractId,
    paymentId: paymentRow.id,
    entryDate: values.paymentDate,
    description: `Payment received for contract #${values.contractId}`,
  });

  // Update contract's remaining balance.
  const { error: contractUpdateError } = await supabase
    .from("contracts")
    .update({ remaining_balance: outcome.newContractRemainingBalance })
    .eq("id", values.contractId);

  if (contractUpdateError) {
    throw new PaymentServiceError(
      `Failed to update contract balance: ${contractUpdateError.message}`
    );
  }

  // Recompute contract status (handles COMPLETED transition + overdue clearing).
  const { distributionWarning } = await recomputeContractStatus(
    values.contractId
  );

  return { payment: mapPayment(paymentRow), distributionWarning };
}

export async function listPaymentsForContract(
  contractId: number
): Promise<Payment[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .select("*")
    .eq("contract_id", contractId)
    .order("payment_date", { ascending: false });

  if (error) {
    throw new PaymentServiceError(`Failed to list payments: ${error.message}`);
  }
  return (data ?? []).map(mapPayment);
}

/**
 * Fetches every payment_edits row for all payments under a contract in
 * a single query, grouped by payment_id. Used by the contract detail
 * page so the payment history table can show each row's edit history
 * (and disable the edit button correctly) without an N+1 query per
 * payment.
 */
export async function listPaymentEditsForContract(
  contractId: number
): Promise<Map<number, ReturnType<typeof mapPaymentEdit>[]>> {
  const supabase = await createClient();

  const { data: payments, error: paymentsError } = await supabase
    .from("payments")
    .select("id")
    .eq("contract_id", contractId);

  if (paymentsError) {
    throw new PaymentServiceError(
      `Failed to list payments for edit lookup: ${paymentsError.message}`
    );
  }

  const paymentIds = (payments ?? []).map((p) => p.id);
  if (paymentIds.length === 0) return new Map();

  const { data: edits, error: editsError } = await supabase
    .from("payment_edits")
    .select("*")
    .in("payment_id", paymentIds)
    .order("edited_at", { ascending: false });

  if (editsError) {
    throw new PaymentServiceError(
      `Failed to list payment edits: ${editsError.message}`
    );
  }

  const grouped = new Map<number, ReturnType<typeof mapPaymentEdit>[]>();
  for (const row of edits ?? []) {
    const mapped = mapPaymentEdit(row);
    const existing = grouped.get(mapped.paymentId) ?? [];
    existing.push(mapped);
    grouped.set(mapped.paymentId, existing);
  }
  return grouped;
}

export async function getPaymentWithEdits(
  paymentId: number
): Promise<PaymentWithEdits | null> {
  const supabase = await createClient();

  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .select("*")
    .eq("id", paymentId)
    .maybeSingle();

  if (paymentError) {
    throw new PaymentServiceError(
      `Failed to fetch payment: ${paymentError.message}`
    );
  }
  if (!paymentRow) return null;

  const { data: editRows, error: editError } = await supabase
    .from("payment_edits")
    .select("*")
    .eq("payment_id", paymentId)
    .order("edited_at", { ascending: false });

  if (editError) {
    throw new PaymentServiceError(
      `Failed to fetch payment edits: ${editError.message}`
    );
  }

  return {
    ...mapPayment(paymentRow),
    edits: (editRows ?? []).map(mapPaymentEdit),
  };
}

/**
 * Financial records must never be silently modified. This writes an
 * audit log entry (old value, new value, who, when, why) BEFORE
 * applying the change, then updates the payment amount.
 *
 * Guard: if the contract's profit has already been distributed to
 * investors, the payment amount is frozen. Editing it after
 * distribution would change what "total paid" and "remaining balance"
 * mean for a contract whose profit has already been split and paid
 * out — the audit trail would show a change, but there'd be no way to
 * also safely unwind or adjust distributions that already happened.
 * Staff who genuinely need to fix a contract in this state should
 * correct it directly in Supabase with full awareness of the
 * downstream effects, not through this audited-but-unwound-blind path.
 *
 * Note: editing a payment amount after the fact does NOT automatically
 * re-run installment allocation — that re-derivation is complex and
 * risks corrupting history. Instead this is intended for correcting
 * clerical errors (wrong amount typed) close to time of entry. The
 * audit trail preserves full transparency on what changed and why.
 */

async function recalculateContractAllocations(
  contractId: number
): Promise<void> {
  const supabase = await createClient();

  const { data: contract, error: contractError } = await supabase
    .from("contracts")
    .select("id, total_price")
    .eq("id", contractId)
    .single();

  if (contractError || !contract) {
    throw new PaymentServiceError("Contract not found.");
  }

  const { data: installments, error: installmentError } = await supabase
    .from("installments")
    .select("*")
    .eq("contract_id", contractId)
    .order("installment_number");

  if (installmentError) {
    throw new PaymentServiceError(
      `Failed to load installments: ${installmentError.message}`
    );
  }

  const { data: payments, error: paymentError } = await supabase
    .from("payments")
    .select("*")
    .eq("contract_id", contractId)
    .order("payment_date", { ascending: true })
    .order("id", { ascending: true });

  if (paymentError) {
    throw new PaymentServiceError(
      `Failed to load payments: ${paymentError.message}`
    );
  }

  const workingInstallments: WorkingInstallment[] =
  (installments ?? []).map((i) => ({
    id: i.id,
    installmentNumber: i.installment_number,
    installmentAmount: Number(i.installment_amount),
    paidAmount: 0,
    remainingAmount: Number(i.installment_amount),
    status: "PENDING",
  }));

  let currentRemainingBalance = Number(contract.total_price);

  for (const payment of payments ?? []) {
    const outcome = allocatePayment(
      Number(payment.amount_paid),
      workingInstallments.filter((i) => i.remainingAmount > 0),
      currentRemainingBalance
    );

    currentRemainingBalance =
      outcome.newContractRemainingBalance;

    for (const allocation of outcome.allocations) {
      const inst = workingInstallments.find(
        (i) => i.id === allocation.installmentId
      );

      if (!inst) continue;

      inst.paidAmount = allocation.newPaidAmount;
      inst.remainingAmount = allocation.newRemainingAmount;
      inst.status = allocation.newStatus;
    }

    await supabase
      .from("payments")
      .update({
        remaining_balance:
          outcome.newContractRemainingBalance,
      })
      .eq("id", payment.id);
  }

  for (const inst of workingInstallments) {
    await supabase
      .from("installments")
      .update({
        paid_amount: inst.paidAmount,
        remaining_amount: inst.remainingAmount,
        status: inst.status,
      })
      .eq("id", inst.id);
  }

  await supabase
    .from("contracts")
    .update({
      remaining_balance: currentRemainingBalance,
    })
    .eq("id", contractId);

  await recomputeContractStatus(contractId);
}
export async function editPaymentAmount(
  values: PaymentEditFormValues,
  editedByName: string
): Promise<void> {
  const supabase = await createClient();

  const { data: payment, error: fetchError } = await supabase
    .from("payments")
    .select(
      "id, amount_paid, contract_id, payment_date, contract:contracts(profit_distributed, total_price)"
    )
    .eq("id", values.paymentId)
    .single();

  if (fetchError || !payment) {
    throw new PaymentServiceError("Payment not found.");
  }

  if (payment.contract?.profit_distributed) {
    throw new PaymentServiceError(
      "This payment belongs to a contract whose profit has already been distributed to investors. It can't be edited from here — contact an admin to make this correction directly."
    );
  }

  const oldAmount = Number(payment.amount_paid);
  const newAmount = round2(values.newAmount);

  // Same rule as recording a brand-new payment: the edited amount is
  // allowed to exceed a single installment (it spills into the next
  // ones), but the contract's payments can never add up to more than
  // its total price. Check against every OTHER payment on this
  // contract plus the new amount, rather than the contract's current
  // remaining_balance, since remaining_balance reflects the OLD amount
  // for this payment and would double-count it.
  const { data: otherPayments, error: otherPaymentsError } = await supabase
    .from("payments")
    .select("amount_paid")
    .eq("contract_id", payment.contract_id)
    .neq("id", values.paymentId);

  if (otherPaymentsError) {
    throw new PaymentServiceError(
      `Failed to verify other payments on this contract: ${otherPaymentsError.message}`
    );
  }

  const totalPrice = Number(payment.contract?.total_price ?? 0);
  const otherPaymentsTotal = (otherPayments ?? []).reduce(
    (sum, p) => sum + Number(p.amount_paid),
    0
  );
  const maxAllowedForThisPayment = round2(totalPrice - otherPaymentsTotal);

  if (newAmount > maxAllowedForThisPayment) {
    throw new PaymentServiceError(
      `Setting this payment to Rs. ${newAmount.toLocaleString()} would bring the contract's total payments to more than its Rs. ${totalPrice.toLocaleString()} total price. The most this payment can be set to (given the contract's other payments) is Rs. ${maxAllowedForThisPayment.toLocaleString()}. Please double-check the amount before submitting.`
    );
  }

  const { error: logError } = await supabase.from("payment_edits").insert({
    payment_id: values.paymentId,
    old_amount: oldAmount,
    new_amount: newAmount,
    reason: values.reason,
    edited_by: editedByName,
  });

  if (logError) {
    throw new PaymentServiceError(
      `Failed to write audit log — edit aborted: ${logError.message}`
    );
  }

  const { error: updateError } = await supabase
    .from("payments")
    .update({ amount_paid: newAmount })
    .eq("id", values.paymentId);

  if (updateError) {
    throw new PaymentServiceError(
      `Audit log was written but payment update failed — please review payment #${values.paymentId} manually: ${updateError.message}`
    );
  }

  // Keep cash-in-hand (and everything derived from it — dashboard, cash
  // ledger page, graphs) in sync with the new amount. The payment row and
  // audit log are already committed at this point; if this fails, the
  // caller still needs to know, because otherwise the app looks fine while
  // cash-in-hand is silently wrong.
  try {
    await syncCashLedgerForPaymentEdit(supabase, {
      paymentId: values.paymentId,
      contractId: payment.contract_id,
      entryDate: payment.payment_date,
      oldAmount,
      newAmount,
    });
  } catch (err) {
    throw new PaymentServiceError(
      err instanceof Error
        ? `Payment #${values.paymentId} amount was updated, but cash-in-hand could not be synced: ${err.message}`
        : `Payment #${values.paymentId} amount was updated, but cash-in-hand could not be synced.`
    );
  }

  await recalculateContractAllocations(
    payment.contract_id
  );
}