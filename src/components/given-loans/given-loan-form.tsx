"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, UserRound, Users, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createGivenLoanAction } from "@/lib/actions/given-loan-actions";
import { formatDate, formatPKR, toDateInputValue, addMonths } from "@/lib/utils/format";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { OFFLINE_BLOCKED_MESSAGE } from "@/lib/offline/guards";
import { cn } from "@/lib/utils";

interface ClientOption {
  id: number;
  label: string;
}

function SubmitButton({ disabled }: { disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Giving loan...
        </>
      ) : (
        "Give Loan"
      )}
    </Button>
  );
}

export function GivenLoanForm({
  clients,
  cashInHand,
}: {
  clients: ClientOption[];
  cashInHand: number;
}) {
  const router = useRouter();
  const { isOnline } = useOnlineStatus();
  const [state, formAction] = useActionState(createGivenLoanAction, null);

  const [borrowerType, setBorrowerType] = React.useState<"client" | "other">(
    clients.length > 0 ? "client" : "other"
  );
  const [clientId, setClientId] = React.useState("");
  const [amount, setAmount] = React.useState(0);
  const [installments, setInstallments] = React.useState(1);
  const [loanDate, setLoanDate] = React.useState(toDateInputValue(new Date()));

  React.useEffect(() => {
    if (state?.success && state.loanId) {
      toast.success("Loan given. Cash in hand was reduced.");
      router.push(`/given-loans/${state.loanId}`);
    }
  }, [state, router]);

  const n = Math.max(1, Math.floor(installments) || 1);
  const perInstallment = amount > 0 ? Math.round((amount / n) * 100) / 100 : 0;
  const start = loanDate ? new Date(loanDate) : null;
  const firstDue = start && !Number.isNaN(start.getTime()) ? addMonths(start, 1) : null;
  const lastDue = start && !Number.isNaN(start.getTime()) ? addMonths(start, n) : null;
  const notEnoughCash = amount > cashInHand;

  return (
    <form action={formAction} className="space-y-5">
      {!isOnline && (
        <Badge variant="overdue" className="flex w-fit items-center gap-1.5">
          <WifiOff className="h-3.5 w-3.5" />
          {OFFLINE_BLOCKED_MESSAGE.create_given_loan}
        </Badge>
      )}

      <input type="hidden" name="borrowerType" value={borrowerType} />
      <input type="hidden" name="clientId" value={borrowerType === "client" ? clientId : ""} />

      <div className="space-y-2">
        <Label>Who is the borrower?</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { key: "client", label: "Existing client", icon: Users },
              { key: "other", label: "Someone else", icon: UserRound },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setBorrowerType(key)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors",
                borrowerType === key
                  ? "border-accent bg-accent/10 font-medium text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted/40"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {borrowerType === "client" ? (
        <div className="space-y-1.5">
          <Label htmlFor="gl-client">Client</Label>
          <Select value={clientId} onValueChange={setClientId}>
            <SelectTrigger id="gl-client">
              <SelectValue placeholder="Select a client" />
            </SelectTrigger>
            <SelectContent>
              {clients.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="gl-name">Borrower Name</Label>
            <Input id="gl-name" name="borrowerName" maxLength={120} placeholder="Full name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="gl-phone">Phone (optional)</Label>
            <Input id="gl-phone" name="borrowerPhone" maxLength={30} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="gl-amount">Loan Amount (Rs.)</Label>
          <Input
            id="gl-amount"
            name="amount"
            type="number"
            min="0.01"
            step="0.01"
            required
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gl-installments">Installments</Label>
          <Input
            id="gl-installments"
            name="numberOfInstallments"
            type="number"
            min="1"
            max="120"
            step="1"
            required
            value={installments}
            onChange={(e) => setInstallments(Number(e.target.value) || 1)}
          />
          <p className="text-xs text-muted-foreground">1 = paid back in one lump sum</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="gl-loan-date">Loan Date</Label>
          <Input
            id="gl-loan-date"
            name="loanDate"
            type="date"
            required
            max={toDateInputValue(new Date())}
            value={loanDate}
            onChange={(e) => setLoanDate(e.target.value)}
          />
        </div>
      </div>

      {amount > 0 && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">
          <p className="font-medium text-foreground">Repayment plan (no interest)</p>
          <p className="mt-1 text-muted-foreground">
            {n === 1 ? (
              <>
                {formatPKR(amount)} due in one payment on{" "}
                <strong>{formatDate(firstDue)}</strong>.
              </>
            ) : (
              <>
                {n} monthly installments of about <strong>{formatPKR(perInstallment)}</strong>,
                from {formatDate(firstDue)} to {formatDate(lastDue)}. The last one absorbs any
                rounding difference.
              </>
            )}
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="gl-reason">Reason / notes (optional)</Label>
        <Textarea id="gl-reason" name="reason" maxLength={500} placeholder="What this loan is for" />
      </div>

      <div
        className={cn(
          "flex items-start gap-2 rounded-md px-3 py-2 text-sm",
          notEnoughCash
            ? "bg-status-overdue-bg text-status-overdue"
            : "bg-status-partial-bg text-status-partial"
        )}
      >
        {notEnoughCash && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
        <p>
          {notEnoughCash ? (
            <>
              Cash in hand is only <strong>{formatPKR(cashInHand)}</strong>, which is not
              enough for this loan. It will be refused.
            </>
          ) : (
            <>
              This amount is deducted from cash in hand now (currently{" "}
              <strong>{formatPKR(cashInHand)}</strong>
              {amount > 0 && <>, <strong>{formatPKR(cashInHand - amount)}</strong> after</>}).
              Payments you receive are added back.
            </>
          )}
        </p>
      </div>

      {state?.error && (
        <p className="rounded-md bg-status-overdue-bg px-3 py-2 text-sm text-status-overdue">
          {state.error}
        </p>
      )}

      <div className="flex justify-end">
        <SubmitButton disabled={!isOnline || notEnoughCash} />
      </div>
    </form>
  );
}
