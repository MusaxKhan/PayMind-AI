"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createBusinessPhase,
  closeBusinessPhase,
  upsertInvestorPhaseInvestment,
  removeInvestorPhaseInvestment,
  BusinessPhaseServiceError,
} from "@/lib/services/business-phase-service";
import {
  businessPhaseSchema,
  investorPhaseInvestmentSchema,
} from "@/lib/validations/business-phase";
import type { ActionResult } from "./client-actions";

export async function createBusinessPhaseAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = businessPhaseSchema.safeParse({
    phaseName: formData.get("phaseName"),
    startDate: formData.get("startDate"),
    endDate: formData.get("endDate"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  let newPhaseId: number;
  try {
    const phase = await createBusinessPhase(parsed.data);
    newPhaseId = phase.id;
  } catch (err) {
    if (err instanceof BusinessPhaseServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath("/phases");
  redirect(`/phases/${newPhaseId}`);
}

export async function closeBusinessPhaseAction(
  id: number
): Promise<ActionResult> {
  try {
    await closeBusinessPhase(id);
  } catch (err) {
    if (err instanceof BusinessPhaseServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath("/phases");
  revalidatePath(`/phases/${id}`);
  return { success: true };
}

export async function addInvestmentAction(
  phaseId: number,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = investorPhaseInvestmentSchema.safeParse({
    phaseId,
    investorId: formData.get("investorId"),
    investmentAmount: formData.get("investmentAmount"),
    investmentDate: formData.get("investmentDate") ?? undefined,
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    await upsertInvestorPhaseInvestment({
      ...parsed.data,
      investmentDate: parsed.data.investmentDate || undefined,
    });
  } catch (err) {
    if (err instanceof BusinessPhaseServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(`/phases/${phaseId}`);
  revalidatePath("/investors");
  // upsertInvestorPhaseInvestment writes an "investment" cash_ledger
  // entry (or a delta entry on update) — same reasoning as the other
  // cash-moving actions.
  revalidatePath("/dashboard");
  revalidatePath("/cash-ledger");
  revalidatePath("/graphs");
  return { success: true };
}

export async function removeInvestmentAction(
  investmentId: number,
  phaseId: number
): Promise<ActionResult> {
  try {
    await removeInvestorPhaseInvestment(investmentId);
  } catch (err) {
    if (err instanceof BusinessPhaseServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath(`/phases/${phaseId}`);
  revalidatePath("/investors");
  revalidatePath("/dashboard");
  revalidatePath("/cash-ledger");
  revalidatePath("/graphs");
  return { success: true };
}