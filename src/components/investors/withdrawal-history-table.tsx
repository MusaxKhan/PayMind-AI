import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, formatPKR } from "@/lib/utils/format";
import type { Withdrawal } from "@/types/domain";

export function WithdrawalHistoryTable({
  withdrawals,
}: {
  withdrawals: (Withdrawal & { remainingBalance: number })[];
}) {
  if (withdrawals.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No withdrawals recorded yet.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Remaining Profit</TableHead>
          <TableHead>Reason</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {withdrawals.map((w) => (
          <TableRow key={w.id} id={`withdrawal-${w.id}`}>
            <TableCell>{formatDate(w.withdrawalDate)}</TableCell>
            <TableCell className="tabular-nums font-medium text-status-overdue">
              −{formatPKR(w.amount)}
            </TableCell>
            <TableCell className="tabular-nums font-semibold">
              {formatPKR(w.remainingBalance)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {w.reason || "—"}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}