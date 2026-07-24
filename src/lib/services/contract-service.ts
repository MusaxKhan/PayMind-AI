import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { writeCashLedgerEntry, syncCashLedgerForContractEdit } from "./cash-ledger-service";
import { sanitizeSearchTerm } from "@/lib/utils/search";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContractRow, Database } from "@/types/database";
import {
  mapClient,
  mapContract,
  mapInstallment,
  mapPayment,
  mapContractInvestorSnapshot,
} from "./mappers";
import {
  calculateContractFinancials,
  calculateExpectedEndDate,
  generateInstallmentSchedule,
} from "@/lib/utils/calculations";
import type {
  Contract,
  ContractWithClient,
  ContractWithDetails,
  ContractInvestorSnapshotWithInvestor,
} from "@/types/domain";
import type { ContractFormValues } from "@/lib/validations/contract";

export class ContractServiceError extends Error {}

export async function updateContractRecord(
  contractId: number,
  values: ContractFormValues
): Promise<void> {
  const supabase = await createClient();

  const contract = await getContractById(contractId);

  if (!contract) {
    throw new ContractServiceError("Contract not found.");
  }

  const hasPayments = contract.payments.length > 0;
  if (
    hasPayments &&
    (
      values.purchasePrice !== contract.purchasePrice ||
      values.profitPercent !== contract.profitPercent ||
      values.numberOfInstallments !== contract.numberOfInstallments ||
      values.startDate !== contract.startDate
    )
  ) {
    throw new ContractServiceError(
      "Financial terms cannot be changed once payments exist."
    );
  }
  const guarantor = values.hasGuarantor
    ? values.guarantor
    : undefined;

  const updatePayload: Partial<ContractRow> = {
    product_name: values.productName,
    product_description: values.productDescription || null,
    initiated_by: values.initiatedBy,

    guarantor_name: guarantor?.name || null,
    guarantor_phone: guarantor?.phone || null,
    guarantor_address: guarantor?.address || null,
    guarantor_cnic: guarantor?.cnic || null,
  };

  if (!hasPayments) {
    const financials = calculateContractFinancials(
      values.purchasePrice,
      values.profitPercent,
      values.numberOfInstallments
    );

    const startDate = new Date(values.startDate);

    const expectedEndDate = calculateExpectedEndDate(
      startDate,
      values.numberOfInstallments
    );

    Object.assign(updatePayload, {
      purchase_price: values.purchasePrice,
      profit_percent: values.profitPercent,
      profit_amount: financials.profitAmount,

      total_price: financials.totalPrice,

      number_of_installments:
        values.numberOfInstallments,

      amount_per_installment:
        financials.amountPerInstallment,

      remaining_balance:
        financials.totalPrice,

      start_date: values.startDate,

      expected_end_date: expectedEndDate,
    });

    const { error: updateError } = await supabase
      .from("contracts")
      .update(updatePayload)
      .eq("id", contractId);

    if (updateError) {
      throw new ContractServiceError(
        `Failed to update contract: ${updateError.message}`
      );
    }

    const { error: deleteError } = await supabase
      .from("installments")
      .delete()
      .eq("contract_id", contractId);

    if (deleteError) {
      throw new ContractServiceError(
        `Failed to remove installments: ${deleteError.message}`
      );
    }

    const schedule = generateInstallmentSchedule(
      startDate,
      values.numberOfInstallments,
      financials.amountPerInstallment,
      financials.finalInstallmentAmount
    );

    const { error: insertError } = await supabase
      .from("installments")
      .insert(
        schedule.map((inst) => ({
          contract_id: contractId,
          installment_number: inst.installmentNumber,
          due_date: inst.dueDate,
          installment_amount: inst.installmentAmount,
          paid_amount: inst.paidAmount,
          remaining_amount: inst.remainingAmount,
          status: inst.status,
        }))
      );

    if (insertError) {
      throw new ContractServiceError(
        `Failed to regenerate installment schedule: ${insertError.message}`
      );
    }

    // The purchase price (and the date it's recorded against) can
    // change here since this whole branch only runs pre-payment —
    // keep the cash_ledger "purchase" entry written at creation time
    // in sync, or cash-in-hand quietly keeps reflecting the old price
    // forever. See syncCashLedgerForContractEdit for why this updates
    // the existing row in place rather than appending a delta.
    if (
      values.purchasePrice !== contract.purchasePrice ||
      values.startDate !== contract.startDate
    ) {
      await syncCashLedgerForContractEdit(supabase, {
        contractId,
        newPurchasePrice: values.purchasePrice,
        newStartDate: values.startDate,
      });
    }

    return;
  }

  const { error } = await supabase
    .from("contracts")
    .update(updatePayload)
    .eq("id", contractId);

  if (error) {
    throw new ContractServiceError(
      `Failed to update contract: ${error.message}`
    );
  }
}
async function getNextContractCode(
  supabase: SupabaseClient<Database>
): Promise<string> {
  const { data, error } = await supabase.rpc("next_contract_code");
  if (error || !data) {
    throw new ContractServiceError(
      `Failed to generate contract code: ${error?.message ?? "unknown error"}`
    );
  }
  return data as string;
}

