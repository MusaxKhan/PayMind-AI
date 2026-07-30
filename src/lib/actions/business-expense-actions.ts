"use server";

import { revalidatePath } from "next/cache";
import {
  createBusinessExpense,
  updateBusinessExpense,
  BusinessExpenseServiceError,
} from "@/lib/services/business-expense-service";
import {
  businessExpenseSchema,
  businessExpenseEditSchema,
} from "@/lib/validations/business-expense";
import type { ActionResult } from "./client-actions";

export async function createBusinessExpenseAction(
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = businessExpenseSchema.safeParse({
    title: formData.get("title"),
    amount: formData.get("amount"),
    category: formData.get("category"),
    expenseDate: formData.get("expenseDate"),
    notes: formData.get("notes"),
    receiptReference: formData.get("receiptReference"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    await createBusinessExpense(parsed.data);
  } catch (err) {
    if (err instanceof BusinessExpenseServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/graphs");
  revalidatePath("/cash-ledger");
  return { success: true };
}

export async function updateBusinessExpenseAction(
  expenseId: number,
  _prev: ActionResult | null,
  formData: FormData
): Promise<ActionResult> {
  const parsed = businessExpenseEditSchema.safeParse({
    expenseId,
    title: formData.get("title"),
    amount: formData.get("amount"),
    category: formData.get("category"),
    expenseDate: formData.get("expenseDate"),
    notes: formData.get("notes"),
    receiptReference: formData.get("receiptReference"),
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  try {
    await updateBusinessExpense(parsed.data);
  } catch (err) {
    if (err instanceof BusinessExpenseServiceError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  // Same pages as create — this expense's amount/date/category all feed
  // into these, and an edit needs to invalidate them just as much as a
  // brand-new expense does, or they'll keep showing the pre-edit numbers.
  revalidatePath("/expenses");
  revalidatePath("/dashboard");
  revalidatePath("/graphs");
  revalidatePath("/cash-ledger");
  return { success: true };
}