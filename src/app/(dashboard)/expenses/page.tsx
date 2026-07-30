import Link from "next/link";
import { Plus, Receipt, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ContractStatusBadge } from "@/components/shared/status-badge";
import { EditBusinessExpenseDialog } from "@/components/expenses/edit-business-expense-dialog";
import {
  listBusinessExpenses,
  listContractPurchaseExpenses,
  getTotalExpenses,
} from "@/lib/services/business-expense-service";
import { formatDate, formatPKR } from "@/lib/utils/format";
import { BUSINESS_EXPENSE_CATEGORY_LABELS } from "@/types/domain";

export default async function ExpensesPage() {
  const [businessExpenses, contractPurchases, totalExpenses] =
    await Promise.all([
      listBusinessExpenses(),
      listContractPurchaseExpenses(),
      getTotalExpenses(),
    ]);

  const totalBusinessExpenses = businessExpenses.reduce(
    (sum, e) => sum + e.amount,
    0
  );
  const totalContractPurchases = contractPurchases.reduce(
    (sum, c) => sum + c.purchasePrice,
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Everything spent — contract product purchases and business
            expenses, in one place.
          </p>
        </div>
        <Button asChild>
          <Link href="/expenses/new">
            <Plus className="h-4 w-4" />
            New Expense
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Total Expenses
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {formatPKR(totalExpenses)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Contract Purchases
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {formatPKR(totalContractPurchases)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-medium text-muted-foreground">
              Business Expenses
            </p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
              {formatPKR(totalBusinessExpenses)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="business">
        <TabsList>
          <TabsTrigger value="business">
            <Receipt className="h-4 w-4" />
            Business Expenses
          </TabsTrigger>
          <TabsTrigger value="purchases">
            <ShoppingBag className="h-4 w-4" />
            Contract Purchases
          </TabsTrigger>
        </TabsList>

        <TabsContent value="business">
          <Card>
            <CardContent className="p-0">
              {businessExpenses.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <Receipt className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No business expenses recorded yet.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Notes / Receipt</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {businessExpenses.map((e) => (
                      <TableRow key={e.id} id={`expense-${e.id}`}>
                        <TableCell>{formatDate(e.expenseDate)}</TableCell>
                        <TableCell className="font-medium text-foreground">
                          {e.title}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {BUSINESS_EXPENSE_CATEGORY_LABELS[e.category]}
                          </Badge>
                        </TableCell>
                        <TableCell className="tabular-nums font-medium text-status-overdue">
                          −{formatPKR(e.amount)}
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-muted-foreground">
                          {[e.notes, e.receiptReference]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <EditBusinessExpenseDialog expense={e} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchases">
          <Card>
            <CardContent className="p-0">
              {contractPurchases.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-16 text-center">
                  <ShoppingBag className="h-8 w-8 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    No contracts yet.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Contract</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Purchase Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contractPurchases.map((c) => (
                      <TableRow key={c.contractId}>
                        <TableCell>{formatDate(c.purchaseDate)}</TableCell>
                        <TableCell>
                          <Link
                            href={`/contracts/${c.contractId}`}
                            className="font-medium text-accent hover:underline"
                          >
                            {c.contractCode}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-foreground">
                            {c.productName}
                          </p>
                          {c.productDescription && (
                            <p className="max-w-[220px] truncate text-xs text-muted-foreground">
                              {c.productDescription}
                            </p>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.clientName}
                        </TableCell>
                        <TableCell>
                          <ContractStatusBadge status={c.status} />
                        </TableCell>
                        <TableCell className="tabular-nums font-medium text-status-overdue">
                          −{formatPKR(c.purchasePrice)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}