export async function listContracts(params?: {
  status?: ContractRow["status"];
  search?: string;
}): Promise<ContractWithClient[]> {
  const supabase = await createClient();

  const data = await fetchAllRows((from, to) => {
    let query = supabase
      .from("contracts")
      .select("*, client:clients(id, client_code, name, phone)");

    if (params?.status) {
      query = query.eq("status", params.status);
    }
    if (params?.search && params.search.trim().length > 0) {
      const term = sanitizeSearchTerm(params.search);
      query = query.or(`contract_code.ilike.%${term}%,product_name.ilike.%${term}%`);
    }

    return query.order("created_at", { ascending: false }).range(from, to);
  }).catch((err) => {
    throw new ContractServiceError(`Failed to list contracts: ${err.message}`);
  });

  return data.map((row) => ({
    ...mapContract(row),
    client: {
      id: row.client.id,
      clientCode: row.client.client_code,
      name: row.client.name,
      phone: row.client.phone,
    },
  }));
}

export async function getContractById(
  id: number
): Promise<ContractWithDetails | null> {
  const supabase = await createClient();

  const { data: contractRow, error: contractError } = await supabase
    .from("contracts")
    .select("*, client:clients(*)")
    .eq("id", id)
    .maybeSingle();

  if (contractError) {
    throw new ContractServiceError(
      `Failed to fetch contract: ${contractError.message}`
    );
  }
  if (!contractRow) return null;

  const [{ data: installmentRows, error: instError }, { data: paymentRows, error: payError }] =
    await Promise.all([
      supabase
        .from("installments")
        .select("*")
        .eq("contract_id", id)
        .order("installment_number", { ascending: true }),
      supabase
        .from("payments")
        .select("*")
        .eq("contract_id", id)
        .order("payment_date", { ascending: false }),
    ]);

  if (instError) {
    throw new ContractServiceError(
      `Failed to fetch installments: ${instError.message}`
    );
  }
  if (payError) {
    throw new ContractServiceError(
      `Failed to fetch payments: ${payError.message}`
    );
  }

  return {
    ...mapContract(contractRow),
    client: mapClient(contractRow.client),
    installments: (installmentRows ?? []).map(mapInstallment),
    payments: (paymentRows ?? []).map(mapPayment),
  };
}

/**
 * Returns the investor pool that was permanently locked in for this
 * contract at creation time (see snapshot_contract_investors). This is
 * exactly who will receive — or already received — this contract's profit;
 * it does not change if investors join or add capital later.
 */
export async function getContractInvestorSnapshot(
  contractId: number
): Promise<ContractInvestorSnapshotWithInvestor[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("contract_investor_snapshots")
    .select("*, investor:investors(name)")
    .eq("contract_id", contractId)
    .order("investor_id", { ascending: true });

  if (error) {
    throw new ContractServiceError(
      `Failed to fetch the locked investor pool: ${error.message}`
    );
  }

  return (data ?? []).map((row) => ({
    ...mapContractInvestorSnapshot(row),
    investorName: row.investor?.name ?? "Unknown investor",
  }));
}

