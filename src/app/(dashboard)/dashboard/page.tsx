import Link from "next/link";
import {
  FileText,
  AlertTriangle,
  Users,
  Landmark,
  TrendingUp,
  Wallet,
  Coins,
  AlertCircle,
  ArrowRight,
  Sparkles,
  HandCoins,
  CheckCircle2,
  BarChart3,
  Receipt,
  Handshake,
  BellRing,
} from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { ContractStatusBadge } from "@/components/shared/status-badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getDashboardStats } from "@/lib/services/dashboard-service";
import { getStorageUsage } from "@/lib/services/storage-usage-service";
import { getGivenLoanDashboardSummary } from "@/lib/services/given-loan-service";
import { StorageUsageCard } from "@/components/shared/storage-usage-card";
import { listContracts } from "@/lib/services/contract-service";
import { getActiveBusinessPhase } from "@/lib/services/business-phase-service";
import { formatPKR, formatDate } from "@/lib/utils/format";
import { ExportDialog } from "@/components/export/export-dialog";
import { listBusinessPhases } from "@/lib/services/business-phase-service";

export default async function DashboardPage() {
  const [
    stats,
    overdueContracts,
    activePhase,
    phases,
    storageUsage,
    givenLoans,
  ] = await Promise.all([
    getDashboardStats(),
    listContracts({ status: "OVERDUE" }),
    getActiveBusinessPhase(),
    listBusinessPhases(),
    // Falls back to null (rendered as a "run this migration" note)
    // rather than crashing the whole dashboard if migration 005
    // hasn't been applied yet.
    getStorageUsage().catch(() => null),
    // Null (and no notifier) rather than a crashed dashboard if the
    // Loans Given migration (011) hasn't been applied yet.
    getGivenLoanDashboardSummary().catch(() => null),
  ]);

  // Quick mathematical metrics for modern UI highlights
  const totalProfits = stats.totalProfitGenerated || 1;
  const payoutRatio = Math.min(Math.round(((stats.totalProfitDistributed || 0) / totalProfits) * 100), 100);

  return (
    <div className="space-y-8 p-2 max-w-[1600px] mx-auto animate-in fade-in duration-500">
      
      {/* 1. Header Section with Quick Stats Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-black tracking-tight text-foreground">Dashboard</h1>
            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse mt-1" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mt-0.5">
            Sitara Traders operational insights and capital distribution framework.
          </p>
        </div>
        
        {/* Dynamic Context Tag */}
        <div className="flex items-center gap-3 self-start md:self-center">
        {/* View Graphs Button */}
        <Button variant="outline" size="sm" asChild>
          <Link href="/graphs">
            <BarChart3 className="h-4 w-4" />
            View Stats Through Graph
          </Link>
        </Button>

        {/* Export Button */}
        <ExportDialog phases={phases} />

        {/* Active Phase Badge */}
        <div className="flex items-center gap-2 bg-muted border border-border rounded-xl p-1.5 pr-3">
          <div className="bg-card text-foreground p-1.5 rounded-lg shadow-sm text-xs font-bold flex items-center gap-1">
            <Sparkles className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
            Active Phase:
          </div>

          <span className="text-xs font-black text-foreground">
            {activePhase ? activePhase.phaseName : "None Configured"}
          </span>
        </div>
      </div>
      </div>

      {/* Loans Given notifier: overdue repayments, or ones due this week */}
      {givenLoans && (givenLoans.overdueCount > 0 || givenLoans.dueSoonCount > 0) && (
        <Card
          className={
            givenLoans.overdueCount > 0
              ? "border-rose-500/30 bg-gradient-to-r from-rose-500/10 to-transparent shadow-sm rounded-2xl overflow-hidden relative"
              : "border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-transparent shadow-sm rounded-2xl overflow-hidden relative"
          }
        >
          <div
            className={
              givenLoans.overdueCount > 0
                ? "absolute top-0 bottom-0 left-0 w-1 bg-rose-500"
                : "absolute top-0 bottom-0 left-0 w-1 bg-amber-500"
            }
          />
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6">
            <div
              className={
                givenLoans.overdueCount > 0
                  ? "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 shadow-sm"
                  : "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-sm"
              }
            >
              <BellRing className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-foreground">
                {givenLoans.overdueCount > 0
                  ? `${givenLoans.overdueCount} loan${givenLoans.overdueCount === 1 ? "" : "s"} you gave ${givenLoans.overdueCount === 1 ? "is" : "are"} overdue (${formatPKR(givenLoans.overdueAmount)})`
                  : `${givenLoans.dueSoonCount} loan repayment${givenLoans.dueSoonCount === 1 ? " is" : "s are"} due within 7 days`}
              </p>
              <p className="text-xs font-medium text-muted-foreground mt-0.5 leading-relaxed">
                {givenLoans.worstOverdue.length > 0
                  ? givenLoans.worstOverdue
                      .map((l) => `${l.borrowerName} (${l.overdueMonths}mo, ${formatPKR(l.overdueAmount)})`)
                      .join(" · ")
                  : "Open Loans Given to see who is due and when."}
                {givenLoans.overdueCount > 0 && givenLoans.dueSoonCount > 0 &&
                  ` · plus ${givenLoans.dueSoonCount} more due within 7 days`}
              </p>
            </div>
            <Button size="sm" variant="outline" className="rounded-xl font-bold self-start sm:self-center" asChild>
              <Link href={givenLoans.overdueCount > 0 ? "/given-loans?status=OVERDUE" : "/given-loans?status=ACTIVE"}>
                Check status
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Warning Notification Banner */}
      {!activePhase && (
        <Card className="border-amber-500/25 bg-gradient-to-r from-amber-500/10 to-transparent shadow-sm rounded-2xl overflow-hidden relative">
          <div className="absolute top-0 bottom-0 left-0 w-1 bg-amber-500" />
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 shadow-sm">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">System Capital Flow Halt</p>
              <p className="text-xs font-medium text-amber-700/90 dark:text-amber-400/90 mt-0.5 leading-relaxed">
                No active business phase discovered. Closed contracts cannot issue dynamic payouts to investors until an operation window is initiated.
              </p>
            </div>
            <Button size="sm" className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400 shadow-sm rounded-xl font-bold self-start sm:self-center" asChild>
              <Link href="/phases/new">Initialize New Phase</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* 2. Primary 2-Column Split Master Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        
        {/* LEFT TWO-THIRDS: Core Operational Metrics & Focus Lists */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* Subheading Group: Core Operations */}
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground mb-3">Core Operational Metrics</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <StatCard label="Ongoing Contracts" value={String(stats.totalActiveContracts)} icon={FileText} variant="blue" href="/contracts?status=ACTIVE" />
              <StatCard label="Total Registered Clients" value={String(stats.totalClients)} icon={Users} variant="cyan" href="/clients" />
              <StatCard label="Outstanding Amount" value={formatPKR(stats.totalOutstandingAmount)} icon={Wallet} hint="Across active & overdue items" variant="indigo" href="/contracts" />
              <StatCard label="Critical Overdue Contracts" value={String(stats.totalOverdueContracts)} icon={AlertTriangle} variant="rose" href="/contracts?status=OVERDUE" />
              <StatCard label="Completed Contracts" value={String(stats.totalCompletedContracts)} icon={CheckCircle2} variant="emerald" href="/contracts?status=COMPLETED" />
              <StatCard label="Cash in Hand" value={formatPKR(stats.cashInHand)} icon={Wallet} hint="Available for next purchases" variant="emerald" href="/cash-ledger" />
              <StatCard label="Outstanding Loans" value={formatPKR(stats.totalOutstandingLoans)} icon={HandCoins} hint="Borrowed, not yet repaid" variant="amber" href="/loans" />
              {givenLoans && (
                <StatCard label="Loans Given (Owed to Us)" value={formatPKR(givenLoans.totalOutstanding)} icon={Handshake} hint={`${givenLoans.activeCount} open${givenLoans.overdueCount > 0 ? `, ${givenLoans.overdueCount} overdue` : ""}`} variant="violet" href="/given-loans" />
              )}
              <StatCard label="Total Expenses" value={formatPKR(stats.totalExpenses)} icon={Receipt} hint="Contract purchases + business expenses" variant="rose" href="/expenses" />
            </div>
          </div>

          {/* Overdue List Block with detailed presentation items */}
          <Card className="border-border shadow-sm bg-card rounded-2xl overflow-hidden transition-all duration-300 hover:shadow-md">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-5 border-b border-border">
              <div>
                <CardTitle className="text-lg font-black text-foreground flex items-center gap-2">
                  Action Required
                  {overdueContracts.length > 0 && (
                    <span className="inline-flex items-center rounded-lg bg-rose-500/10 px-2 py-0.5 text-xs font-bold text-rose-700 dark:text-rose-400 ring-1 ring-inset ring-rose-500/20">
                      {overdueContracts.length} Overdue
                    </span>
                  )}
                </CardTitle>
                <CardDescription className="text-xs font-medium text-muted-foreground mt-0.5">
                  Collection queues sorted by descending time deltas.
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" className="border-border text-muted-foreground hover:bg-muted font-bold rounded-xl group" asChild>
                <Link href="/contracts?status=OVERDUE" className="flex items-center gap-1">
                  View Overdue Contracts
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </Button>
            </CardHeader>
            
            <CardContent className="p-0">
              {overdueContracts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 px-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500/10 text-emerald-500 dark:text-emerald-400 flex items-center justify-center mb-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <p className="text-sm font-bold text-foreground">Portfolio fully functional</p>
                  <p className="text-xs font-medium text-muted-foreground mt-0.5">No overdue contracts.</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {overdueContracts.slice(0, 4).map((contract) => (
                    <Link
                      key={contract.id}
                      href={`/contracts/${contract.id}`}
                      className="flex items-center justify-between gap-4 px-6 py-4 transition-all hover:bg-muted/60 group"
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-black text-foreground group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
                          {contract.client.name}
                          <span className="text-xs font-bold text-muted-foreground ml-2 bg-muted border border-border px-1.5 py-0.5 rounded">
                            {contract.contractCode}
                          </span>
                        </p>
                        <div className="text-xs font-bold text-muted-foreground flex items-center gap-2 flex-wrap">
                          <span className="text-foreground/80 font-extrabold">{contract.productName}</span>
                          <span>•</span>
                          <span className="text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.2 rounded font-black">
                            {contract.overdueMonths}m overdue
                          </span>
                          <span>•</span>
                          <span className="font-medium text-muted-foreground">Started {formatDate(contract.startDate)}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-black tabular-nums text-rose-600 dark:text-rose-400">
                          {formatPKR(contract.remainingBalance)}
                        </span>
                        <div className="shadow-sm rounded-md overflow-hidden">
                          <ContractStatusBadge status={contract.status} />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT ONE-THIRD: Capital Infrastructure Sidebar Panel */}
        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-black uppercase tracking-wider text-muted-foreground mb-3">Capital Distribution</h3>
            <div className="space-y-4">
              <StatCard label="Total Capital Investors" value={String(stats.totalInvestors)} icon={Landmark} variant="violet" href="/investors" />
              <StatCard label="Active Investment" value={formatPKR(stats.activePhaseInvestmentTotal)} icon={Landmark} hint={activePhase ? activePhase.phaseName : "No active cycle"} variant="slate" href={activePhase ? `/phases/${activePhase.id}` : "/phases"} />
            </div>
          </div>

          {/* Performance Yield Analysis Panel */}
          <Card className="border-border shadow-sm bg-gradient-to-b from-card via-card to-muted/40 rounded-2xl overflow-hidden relative">
            <CardHeader className="pb-4 border-b border-border bg-card">
              <CardTitle className="text-sm font-black uppercase tracking-wider text-muted-foreground">Yield Analytics</CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              
              {/* Yield Stat Item 1 */}
              <Link href="/contracts?status=COMPLETED" className="flex justify-between items-center group/yield">
                <div>
                  <p className="text-xs font-bold text-muted-foreground transition-colors">Gross Profits Generated</p>
                  <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">{formatPKR(stats.totalProfitGenerated)}</p>
                </div>
                <div className="h-9 w-9 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center transition-transform group-hover/yield:scale-105">
                  <TrendingUp className="h-4 w-4 stroke-[2.5]" />
                </div>
              </Link>

              {/* Yield Stat Item 2 */}
              <Link href="/distributions" className="flex justify-between items-center group/yield">
                <div>
                  <p className="text-xs font-bold text-muted-foreground transition-colors">Profit Distributed</p>
                  <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">{formatPKR(stats.totalProfitDistributed)}</p>
                </div>
                <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center transition-transform group-hover/yield:scale-105">
                  <Coins className="h-4 w-4 stroke-[2.5]" />
                </div>
              </Link>

              {/* Functional Dynamic Progress Component */}
              <div className="space-y-2 pt-2 border-t border-border">
                <div className="flex justify-between text-xs font-bold">
                  <span className="text-muted-foreground">Profit Shared with Investors</span>
                  <span className="text-foreground">{payoutRatio}%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-gradient-to-r from-amber-500 to-emerald-500 dark:from-amber-400 dark:to-emerald-400 h-full rounded-full transition-all duration-500"
                    style={{ width: `${payoutRatio}%` }}
                  />
                </div>
                <p className="text-[11px] font-medium text-muted-foreground leading-normal">
                  Proportion of completed contract returns dispersed back to capitalization channels.
                </p>
              </div>

            </CardContent>
          </Card>

          <StorageUsageCard usage={storageUsage} />
        </div>

      </div>
    </div>
  );
}