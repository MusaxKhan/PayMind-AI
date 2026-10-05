"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Loader2, WifiOff } from "lucide-react";
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
import { addInvestmentAction } from "@/lib/actions/business-phase-actions";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { OFFLINE_BLOCKED_MESSAGE } from "@/lib/offline/guards";
import type { ActionResult } from "@/lib/actions/client-actions";
import type { Investor } from "@/types/domain";

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Saving...
        </>
      ) : (
        "Add Investment"
      )}
    </Button>
  );
}

export function AddInvestmentDialog({
  phaseId,
  investors,
}: {
  phaseId: number;
  investors: Investor[];
}) {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [open, setOpen] = React.useState(false);
  const [investorId, setInvestorId] = React.useState("");

  const boundAction = React.useCallback(
    (prev: ActionResult | null, formData: FormData) =>
      addInvestmentAction(phaseId, prev, formData),
    [phaseId]
  );

  const [state, formAction] = useActionState(boundAction, null);

  React.useEffect(() => {
    if (state?.success) {
      toast.success("Investment recorded.");
      setOpen(false);
      setInvestorId("");
      router.refresh();
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          disabled={investors.length === 0 || !isOnline}
          title={!isOnline ? OFFLINE_BLOCKED_MESSAGE.add_investment : undefined}
        >
          {isOnline ? <Plus className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
          {isOnline ? "Add Investment" : "Needs Connection"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Investor Investment</DialogTitle>
          <DialogDescription>
            Only the investment amount is stored — percentages are
            calculated automatically from the total.
          </DialogDescription>
        </DialogHeader>

        {!isOnline && (
          <Badge variant="overdue" className="flex w-fit items-center gap-1.5">
            <WifiOff className="h-3.5 w-3.5" />
            {OFFLINE_BLOCKED_MESSAGE.add_investment}
          </Badge>
        )}

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="investorId" value={investorId} />

          <div className="space-y-1.5">
            <Label htmlFor="investor-select">Investor</Label>
            <Select value={investorId} onValueChange={setInvestorId} required>
              <SelectTrigger id="investor-select">
                <SelectValue placeholder="Select an investor" />
              </SelectTrigger>
              <SelectContent>
                {investors.map((investor) => (
                  <SelectItem key={investor.id} value={String(investor.id)}>
                    {investor.name}
                    {!investor.active && " (inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {investorId &&
              investors.find((i) => String(i.id) === investorId)?.active ===
                false && (
                <p className="text-xs text-status-partial">
                  This investor is marked inactive. You can still record an
                  investment for them if that&apos;s intentional.
                </p>
              )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="investmentAmount">Investment Amount (Rs.)</Label>
            <Input
              id="investmentAmount"
              name="investmentAmount"
              type="number"
              min="0.01"
              step="0.01"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="investmentDate">Investment Date</Label>
            <Input
              id="investmentDate"
              name="investmentDate"
              type="date"
              defaultValue={new Date().toISOString().split("T")[0]}
              max={new Date().toISOString().split("T")[0]}
            />
            <p className="text-xs text-muted-foreground">
              When the money actually came in. This investor only shares in
              profit from contracts that start on or after this date.
            </p>
          </div>

          {state?.error && (
            <p className="rounded-md bg-status-overdue-bg px-3 py-2 text-sm text-status-overdue">
              {state.error}
            </p>
          )}

          <DialogFooter>
            <SubmitButton disabled={!isOnline} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