// export async function updateContractRecord(
//   contractId: number,
//   values: ContractFormValues
// )
/**
 * Creates a contract and its full installment schedule atomically.
 * Calculation logic lives in lib/utils/calculations.ts — this function
 * is only responsible for orchestration and persistence.
 */
export async function createContractRecord(
  values: ContractFormValues
): Promise<Contract> {
  const supabase = await createClient();

  // Validate the client up front with a friendly error, rather than
  // letting an invalid/deleted client_id surface as a raw FK violation
  // after we've already burned a contract code from the sequence.
  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("id, is_deleted")
    .eq("id", values.clientId)
    .maybeSingle();

  if (clientError) {
    throw new ContractServiceError(
      `Failed to verify client: ${clientError.message}`
    );
  }
  if (!clientRow) {
    throw new ContractServiceError("Selected client doesn't exist.");
  }
  if (clientRow.is_deleted) {
    throw new ContractServiceError(
      "This client has been deleted and can't have new contracts created against them."
    );
  }

  const contractCode = await getNextContractCode(supabase);

  const financials = calculateContractFinancials(
    values.purchasePrice,
    values.profitPercent,
    values.numberOfInstallments
  );

  const startDate = new Date(values.startDate);
  const expectedEndDate = calculateExpectedEndDate(
    startDate,
    values.numberOfInstallments
  );

  const guarantor = values.hasGuarantor ? values.guarantor : undefined;

  const { data: contractRow, error: contractError } = await supabase
    .from("contracts")
    .insert({
      contract_code: contractCode,
      client_id: values.clientId,
      product_name: values.productName,
      product_description: values.productDescription || null,
      initiated_by: values.initiatedBy,
      purchase_price: values.purchasePrice,
      profit_percent: values.profitPercent,
      profit_amount: financials.profitAmount,
      total_price: financials.totalPrice,
      number_of_installments: values.numberOfInstallments,
      amount_per_installment: financials.amountPerInstallment,
      remaining_balance: financials.totalPrice,
      start_date: values.startDate,
      expected_end_date: expectedEndDate,
      status: "ACTIVE",
      guarantor_name: guarantor?.name || null,
      guarantor_phone: guarantor?.phone || null,
      guarantor_address: guarantor?.address || null,
      guarantor_cnic: guarantor?.cnic || null,
    })
    .select("*")
    .single();

  if (contractError) {
    throw new ContractServiceError(
      `Failed to create contract: ${contractError.message}`
    );
  }

  const schedule = generateInstallmentSchedule(
    startDate,
    values.numberOfInstallments,
    financials.amountPerInstallment,
    financials.finalInstallmentAmount
  );

  const { error: installmentError } = await supabase
    .from("installments")
    .insert(
      schedule.map((inst) => ({
        contract_id: contractRow.id,
        installment_number: inst.installmentNumber,
        due_date: inst.dueDate,
        installment_amount: inst.installmentAmount,
        paid_amount: inst.paidAmount,
        remaining_amount: inst.remainingAmount,
        status: inst.status,
      }))
    );

  if (installmentError) {
    // Roll back the contract since the schedule failed to generate —
    // we never want a contract with no installments.
    await supabase.from("contracts").delete().eq("id", contractRow.id);
    throw new ContractServiceError(
      `Failed to generate installment schedule: ${installmentError.message}`
    );
  }

  // Freeze the investor pool that is funding this contract right now.
  // This is a permanent snapshot — profit distribution for this contract
  // will always read from it, never from the live investor list, so an
  // investor who joins later (or adds more capital later) can never end
  // up sharing in profit from a contract that started before they did.
  const { error: snapshotError } = await supabase.rpc(
    "snapshot_contract_investors",
    { p_contract_id: contractRow.id }
  );

  if (snapshotError) {
    // Roll back everything — a contract must never exist without a locked
    // investor pool, otherwise its profit split would be undefined.
    await supabase.from("installments").delete().eq("contract_id", contractRow.id);
    await supabase.from("contracts").delete().eq("id", contractRow.id);
    throw new ContractServiceError(
      `Failed to lock in the investor pool for this contract: ${snapshotError.message}`
    );
  }

  // The RPC above pins contracts.phase_id server-side — refetch so the
  // Contract we return reflects that.
  const { data: refreshedContractRow, error: refetchError } = await supabase
    .from("contracts")
    .select("*")
    .eq("id", contractRow.id)
    .single();

  if (!refetchError && refreshedContractRow) {
    Object.assign(contractRow, refreshedContractRow);
  }

  // Cash-out: the purchase price leaves cash-in-hand the moment a
  // contract is created. Written only after the contract AND its
  // installment schedule both succeeded — a rolled-back contract
  // never happened, so it should never touch the ledger.
  await writeCashLedgerEntry(supabase, {
    entryType: "purchase",
    amount: -values.purchasePrice,
    contractId: contractRow.id,
    entryDate: values.startDate,
    description: `Purchase for contract ${contractRow.contract_code}`,
  });

  return mapContract(contractRow);
}

