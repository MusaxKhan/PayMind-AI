import Link from "next/link";
import { ArrowDownCircle, ArrowUpCircle, ChevronRight, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listCashLedgerEntries,
  getCashInHand,
} from "@/lib/services/cash-ledger-service";
import { formatDate, formatPKR } from "@/lib/utils/format";
import type { CashLedgerEntryType } from "@/lib/services/cash-ledger-service";

const ENTRY_LABELS: Record<CashLedgerEntryType, string> = {
  investment: "Investor investment",
  loan: "Loan taken",
  payment_received: "Payment received",
  purchase: "Contract purchase",
  withdrawal: "Investor withdrawal",
  loan_repayment: "Loan repayment",
  business_expense: "Business expense",
};

const CASH_IN_TYPES: CashLedgerEntryType[] = ["investment", "loan", "payment_received"];

/**
 * Resolves a cash ledger entry to the page for whatever it actually
 * came from. Contracts have their own /contracts/[id] detail page, so
 * those link straight there. Loans, business expenses, and investor
 * withdrawals don't have dedicated detail pages — they're rows in a
 * list — so those link to the relevant list page with a URL fragment
 * (e.g. #loan-12) pointing at that specific row; the corresponding
 * list pages give each row a matching `id` so the browser scrolls
 * straight to it and the sitara-target-highlight CSS (globals.css)
 * flashes it briefly.
 */
function resolveEntryHref(entry: {
  entryType: CashLedgerEntryType;
  contractId: number | null;
  loanId: number | null;
  businessExpenseId: number | null;
  investorId: number | null;
  withdrawalId: number | null;
}): string | null {
  switch (entry.entryType) {
    case "payment_received":
    case "purchase":
      return entry.contractId ? `/contracts/${entry.contractId}` : null;
    case "loan":
    case "loan_repayment":
      return entry.loanId ? `/loans#loan-${entry.loanId}` : null;
    case "business_expense":
      return entry.businessExpenseId
        ? `/expenses#expense-${entry.businessExpenseId}`
        : null;
    case "withdrawal":
      return entry.investorId
        ? `/investors/${entry.investorId}${
            entry.withdrawalId ? `#withdrawal-${entry.withdrawalId}` : ""
          }`
        : null;
    case "investment":
      return entry.investorId ? `/investors/${entry.investorId}` : null;
    default:
      return null;
  }
}

export default async function CashLedgerPage() {
  const [entries, cashInHand] = await Promise.all([
    listCashLedgerEntries({ limit: 200 }),
    getCashInHand(),
  ]);

  // Entries come back newest-first; compute each row's running balance
  // by walking backwards from the current total.
  let runningBalance = cashInHand;
  const rowsWithBalance = entries.map((entry) => {
    const balanceAfter = runningBalance;
    runningBalance = runningBalance - entry.amount;
    return { ...entry, balanceAfter };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Cash Ledger</h1>
        <p className="text-sm text-muted-foreground">
          Every movement of cash in or out of the business, in order —
          this is where the Cash in Hand number on your dashboard comes
          from.
        </p>
      </div>

      <Card className="border-status-completed/40 bg-status-completed-bg">
        <CardContent className="flex items-center gap-3 p-5">
          <Wallet className="h-6 w-6 text-status-completed" />
          <div>
            <p className="text-xs text-muted-foreground">
              Current Cash in Hand
            </p>
            <p className="text-2xl font-bold tabular-nums text-foreground">
              {formatPKR(cashInHand)}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Movements</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rowsWithBalance.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No cash movements recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Cash in Hand</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rowsWithBalance.map((entry) => {
                  const isCashIn = CASH_IN_TYPES.includes(entry.entryType);
                  const href = resolveEntryHref(entry);
                  return (
                    <TableRow
                      key={entry.id}
                      className={href ? "cursor-pointer hover:bg-muted/50" : undefined}
                    >
                      <TableCell className="text-muted-foreground">
                        {href ? (
                          <Link href={href} className="block">
                            {formatDate(entry.entryDate)}
                          </Link>
                        ) : (
                          formatDate(entry.entryDate)
                        )}
                      </TableCell>
                      <TableCell>
                        {href ? (
                          <Link href={href} className="block">
                            <Badge variant={isCashIn ? "completed" : "overdue"}>
                              <span className="flex items-center gap-1">
                                {isCashIn ? (
                                  <ArrowUpCircle className="h-3 w-3" />
                                ) : (
                                  <ArrowDownCircle className="h-3 w-3" />
                                )}
                                {ENTRY_LABELS[entry.entryType]}
                              </span>
                            </Badge>
                          </Link>
                        ) : (
                          <Badge variant={isCashIn ? "completed" : "overdue"}>
                            <span className="flex items-center gap-1">
                              {isCashIn ? (
                                <ArrowUpCircle className="h-3 w-3" />
                              ) : (
                                <ArrowDownCircle className="h-3 w-3" />
                              )}
                              {ENTRY_LABELS[entry.entryType]}
                            </span>
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-muted-foreground">
                        {href ? (
                          <Link
                            href={href}
                            className="flex items-center gap-1 hover:text-accent hover:underline"
                          >
                            <span className="truncate">
                              {entry.description ?? "—"}
                            </span>
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          </Link>
                        ) : (
                          (entry.description ?? "—")
                        )}
                      </TableCell>
                      <TableCell
                        className={`tabular-nums font-medium ${
                          isCashIn ? "text-status-completed" : "text-status-overdue"
                        }`}
                      >
                        {isCashIn ? "+" : ""}
                        {formatPKR(entry.amount)}
                      </TableCell>
                      <TableCell className="tabular-nums font-semibold">
                        {formatPKR(entry.balanceAfter)}
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