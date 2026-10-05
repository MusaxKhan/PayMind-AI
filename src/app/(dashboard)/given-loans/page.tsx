import Link from "next/link";
import { Plus, Handshake, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listGivenLoans } from "@/lib/services/given-loan-service";
import type { GivenLoanStatus } from "@/lib/services/given-loan-service";
import { getCashInHand } from "@/lib/services/cash-ledger-service";
import { formatDate, formatPKR } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const FILTERS: { key: "ALL" | GivenLoanStatus; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "COMPLETED", label: "Completed" },
];

const STATUS_BADGE: Record<
  GivenLoanStatus,
  { variant: "active" | "overdue" | "completed"; label: string }
> = {
  ACTIVE: { variant: "active", label: "Active" },
  OVERDUE: { variant: "overdue", label: "Overdue" },
  COMPLETED: { variant: "completed", label: "Completed" },
};

export default async function GivenLoansPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active: "ALL" | GivenLoanStatus =
    status && ["ACTIVE", "OVERDUE", "COMPLETED"].includes(status.toUpperCase())
      ? (status.toUpperCase() as GivenLoanStatus)
      : "ALL";

  const [allLoans, cashInHand] = await Promise.all([listGivenLoans(), getCashInHand()]);
  const loans = active === "ALL" ? allLoans : allLoans.filter((l) => l.status === active);

  const open = allLoans.filter((l) => l.status !== "COMPLETED");
  const totalOwed = open.reduce((s, l) => s + l.outstandingBalance, 0);
  const overdueCount = allLoans.filter((l) => l.status === "OVERDUE").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Loans Given</h1>
          <p className="text-sm text-muted-foreground">
            Money lent out · {formatPKR(totalOwed)} still owed to you
            {overdueCount > 0 && (
              <span className="font-medium text-status-overdue">
                {" "}
                · {overdueCount} overdue
              </span>
            )}
          </p>
        </div>
        <Button asChild>
          <Link href="/given-loans/new">
            <Plus className="h-4 w-4" />
            Give Loan
          </Link>
        </Button>
      </div>

      <Card className="border-status-completed/40 bg-status-completed-bg">
        <CardContent className="flex items-center gap-3 p-4">
          <Wallet className="h-5 w-5 text-status-completed" />
          <div>
            <p className="text-xs text-muted-foreground">Current Cash in Hand</p>
            <p className="text-lg font-bold tabular-nums text-foreground">
              {formatPKR(cashInHand)}
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            asChild
            size="sm"
            variant={active === f.key ? "default" : "outline"}
          >
            <Link href={f.key === "ALL" ? "/given-loans" : `/given-loans?status=${f.key}`}>
              {f.label}
            </Link>
          </Button>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {loans.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Handshake className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {active === "ALL"
                  ? "No loans given yet."
                  : `No ${active.toLowerCase()} loans.`}
              </p>
              {active === "ALL" && (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/given-loans/new">Give your first loan</Link>
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loan</TableHead>
                  <TableHead>Borrower</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Received</TableHead>
                  <TableHead>Still Owed</TableHead>
                  <TableHead>Next Due</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.map((loan) => {
                  const badge = STATUS_BADGE[loan.status];
                  return (
                    <TableRow
                      key={loan.id}
                      className={cn(loan.status === "OVERDUE" && "bg-status-overdue-bg/40")}
                    >
                      <TableCell>
                        <Link
                          href={`/given-loans/${loan.id}`}
                          className="font-medium text-foreground hover:underline"
                        >
                          {loan.loanCode}
                        </Link>
                        <p className="text-xs text-muted-foreground">{formatDate(loan.loanDate)}</p>
                      </TableCell>
                      <TableCell>
                        {loan.clientId ? (
                          <Link href={`/clients/${loan.clientId}`} className="hover:underline">
                            {loan.borrowerName}
                          </Link>
                        ) : (
                          loan.borrowerName
                        )}
                      </TableCell>
                      <TableCell className="tabular-nums">{formatPKR(loan.amount)}</TableCell>
                      <TableCell className="tabular-nums text-status-completed">
                        {formatPKR(loan.amountRepaid)}
                      </TableCell>
                      <TableCell className="tabular-nums font-semibold">
                        {formatPKR(loan.outstandingBalance)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(loan.nextDueDate)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant}>
                          {badge.label}
                          {loan.status === "OVERDUE" &&
                            ` · ${loan.overdueMonths}mo`}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