/**
 * Recomputes and persists a contract's status + overdue_months based on
 * installments. When a contract transitions to COMPLETED for the first
 * time, this also attempts automatic profit distribution.
 *
 * Distribution failure (e.g. no active business phase configured yet)
 * does NOT throw here — the payment that triggered completion must
 * still succeed. The contract simply remains COMPLETED with
 * profit_distributed = false until someone fixes the phase setup and
 * manually triggers distribution from the contract page. This is
 * surfaced back to the caller via the returned `distributionWarning`
 * rather than silently swallowed.
 */
export async function recomputeContractStatus(
  contractId: number,
  injectedClient?: SupabaseClient<Database>
): Promise<{ distributionWarning: string | null }> {
  const supabase = injectedClient ?? (await createClient());

  const { data: installments, error } = await supabase
    .from("installments")
    .select("*")
    .eq("contract_id", contractId);

  if (error) {
    throw new ContractServiceError(
      `Failed to load installments for status recompute: ${error.message}`
    );
  }
  if (!installments || installments.length === 0) {
    return { distributionWarning: null };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const allPaid = installments.every((i) => i.status === "PAID");
  const anyOverdue = installments.some(
    (i) => i.status !== "PAID" && new Date(i.due_date) < today
  );

  let overdueMonths = 0;
  if (anyOverdue) {
    const oldestOverdue = installments
      .filter((i) => i.status !== "PAID" && new Date(i.due_date) < today)
      .sort(
        (a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
      )[0];
    if (oldestOverdue) {
      const diffMs = today.getTime() - new Date(oldestOverdue.due_date).getTime();
      overdueMonths = Math.max(1, Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30)));
    }
  }

  const status = allPaid ? "COMPLETED" : anyOverdue ? "OVERDUE" : "ACTIVE";

  // Fetch current status before overwriting, so we only attempt
  // distribution on the ACTIVE/OVERDUE → COMPLETED transition, not on
  // every recompute call after a contract is already completed.
  const { data: beforeRow, error: beforeError } = await supabase
    .from("contracts")
    .select("status, profit_distributed")
    .eq("id", contractId)
    .single();

  if (beforeError) {
    throw new ContractServiceError(
      `Failed to read current contract status: ${beforeError.message}`
    );
  }

  const { error: updateError } = await supabase
    .from("contracts")
    .update({ status, overdue_months: allPaid ? 0 : overdueMonths })
    .eq("id", contractId);

  if (updateError) {
    throw new ContractServiceError(
      `Failed to update contract status: ${updateError.message}`
    );
  }

  const justCompleted =
    status === "COMPLETED" &&
    beforeRow.status !== "COMPLETED" &&
    !beforeRow.profit_distributed;

  if (!justCompleted) {
    return { distributionWarning: null };
  }

  try {
    const { distributeContractProfit } = await import(
      "./profit-distribution-service"
    );
    await distributeContractProfit(contractId, supabase);
    return { distributionWarning: null };
  } catch (distributionError) {
    const message =
      distributionError instanceof Error
        ? distributionError.message
        : "Unknown error during profit distribution.";
    return {
      distributionWarning: `Contract completed, but profit could not be distributed automatically: ${message}`,
    };
  }
}

