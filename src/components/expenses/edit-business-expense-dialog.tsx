"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Pencil, Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateBusinessExpenseAction } from "@/lib/actions/business-expense-actions";
import { toDateInputValue } from "@/lib/utils/format";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { OFFLINE_BLOCKED_MESSAGE } from "@/lib/offline/guards";
import { BUSINESS_EXPENSE_CATEGORY_LABELS } from "@/types/domain";
import { BUSINESS_EXPENSE_CATEGORIES } from "@/lib/validations/business-expense";
import type { BusinessExpense } from "@/types/domain";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Saving...
        </>
      ) : (
        "Save Changes"
      )}
    </Button>
  );
}

export function EditBusinessExpenseDialog({
  expense,
}: {
  expense: BusinessExpense;
}) {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [open, setOpen] = React.useState(false);
  const [category, setCategory] = React.useState<string>(expense.category);

  const updateAction = updateBusinessExpenseAction.bind(null, expense.id);
  const [state, formAction] = useActionState(updateAction, null);

  // Reset the category picker back to the expense's saved value whenever
  // the dialog is (re)opened, so a cancelled edit doesn't leave a stray
  // selection behind for next time.
  React.useEffect(() => {
    if (open) setCategory(expense.category);
  }, [open, expense.category]);

  React.useEffect(() => {
    if (state?.success) {
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          if (!isOnline) return;
          setOpen(true);
        }}
        disabled={!isOnline}
        title={
          !isOnline ? OFFLINE_BLOCKED_MESSAGE.update_business_expense : "Edit"
        }
      >
        {!isOnline ? (
          <WifiOff className="h-4 w-4" />
        ) : (
          <Pencil className="h-4 w-4" />
        )}
      </Button>

      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
          <DialogDescription>
            Changes here update this expense everywhere it&apos;s reflected —
            cash-in-hand, the cash ledger, the dashboard, and the graphs
            page.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="space-y-5">
          {!isOnline && (
            <Badge
              variant="overdue"
              className="flex w-fit items-center gap-1.5"
            >
              <WifiOff className="h-3.5 w-3.5" />
              {OFFLINE_BLOCKED_MESSAGE.update_business_expense}
            </Badge>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input
              id="edit-title"
              name="title"
              required
              defaultValue={expense.title}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="edit-amount">Amount (Rs.)</Label>
              <Input
                id="edit-amount"
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                defaultValue={expense.amount}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-expenseDate">Expense Date</Label>
              <Input
                id="edit-expenseDate"
                name="expenseDate"
                type="date"
                required
                defaultValue={toDateInputValue(new Date(expense.expenseDate))}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-category-select">Category</Label>
            <input type="hidden" name="category" value={category} />
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="edit-category-select">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {BUSINESS_EXPENSE_CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-notes">Notes (optional)</Label>
            <Textarea
              id="edit-notes"
              name="notes"
              placeholder="Any extra detail"
              defaultValue={expense.notes ?? ""}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-receiptReference">
              Receipt Reference (optional)
            </Label>
            <Input
              id="edit-receiptReference"
              name="receiptReference"
              placeholder="Receipt #, invoice #, or a note on where it's filed"
              defaultValue={expense.receiptReference ?? ""}
            />
          </div>

          <p className="rounded-md bg-status-partial-bg px-3 py-2 text-sm text-status-partial">
            If the new amount doesn&apos;t leave enough in cash-in-hand,
            the edit is refused and nothing changes.
          </p>

          {state?.error && (
            <p className="rounded-md bg-status-overdue-bg px-3 py-2 text-sm text-status-overdue">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <SubmitButton />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}