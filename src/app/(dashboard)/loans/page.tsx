import Link from "next/link";
import { Plus, Landmark, Wallet } from "lucide-react";
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
import { LoanRepaymentDialog } from "@/components/loans/loan-repayment-dialog";
import { listLoans } from "@/lib/services/loan-service";
import { getCashInHand } from "@/lib/services/cash-ledger-service";
import { formatDate, formatPKR } from "@/lib/utils/format";

export default async function LoansPage() {
  const [loans, cashInHand] = await Promise.all([listLoans(), getCashInHand()]);
  const totalOutstanding = loans.reduce((sum, l) => sum + l.outstandingBalance, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Loans</h1>
          <p className="text-sm text-muted-foreground">
            {loans.length} {loans.length === 1 ? "loan" : "loans"} ·{" "}
            {formatPKR(totalOutstanding)} outstanding
          </p>
        </div>
        <Button asChild>
          <Link href="/loans/new">
            <Plus className="h-4 w-4" />
            New Loan
          </Link>
        </Button>
      </div>

      <Card className="border-status-completed/40 bg-status-completed-bg">
        <CardContent className="flex items-center gap-3 p-4">
          <Wallet className="h-5 w-5 text-status-completed" />
          <div>
            <p className="text-xs text-muted-foreground">
              Current Cash in Hand
            </p>
            <p className="text-lg font-bold tabular-nums text-foreground">
              {formatPKR(cashInHand)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {loans.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Landmark className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                No loans recorded yet.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-2">
                <Link href="/loans/new">Record your first loan</Link>
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lender</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Repaid</TableHead>
                  <TableHead>Outstanding</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loans.map((loan) => (
                  <TableRow key={loan.id} id={`loan-${loan.id}`}>
                    <TableCell className="font-medium text-foreground">
                      {loan.lenderName}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatPKR(loan.amount)}
                    </TableCell>
                    <TableCell className="tabular-nums text-status-completed">
                      {formatPKR(loan.amountRepaid)}
                    </TableCell>
                    <TableCell className="tabular-nums font-semibold">
                      {formatPKR(loan.outstandingBalance)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={loan.status === "REPAID" ? "completed" : "partial"}>
                        {loan.status === "REPAID" ? "Repaid" : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(loan.loanDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <LoanRepaymentDialog
                        loanId={loan.id}
                        outstandingBalance={loan.outstandingBalance}
                        cashInHand={cashInHand}
                      />
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