/**
 * Sweeps every ACTIVE/OVERDUE contract and recomputes its status.
 *
 * Why this exists: recomputeContractStatus() only ever ran as a
 * side-effect of recording or editing a payment. That's fine for
 * contracts someone is actively paying, but a contract that receives
 * NO payments at all (or goes quiet for a stretch) never got its
 * overdue_months touched again after creation — nothing else in the
 * app calls recomputeContractStatus purely because a calendar month
 * passed. Overdue detection and blacklist status (which reads
 * overdue_months) would silently stay wrong for exactly that case.
 *
 * Intended to be called on a schedule (see /api/cron/recompute-statuses)
 * so overdue status stays correct even for contracts nobody has
 * touched recently. Takes an injected client so it can run under a
 * service-role/cron context without a user session (see
 * lib/supabase/admin.ts) — the RLS policies on `contracts` and
 * `installments` require an authenticated staff session, which a cron
 * invocation doesn't have.
 */
/**
 * Permanently deletes a contract and everything that points at it
 * (installments, payments, payment_edits, investor snapshot, and
 * cash_ledger entries), via the atomic delete_contract() Postgres
 * function — see supabase/sql/004_contract_deletion.sql for the full
 * dependency-order breakdown and why this can't safely be done as
 * several sequential client-side deletes.
 *
 * `reverseCash` controls what happens to cash-in-hand:
 *  - true:  the contract's cash_ledger rows (purchase + any payments
 *           received) are deleted outright — cash-in-hand ends up as
 *           if the contract never existed. Use this for correcting a
 *           mistaken entry.
 *  - false: the cash_ledger rows are kept (cash-in-hand and historical
 *           totals are unaffected) but detached from the contract.
 *           Use this when the contract is being removed for another
 *           reason but the cash it moved was real and should stay
 *           reflected in the books.
 *
 * Blocked entirely (by the Postgres function itself) for COMPLETED
 * contracts whose profit has already been distributed to investors —
 * see the function comment for why that case can't be safely reversed.
 *
 * Requires admin privileges; this is checked both here and again
 * inside the Postgres function.
 */
export async function deleteContract(
  contractId: number,
  reverseCash: boolean
): Promise<void> {
  const { requireAdmin, UserServiceError } = await import("./user-service");
  try {
    await requireAdmin();
  } catch (err) {
    if (err instanceof UserServiceError) {
      throw new ContractServiceError(err.message);
    }
    throw err;
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("delete_contract", {
    p_contract_id: contractId,
    p_reverse_cash: reverseCash,
  });

  if (error) {
    // The Postgres function's RAISE EXCEPTION messages (not found,
    // already distributed, not admin) come through as error.message
    // and are already human-readable.
    throw new ContractServiceError(error.message);
  }
}

export async function recomputeAllContractStatuses(
  injectedClient?: SupabaseClient<Database>
): Promise<{ checked: number; errors: { contractId: number; message: string }[] }> {
  const supabase = injectedClient ?? (await createClient());

  const contracts = await fetchAllRows((from, to) =>
    supabase
      .from("contracts")
      .select("id")
      .in("status", ["ACTIVE", "OVERDUE"])
      .order("id")
      .range(from, to)
  ).catch((err) => {
    throw new ContractServiceError(
      `Failed to list contracts for status sweep: ${err.message}`
    );
  });

  const errors: { contractId: number; message: string }[] = [];

  for (const contract of contracts) {
    try {
      await recomputeContractStatus(contract.id, supabase);
    } catch (err) {
      errors.push({
        contractId: contract.id,
        message: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return { checked: contracts.length, errors };
}