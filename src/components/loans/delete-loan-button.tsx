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
import { deleteLoanAction } from "@/lib/actions/loan-actions";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { OFFLINE_BLOCKED_MESSAGE } from "@/lib/offline/guards";
import { formatPKR } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

type CashMode = "reverse" | "keep";

export function DeleteLoanButton({
  loanId,
  lenderName,
  amount,
  amountRepaid,
}: {
  loanId: number;
  lenderName: string;
  amount: number;
  amountRepaid: number;
}) {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [open, setOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const hasRepayments = amountRepaid > 0;
  const [mode, setMode] = React.useState<CashMode>("keep");

  async function handleDelete() {
    setIsDeleting(true);
    const result = await deleteLoanAction(
      loanId,
      // With no repayments there's nothing to "keep" — always fully undo.
      hasRepayments ? mode === "reverse" : true
    );
    setIsDeleting(false);

    if (!result.success) {
      toast.error(result.error ?? "Failed to delete loan.");
      return;
    }

    toast.success(`Loan from ${lenderName} was deleted.`);
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (!isOnline) {
            toast.error(OFFLINE_BLOCKED_MESSAGE.delete_loan);
            return;
          }
          setOpen(true);
        }}
        disabled={!isOnline}
        title={!isOnline ? OFFLINE_BLOCKED_MESSAGE.delete_loan : undefined}
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
          <DialogTitle>Delete loan from {lenderName}?</DialogTitle>
          <DialogDescription>
            This permanently removes the loan record. This cannot be
            undone.
          </DialogDescription>
        </DialogHeader>

        {!hasRepayments ? (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            No repayments have been recorded against this loan yet, so
            there&apos;s nothing to reconcile — deleting it will also
            reverse the {formatPKR(amount)} it brought in, taking that
            amount back out of cash-in-hand as if this loan was never
            taken.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This loan has {formatPKR(amountRepaid)} in recorded
              repayments. Choose what should happen to cash-in-hand and
              your other totals:
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
                    Cash-in-hand and your totals stay exactly as they are
                    — the {formatPKR(amount)} borrowed and the{" "}
                    {formatPKR(amountRepaid)} repaid both remain
                    reflected in your books, just no longer tied to a
                    loan record. Use this if the money involved was
                    real and you&apos;re only removing the loan record
                    itself (e.g. it was settled outside the system, or
                    you&apos;re cleaning up old records).
                  </p>
                </div>
                {mode === "keep" && (
                  <Check className="h-4 w-4 shrink-0 text-accent" />
                )}
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
                    Fully undo — reverse the cash too
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cash-in-hand is adjusted as if this loan never
                    happened: the {formatPKR(amount)} inflow and the{" "}
                    {formatPKR(amountRepaid)} in repayments are both
                    removed from the ledger. Refused if cash-in-hand
                    doesn&apos;t have enough left to cover reversing the
                    outstanding portion. Use this only if the loan was
                    recorded by mistake and none of this cash movement
                    actually reflects reality.
                  </p>
                </div>
                {mode === "reverse" && (
                  <Check className="h-4 w-4 shrink-0 text-accent" />
                )}
              </div>
            </button>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={isDeleting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isDeleting}
          >
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