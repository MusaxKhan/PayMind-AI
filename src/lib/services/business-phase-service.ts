import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import {
  mapBusinessPhase,
  mapInvestorPhaseInvestment,
} from "./mappers";
import { round2 } from "@/lib/utils/calculations";
import { writeCashLedgerEntry } from "./cash-ledger-service";
import type { BusinessPhaseRow } from "@/types/database";
import type {
  BusinessPhase,
  BusinessPhaseWithTotals,
  InvestorPhaseInvestmentWithPercent,
} from "@/types/domain";
import type { BusinessPhaseFormValues } from "@/lib/validations/business-phase";

export class BusinessPhaseServiceError extends Error {}

export async function listBusinessPhases(): Promise<BusinessPhaseWithTotals[]> {
  const supabase = await createClient();

  let phasesData: BusinessPhaseRow[];
  let investmentsData: { phase_id: number; investment_amount: number }[];

  try {
    [phasesData, investmentsData] = await Promise.all([
      fetchAllRows((from, to) =>
        supabase
          .from("business_phases")
          .select("*")
          .order("start_date", { ascending: false })
          .range(from, to)
      ),
      fetchAllRows((from, to) =>
        supabase
          .from("investor_phase_investments")
          .select("phase_id, investment_amount")
          .range(from, to)
      ),
    ]);
  } catch (err) {
    throw new BusinessPhaseServiceError(
      `Failed to list business phases: ${err instanceof Error ? err.message : "Unknown error"}`
    );
  }

  const totalsByPhase = new Map<number, { total: number; count: number }>();
  for (const row of investmentsData) {
    const existing = totalsByPhase.get(row.phase_id) ?? { total: 0, count: 0 };
    totalsByPhase.set(row.phase_id, {
      total: existing.total + Number(row.investment_amount),
      count: existing.count + 1,
    });
  }

  return phasesData.map((row) => {
    const phase = mapBusinessPhase(row);
    const totals = totalsByPhase.get(row.id) ?? { total: 0, count: 0 };
    return {
      ...phase,
      totalInvestment: totals.total,
      investorCount: totals.count,
    };
  });
}

export async function getActiveBusinessPhase(): Promise<BusinessPhase | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("business_phases")
    .select("*")
    .eq("status", "ACTIVE")
    .order("start_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new BusinessPhaseServiceError(
      `Failed to fetch active phase: ${error.message}`
    );
  }
  return data ? mapBusinessPhase(data) : null;
}

export async function getBusinessPhaseById(
  id: number
): Promise<BusinessPhaseWithTotals | null> {
  const all = await listBusinessPhases();
  return all.find((p) => p.id === id) ?? null;
}

export async function getPhaseInvestments(
  phaseId: number
): Promise<InvestorPhaseInvestmentWithPercent[]> {
  const supabase = await createClient();

  const rows = await fetchAllRows((from, to) =>
    supabase
      .from("investor_phase_investments")
      .select("*, investor:investors(name)")
      .eq("phase_id", phaseId)
      .order("investment_amount", { ascending: false })
      .range(from, to)
  ).catch((err) => {
    throw new BusinessPhaseServiceError(
      `Failed to load phase investments: ${err.message}`
    );
  });

  const total = rows.reduce((sum, r) => sum + Number(r.investment_amount), 0);

  return rows.map((row) => {
    const mapped = mapInvestorPhaseInvestment(row);
    return {
      ...mapped,
      investorName: row.investor.name,
      // Dynamically calculated — never stored, per the spec's explicit
      // requirement that only investment amounts are persisted.
      percentOfPhase: total > 0 ? round2((mapped.investmentAmount / total) * 100) : 0,
    };
  });
}

/**
 * Only one phase may be ACTIVE at a time — opening a new phase
 * automatically closes any currently-active one. This matches how the
 * business actually works (phases are sequential investment periods)
 * and prevents ambiguity in distribute_contract_profit(), which picks
 * "the" active phase.
 */
export async function createBusinessPhase(
  values: BusinessPhaseFormValues
): Promise<BusinessPhase> {
  const supabase = await createClient();

  const { error: closeError } = await supabase
    .from("business_phases")
    .update({ status: "CLOSED", end_date: new Date().toISOString().split("T")[0] })
    .eq("status", "ACTIVE");

  if (closeError) {
    throw new BusinessPhaseServiceError(
      `Failed to close the previous active phase: ${closeError.message}`
    );
  }

  const { data, error } = await supabase
    .from("business_phases")
    .insert({
      phase_name: values.phaseName,
      start_date: values.startDate,
      end_date: values.endDate || null,
      status: "ACTIVE",
    })
    .select("*")
    .single();

  if (error) {
    throw new BusinessPhaseServiceError(
      `Failed to create business phase: ${error.message}`
    );
  }
  return mapBusinessPhase(data);
}

