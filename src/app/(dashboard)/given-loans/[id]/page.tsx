import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GivenLoanPaymentDialog } from "@/components/given-loans/given-loan-payment-dialog";
import { DeleteGivenLoanButton } from "@/components/given-loans/delete-given-loan-button";
import { getGivenLoanById } from "@/lib/services/given-loan-service";
import { formatDate, formatPKR } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

const STATUS_BADGE = {
  ACTIVE: { variant: "active", label: "Active" },
  OVERDUE: { variant: "overdue", label: "Overdue" },
  COMPLETED: { variant: "completed", label: "Completed" },
} as const;

const INSTALLMENT_BADGE = {
  PENDING: { variant: "pending", label: "Pending" },
  PARTIAL: { variant: "partial", label: "Partial" },
  PAID: { variant: "completed", label: "Paid" },
} as const;

export default async function GivenLoanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const loanId = Number(id);
  if (!Number.isInteger(loanId)) notFound();

  const loan = await getGivenLoanById(loanId);
  if (!loan) notFound();

  const badge = STATUS_BADGE[loan.status];
  const paidCount = loan.installments.filter((i) => i.status === "PAID").length;
  const nextUnpaid = loan.installments.find((i) => i.status !== "PAID");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/given-loans">
          <ArrowLeft className="h-4 w-4" />
          Back to loans given
        </Link>
      </Button>

      <Card className={cn(loan.status === "OVERDUE" && "border-status-overdue/40")}>
        <CardHeader className="flex-row items-start justify-between space-y-0">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {loan.loanCode}
            </p>
            <CardTitle className="mt-1 text-xl">{loan.borrowerName}</CardTitle>
            <CardDescription>
              {loan.clientId ? (
                <Link href={`/clients/${loan.clientId}`} className="hover:underline">
                  Existing client
                </Link>
              ) : (
                "Not a registered client"
              )}
              {loan.borrowerPhone && ` · ${loan.borrowerPhone}`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={badge.variant}>{badge.label}</Badge>
            <DeleteGivenLoanButton
              givenLoanId={loan.id}
              loanCode={loan.loanCode}
              borrowerName={loan.borrowerName}
              amount={loan.amount}
              amountRepaid={loan.amountRepaid}
              redirectTo="/given-loans"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loan.status === "OVERDUE" && (
            <p className="text-sm font-medium text-status-overdue">
              {formatPKR(loan.overdueAmount)} is overdue, {loan.overdueMonths}{" "}
              {loan.overdueMonths === 1 ? "month" : "months"} past the oldest due date.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Loan Amount</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatPKR(loan.amount)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Received So Far</dt>
              <dd className="mt-0.5 text-sm font-semibold tabular-nums text-status-completed">
                {formatPKR(loan.amountRepaid)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Still Owed</dt>
              <dd
                className={cn(
                  "mt-0.5 text-sm font-semibold tabular-nums",
                  loan.status === "OVERDUE" && "text-status-overdue"
                )}
              >
                {formatPKR(loan.outstandingBalance)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Installments</dt>
              <dd className="mt-0.5 text-sm font-medium">
                {loan.numberOfInstallments === 1
                  ? "Lump sum"
                  : `${paidCount} of ${loan.numberOfInstallments} paid`}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Loan Date</dt>
              <dd className="mt-0.5 text-sm font-medium">{formatDate(loan.loanDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Expected End</dt>
              <dd className="mt-0.5 text-sm font-medium">{formatDate(loan.expectedEndDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Next Due</dt>
              <dd className="mt-0.5 text-sm font-medium">{formatDate(loan.nextDueDate)}</dd>
            </div>
          </dl>
          {loan.reason && (
            <div>
              <dt className="text-xs text-muted-foreground">Reason / notes</dt>
              <dd className="mt-0.5 text-sm text-foreground">{loan.reason}</dd>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Repayment Schedule</CardTitle>
          {loan.status !== "COMPLETED" && (
            <GivenLoanPaymentDialog
              givenLoanId={loan.id}
              outstandingBalance={loan.outstandingBalance}
              nextInstallmentAmount={nextUnpaid?.remainingAmount ?? 0}
              loanDate={loan.loanDate}
            />
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Paid</TableHead>
                <TableHead>Remaining</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loan.installments.map((inst) => {
                const b = inst.isOverdue
                  ? ({ variant: "overdue", label: "Overdue" } as const)
                  : INSTALLMENT_BADGE[inst.status];
                return (
                  <TableRow
                    key={inst.id}
                    className={cn(inst.isOverdue && "bg-status-overdue-bg/40")}
                  >
                    <TableCell className="text-muted-foreground">{inst.installmentNumber}</TableCell>
                    <TableCell>{formatDate(inst.dueDate)}</TableCell>
                    <TableCell className="tabular-nums">{formatPKR(inst.installmentAmount)}</TableCell>
                    <TableCell className="tabular-nums text-status-completed">
                      {formatPKR(inst.paidAmount)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {inst.remainingAmount > 0 ? formatPKR(inst.remainingAmount) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={b.variant}>{b.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Payment History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loan.payments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No payments received yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Balance After</TableHead>
                  <TableHead>Remarks</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loan.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{formatDate(p.paymentDate)}</TableCell>
                    <TableCell className="tabular-nums font-medium text-status-completed">
                      {formatPKR(p.amountPaid)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.paymentMethod ?? "—"}</TableCell>
                    <TableCell className="tabular-nums">{formatPKR(p.remainingBalance)}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {p.remarks ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
