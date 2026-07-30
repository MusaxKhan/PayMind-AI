import { z } from "zod";

export const BUSINESS_EXPENSE_CATEGORIES = [
  "rent",
  "utilities",
  "salaries",
  "fuel_transport",
  "office_supplies",
  "maintenance_repair",
  "marketing",
  "taxes_fees",
  "other",
] as const;

export const businessExpenseSchema = z.object({
  title: z.string().trim().min(2, "Title is required"),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  category: z.enum(BUSINESS_EXPENSE_CATEGORIES, {
    message: "Category is required",
  }),
  expenseDate: z.string().min(1, "Expense date is required"),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
  receiptReference: z.string().trim().max(300).optional().or(z.literal("")),
});

export type BusinessExpenseFormValues = z.infer<typeof businessExpenseSchema>;

export const businessExpenseEditSchema = businessExpenseSchema.extend({
  expenseId: z.coerce.number().int().positive(),
});

export type BusinessExpenseEditFormValues = z.infer<
  typeof businessExpenseEditSchema
>;