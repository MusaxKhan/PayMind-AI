"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { recordGivenLoanPaymentAction } from "@/lib/actions/given-loan-actions";
import { formatPKR, toDateInputValue } from "@/lib/utils/format";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { OFFLINE_BLOCKED_MESSAGE } from "@/lib/offline/guards";
import type { ActionResult } from "@/lib/actions/client-actions";

function SubmitButton({ isOnline }: { isOnline: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || !isOnline}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Recording...
        </>
      ) : (
        "Record Payment"
      )}
    </Button>
  );
}

export function GivenLoanPaymentDialog({
  givenLoanId,
  outstandingBalance,
  nextInstallmentAmount,
  loanDate,
}: {
  givenLoanId: number;
  outstandingBalance: number;
  /** Remaining amount of the oldest unpaid installment, used as the default. */
  nextInstallmentAmount: number;
  loanDate: string;
}) {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [open, setOpen] = React.useState(false);

  const boundAction = React.useCallback(
    (prev: ActionResult | null, formData: FormData) =>
      recordGivenLoanPaymentAction(givenLoanId, prev, formData),
    [givenLoanId]
  );
  const [state, formAction] = useActionState(boundAction, null);

  React.useEffect(() => {
    if (state?.success) {
      toast.success("Payment recorded. Cash in hand was updated.");
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          disabled={outstandingBalance <= 0 || !isOnline}
          title={!isOnline ? OFFLINE_BLOCKED_MESSAGE.record_given_loan_payment : undefined}
        >
          {isOnline ? <Banknote className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          Record Payment
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment Received</DialogTitle>
          <DialogDescription>
            Still owed: <strong>{formatPKR(outstandingBalance)}</strong>. A payment
            can be larger than one installment: it spreads across the next ones,
            oldest first.
          </DialogDescription>
        </DialogHeader>

        {!isOnline && (
          <Badge variant="overdue" className="flex w-fit items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5" />
            {OFFLINE_BLOCKED_MESSAGE.record_given_loan_payment}
          </Badge>
        )}

        <form action={formAction} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="gl-amount">Amount (Rs.)</Label>
              <Input
                id="gl-amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                max={outstandingBalance}
                defaultValue={nextInstallmentAmount > 0 ? nextInstallmentAmount : undefined}
                required
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="gl-date">Payment Date</Label>
              <Input
                id="gl-date"
                name="paymentDate"
                type="date"
                required
                min={loanDate}
                max={toDateInputValue(new Date())}
                defaultValue={toDateInputValue(new Date())}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gl-method">Payment Method</Label>
            <Select name="paymentMethod" defaultValue="Cash">
              <SelectTrigger id="gl-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Cash">Cash</SelectItem>
                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                <SelectItem value="JazzCash">JazzCash</SelectItem>
                <SelectItem value="Easypaisa">Easypaisa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="gl-remarks">Remarks (optional)</Label>
            <Input id="gl-remarks" name="remarks" maxLength={500} />
          </div>

          {state?.error && (
            <p className="rounded-md bg-status-overdue-bg px-3 py-2 text-sm text-status-overdue">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <SubmitButton isOnline={isOnline} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
