"use server";

import { revalidatePath } from "next/cache";
import {
  createGivenLoan,
  recordGivenLoanPayment,
  deleteGivenLoan,
  GivenLoanServiceError,
} from "@/lib/services/given-loan-service";
import {
  givenLoanSchema,
  givenLoanPaymentSchema,
} from "@/lib/validations/given-loan";
import type { ActionResult } from "./client-actions";

// Every action here moves cash (or removes the record of it), so all of them
// refresh the same set of cash-derived pages.
function revalidateCashPages(givenLoanId?: number) {
  revalidatePath("/given-loans");
  if (givenLoanId) revalidatePath(`/given-loans/${givenLoanId}`);
  revalidatePath("/dashboard");
  revalidatePath("/cash-ledger");
  revalidatePath("/graphs");
}

export async function createGivenLoanAction(
  _prev: (ActionResult & { loanId?: number }) | null,
  formData: FormData
): Promise<ActionResult & { loanId?: number }> {
  const parsed = givenLoanSchema.safeParse({
    borrowerType: formData.get("borrowerType"),
    clientId: formData.get("clientId") || undefined,
    borrowerName: formData.get("borrowerName"),
    borrowerPhone: formData.get("borrowerPhone"),
    reason: formData.get("reason"),
    amount: formData.get("amount"),
    numberOfInstallments: formData.get("numberOfInstallments"),
    loanDate: formData.get("loanDate"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    const loan = await createGivenLoan(parsed.data);
    revalidateCashPages();
    return { success: true, loanId: loan.id };
  } catch (err) {
    if (err instanceof GivenLoanServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }
}

export async function recordGivenLoanPaymentAction(
  givenLoanId: number,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = givenLoanPaymentSchema.safeParse({
    givenLoanId,
    amount: formData.get("amount"),
    paymentDate: formData.get("paymentDate"),
    paymentMethod: formData.get("paymentMethod"),
    remarks: formData.get("remarks"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    await recordGivenLoanPayment(parsed.data);
  } catch (err) {
    if (err instanceof GivenLoanServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidateCashPages(givenLoanId);
  return { success: true };
}

export async function deleteGivenLoanAction(
  givenLoanId: number,
  reverseCash: boolean
): Promise<ActionResult> {
  try {
    await deleteGivenLoan(givenLoanId, reverseCash);
  } catch (err) {
    if (err instanceof GivenLoanServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidateCashPages();
  return { success: true };
}
