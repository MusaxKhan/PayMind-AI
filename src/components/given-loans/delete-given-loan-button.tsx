"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Loader2, WifiOff, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { deleteGivenLoanAction } from "@/lib/actions/given-loan-actions";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { OFFLINE_BLOCKED_MESSAGE } from "@/lib/offline/guards";
import { formatPKR } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type CashMode = "reverse" | "keep";

export function DeleteGivenLoanButton({
  givenLoanId,
  loanCode,
  borrowerName,
  amount,
  amountRepaid,
  redirectTo,
}: {
  givenLoanId: number;
  loanCode: string;
  borrowerName: string;
  amount: number;
  amountRepaid: number;
  /** Where to go after deleting (used from the detail page). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [open, setOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [mode, setMode] = React.useState<CashMode>("keep");
  const hasPayments = amountRepaid > 0;

  async function handleDelete() {
    setIsDeleting(true);
    const result = await deleteGivenLoanAction(
      givenLoanId,
      // With no payments there is nothing to "keep": always fully undo.
      hasPayments ? mode === "reverse" : true
    );
    setIsDeleting(false);

    if (!result.success) {
      toast.error(result.error ?? "Failed to delete loan.");
      return;
    }

    toast.success(`Loan ${loanCode} was deleted.`);
    setOpen(false);
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (!isOnline) {
            toast.error(OFFLINE_BLOCKED_MESSAGE.delete_given_loan);
            return;
          }
          setOpen(true);
        }}
        disabled={!isOnline}
        title={!isOnline ? OFFLINE_BLOCKED_MESSAGE.delete_given_loan : undefined}
      >
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4" />
            Needs Connection
          </>
        ) : (
          <>
            <Trash2 className="h-4 w-4" />
            Delete
          </>
        )}
      </Button>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Delete loan {loanCode} ({borrowerName})?
          </DialogTitle>
          <DialogDescription>
            This permanently removes the loan, its schedule and its payment
            history. It cannot be undone. A full copy is kept in the audit log.
            Admins only.
          </DialogDescription>
        </DialogHeader>

        {!hasPayments ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            No payments have been received on this loan yet, so deleting it
            gives the {formatPKR(amount)} back to cash-in-hand, as if the loan
            was never given.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {formatPKR(amountRepaid)} has already been received back. Choose
              what happens to cash-in-hand:
            </p>

            <button
              type="button"
              onClick={() => setMode("keep")}
              className={cn(
                "w-full rounded-md border p-3 text-left transition-colors",
                mode === "keep"
                  ? "border-accent bg-accent/10"
                  : "border-border hover:bg-muted/40"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Keep the cash history
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cash-in-hand stays exactly as it is. The {formatPKR(amount)}{" "}
                    given out and the {formatPKR(amountRepaid)} received both
                    remain in your books, just no longer tied to a loan record.
                  </p>
                </div>
                {mode === "keep" && <Check className="h-4 w-4 shrink-0 text-accent" />}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setMode("reverse")}
              className={cn(
                "w-full rounded-md border p-3 text-left transition-colors",
                mode === "reverse"
                  ? "border-accent bg-accent/10"
                  : "border-border hover:bg-muted/40"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Fully undo: reverse the cash too
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Both the {formatPKR(amount)} that went out and the{" "}
                    {formatPKR(amountRepaid)} that came back are removed from
                    the ledger, so cash-in-hand ends up as if this loan never
                    happened. Use this only if the loan was recorded by mistake.
                  </p>
                </div>
                {mode === "reverse" && <Check className="h-4 w-4 shrink-0 text-accent" />}
              </div>
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isDeleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Deleting...
              </>
            ) : (
              "Delete loan"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
