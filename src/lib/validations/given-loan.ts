import { z } from "zod";

/** Latest allowed loan/payment date: today in any timezone (matches the
 * +1 day tolerance in the database functions). */
function isNotFuture(value: string): boolean {
  const limit = new Date();
  limit.setDate(limit.getDate() + 1);
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d <= limit;
}

export const givenLoanSchema = z
  .object({
    borrowerType: z.enum(["client", "other"]),
    clientId: z.coerce.number().int().positive().optional(),
    borrowerName: z.string().trim().max(120).optional().or(z.literal("")),
    borrowerPhone: z.string().trim().max(30).optional().or(z.literal("")),
    reason: z.string().trim().max(500).optional().or(z.literal("")),
    amount: z.coerce.number().positive("Amount must be greater than 0"),
    numberOfInstallments: z.coerce
      .number()
      .int("Installments must be a whole number")
      .min(1, "At least 1 installment (1 = lump sum)")
      .max(120, "At most 120 installments"),
    loanDate: z
      .string()
      .min(1, "Loan date is required")
      .refine(isNotFuture, "The loan date cannot be in the future"),
  })
  .superRefine((v, ctx) => {
    if (v.borrowerType === "client" && !v.clientId) {
      ctx.addIssue({ code: "custom", path: ["clientId"], message: "Select a client" });
    }
    if (v.borrowerType === "other" && !v.borrowerName?.trim()) {
      ctx.addIssue({ code: "custom", path: ["borrowerName"], message: "Borrower name is required" });
    }
  });

export type GivenLoanFormValues = z.infer<typeof givenLoanSchema>;

export const givenLoanPaymentSchema = z.object({
  givenLoanId: z.coerce.number().int().positive(),
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  paymentDate: z
    .string()
    .min(1, "Payment date is required")
    .refine(isNotFuture, "The payment date cannot be in the future"),
  paymentMethod: z.string().trim().max(40).optional().or(z.literal("")),
  remarks: z.string().trim().max(500).optional().or(z.literal("")),
});

export type GivenLoanPaymentFormValues = z.infer<typeof givenLoanPaymentSchema>;