export async function closeBusinessPhase(id: number): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("business_phases")
    .update({
      status: "CLOSED",
      end_date: new Date().toISOString().split("T")[0],
    })
    .eq("id", id);

  if (error) {
    throw new BusinessPhaseServiceError(
      `Failed to close phase: ${error.message}`
    );
  }
}

/**
 * Adds or updates (upsert-by-pair) an investor's investment in a phase.
 * Investment amounts only — percentages are never stored, calculated
 * dynamically by getPhaseInvestments() above.
 */
export async function upsertInvestorPhaseInvestment(values: {
  phaseId: number;
  investorId: number;
  investmentAmount: number;
  /** YYYY-MM-DD the money actually came in; defaults to today. */
  investmentDate?: string;
}): Promise<void> {
  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("investor_phase_investments")
    .select("id, investment_amount")
    .eq("phase_id", values.phaseId)
    .eq("investor_id", values.investorId)
    .maybeSingle();

  if (fetchError) {
    throw new BusinessPhaseServiceError(
      `Failed to check existing investment: ${fetchError.message}`
    );
  }

  if (existing) {
    const { error } = await supabase
      .from("investor_phase_investments")
      .update({ investment_amount: values.investmentAmount })
      .eq("id", existing.id);

    if (error) {
      throw new BusinessPhaseServiceError(
        `Failed to update investment: ${error.message}`
      );
    }

    // Only the CHANGE in investment amount is new cash moving — if an
    // investor's stake goes from 100k to 150k, 50k is new money coming
    // in. If it's reduced, that delta is negative (cash effectively
    // leaving, e.g. correcting an over-entry) and the ledger entry
    // reflects that automatically since amount is signed.
    const delta = round2(
      values.investmentAmount - Number(existing.investment_amount)
    );
    if (delta !== 0) {
      await writeCashLedgerEntry(supabase, {
        entryType: "investment",
        amount: delta,
        investorId: values.investorId,
        investmentId: existing.id,
        entryDate: values.investmentDate,
        description:
          delta > 0
            ? "Increase to existing investment"
            : "Reduction to existing investment",
      });
    }
    return;
  }

  const { data: newInvestment, error } = await supabase
    .from("investor_phase_investments")
    .insert({
      phase_id: values.phaseId,
      investor_id: values.investorId,
      investment_amount: values.investmentAmount,
    })
    .select("id")
    .single();

  if (error) {
    throw new BusinessPhaseServiceError(
      `Failed to record investment: ${error.message}`
    );
  }

  await writeCashLedgerEntry(supabase, {
    entryType: "investment",
    amount: values.investmentAmount,
    investorId: values.investorId,
    investmentId: newInvestment.id,
    entryDate: values.investmentDate,
    description: "New investor investment",
  });
}

export async function removeInvestorPhaseInvestment(
  id: number
): Promise<void> {
  const supabase = await createClient();

  // Guard: if this phase has already funded a profit distribution,
  // silently changing the investment mix after the fact would make
  // past distribution percentages unreconstructable from current data.
  const { data: investment, error: fetchError } = await supabase
    .from("investor_phase_investments")
    .select("phase_id, investor_id, investment_amount")
    .eq("id", id)
    .single();

  if (fetchError) {
    throw new BusinessPhaseServiceError(
      `Investment not found: ${fetchError.message}`
    );
  }

  const { count, error: countError } = await supabase
    .from("profit_distributions")
    .select("id", { count: "exact", head: true })
    .eq("phase_id", investment.phase_id);

  if (countError) {
    throw new BusinessPhaseServiceError(
      `Failed to check phase distribution history: ${countError.message}`
    );
  }

  if ((count ?? 0) > 0) {
    throw new BusinessPhaseServiceError(
      "This phase already has profit distributions recorded against it. Removing an investment now would make past distributions inconsistent with the investment mix — close this phase and start a new one instead."
    );
  }

  const { error } = await supabase
    .from("investor_phase_investments")
    .delete()
    .eq("id", id);

  if (error) {
    throw new BusinessPhaseServiceError(
      `Failed to remove investment: ${error.message}`
    );
  }

  // Reverse the cash-in this investment originally contributed — the
  // investment_id foreign key is now dangling (the row is gone), so
  // this entry is written without one; investor_id alone is enough to
  // trace it back in the ledger view.
  await writeCashLedgerEntry(supabase, {
    entryType: "investment",
    amount: -Number(investment.investment_amount),
    investorId: investment.investor_id,
    description: "Investment removed from phase",
  });
}