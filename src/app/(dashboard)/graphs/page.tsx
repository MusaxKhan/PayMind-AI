"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Loader2,
  TrendingUp,
  PieChartIcon,
  BarChart3,
  Wallet,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { fetchGraphsData } from "@/lib/actions/graphs-actions";
import { formatPKR } from "@/lib/utils/format";
import type { GraphsData } from "@/lib/services/graphs-service";

// CSS custom properties, not literal hex — these track the active
// theme (light/dark) automatically since they resolve at paint time,
// the same way the rest of the app's colors do. A hardcoded hex here
// would silently freeze the charts in light-theme colors regardless of
// which theme is active, exactly the kind of drift that made these
// charts unreadable against a dark background before this fix.
const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "var(--status-active)",
  OVERDUE: "var(--status-overdue)",
  COMPLETED: "var(--status-completed)",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  OVERDUE: "Overdue",
  COMPLETED: "Completed",
};

function formatTooltipPKR(
  value: number | string | readonly (string | number)[] | undefined
): string {
  if (value === undefined) return "—";
  const num = Array.isArray(value) ? Number(value[0]) : Number(value);
  return formatPKR(num);
}

function formatInvestmentShare(percent: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(percent * 100);
}

export default function GraphsPage() {
  const [data, setData] = React.useState<GraphsData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    fetchGraphsData()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load graphs."))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/dashboard">
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-semibold text-foreground">
          Statistics & Trends
        </h1>
        <p className="text-sm text-muted-foreground">
          A visual look at cash flow, contracts, and profit over time.
        </p>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <Loader2 className="h-6 w-6 animate-spin text-accent" />
          <p className="text-sm text-muted-foreground">Crunching the numbers...</p>
        </div>
      )}

      {error && (
        <Card className="border-status-overdue/40 bg-status-overdue-bg">
          <CardContent className="p-4 text-sm text-status-overdue">{error}</CardContent>
        </Card>
      )}

      {data && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Cash flow trend — full width */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-accent" />
                Cash in Hand — Last 12 Months
              </CardTitle>
              <CardDescription>
                Running balance, plus monthly cash in vs cash out.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.cashFlow.every((p) => p.cashIn === 0 && p.cashOut === 0) ? (
                <EmptyChartState message="No cash movements recorded yet." />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={data.cashFlow}>
                    <defs>
                      <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={formatTooltipPKR}
                      contentStyle={{
                        borderRadius: 8,
                        fontSize: 12,
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--popover-foreground)" }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                    />
                    <Area
                      type="monotone"
                      dataKey="runningBalance"
                      name="Cash in Hand"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      fill="url(#balanceGradient)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Monthly collections */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BarChart3 className="h-4 w-4 text-status-completed" />
                Monthly Collections
              </CardTitle>
              <CardDescription>Payments collected from clients each month.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.monthlyCollections.every((p) => p.amountCollected === 0) ? (
                <EmptyChartState message="No payments recorded yet." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.monthlyCollections}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      formatter={formatTooltipPKR}
                      contentStyle={{
                        borderRadius: 8,
                        fontSize: 12,
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--popover-foreground)" }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                    />
                    <Bar dataKey="amountCollected" name="Collected" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Contract status breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChartIcon className="h-4 w-4 text-violet-600" />
                Contracts by Status
              </CardTitle>
              <CardDescription>How your contract portfolio breaks down right now.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.contractStatus.length === 0 ? (
                <EmptyChartState message="No contracts yet." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.contractStatus}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={95}
                      paddingAngle={3}
                      label={(props: unknown) => {
                        const p = props as { status?: string; count?: number };
                        return `${STATUS_LABELS[p.status ?? ""] ?? p.status}: ${p.count}`;
                      }}
                      labelLine={false}
                    >
                      {data.contractStatus.map((entry) => (
                        <Cell
                          key={entry.status}
                          fill={STATUS_COLORS[entry.status] ?? "var(--muted-foreground)"}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => [
                        String(value),
                        STATUS_LABELS[String(name)] ?? String(name),
                      ]}
                      contentStyle={{
                        borderRadius: 8,
                        fontSize: 12,
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--popover-foreground)" }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Investor capital breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChartIcon className="h-4 w-4 text-amber-600" />
                Active Phase Capital Breakdown
              </CardTitle>
              <CardDescription>Each investor&apos;s share of the active investment phase.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.investorCapital.length === 0 ? (
                <EmptyChartState message="No active phase investments yet." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.investorCapital}
                      dataKey="amount"
                      nameKey="investorName"
                      cx="50%"
                      cy="50%"
                      outerRadius={95}
                      label={(props: { investorName?: string; percent?: number }) =>
                        `${props.investorName}: ${formatInvestmentShare(props.percent ?? 0)}%`
                      }
                      labelLine={false}
                    >
                      {data.investorCapital.map((entry, i) => (
                        <Cell key={entry.investorName} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={formatTooltipPKR}
                      contentStyle={{
                        borderRadius: 8,
                        fontSize: 12,
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--popover-foreground)" }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Profit generated vs distributed */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wallet className="h-4 w-4 text-emerald-600" />
                Profit: Generated vs Distributed
              </CardTitle>
              <CardDescription>How much profit has been earned vs actually paid out.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.profitComparison[0].generated === 0 &&
              data.profitComparison[0].distributed === 0 ? (
                <EmptyChartState message="No profit generated yet." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.profitComparison} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                    />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={formatTooltipPKR}
                      contentStyle={{
                        borderRadius: 8,
                        fontSize: 12,
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--popover-foreground)" }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                    />
                    <Legend />
                    <Bar dataKey="generated" name="Generated" fill="var(--chart-2)" radius={[0, 4, 4, 0]} />
                    <Bar dataKey="distributed" name="Distributed" fill="var(--chart-3)" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
          {/* Expense breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <PieChartIcon className="h-4 w-4 text-rose-600" />
                Expense Breakdown
              </CardTitle>
              <CardDescription>
                Contract product purchases plus every business expense category.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.expenseBreakdown.length === 0 ? (
                <EmptyChartState message="No expenses recorded yet." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={data.expenseBreakdown}
                      dataKey="amount"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      outerRadius={95}
                      label={(props: { label?: string; percent?: number }) =>
                        `${props.label}: ${((props.percent ?? 0) * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                    >
                      {data.expenseBreakdown.map((entry, i) => (
                        <Cell key={entry.label} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={formatTooltipPKR}
                      contentStyle={{
                        borderRadius: 8,
                        fontSize: 12,
                        background: "var(--popover)",
                        borderColor: "var(--border)",
                        color: "var(--popover-foreground)",
                      }}
                      labelStyle={{ color: "var(--popover-foreground)" }}
                      itemStyle={{ color: "var(--popover-foreground)" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function EmptyChartState({ message }: { message: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
