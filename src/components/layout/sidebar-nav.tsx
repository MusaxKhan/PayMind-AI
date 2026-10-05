"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileText,
  Wallet,
  UserCog,
  PiggyBank,
  CalendarRange,
  Coins,
  Banknote,
  CloudOff,
  HandCoins,
  BarChart3,
  Receipt,
  Handshake,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/types/domain";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/graphs", label: "Stats & Graphs", icon: BarChart3 },
      { href: "/sync", label: "Sync Queue", icon: CloudOff },
    ],
  },
  {
    label: "Business",
    items: [
      { href: "/clients", label: "Clients", icon: Users },
      { href: "/contracts", label: "Contracts", icon: FileText },
      { href: "/payments", label: "Payments", icon: Wallet },
      { href: "/loans", label: "Loans", icon: HandCoins },
      { href: "/given-loans", label: "Loans Given", icon: Handshake },
      { href: "/expenses", label: "Expenses", icon: Receipt },
      { href: "/cash-ledger", label: "Cash Ledger", icon: Coins },
    ],
  },
  {
    label: "Investors",
    items: [
      { href: "/investors", label: "Investors", icon: PiggyBank },
      { href: "/phases", label: "Business Phases", icon: CalendarRange },
      { href: "/distributions", label: "Distributions", icon: Coins },
      { href: "/withdrawals", label: "Withdrawals", icon: Banknote },
    ],
  },
  {
    label: "Admin",
    items: [{ href: "/users", label: "Team", icon: UserCog, adminOnly: true }],
  },
];

export function SidebarNav({ role }: { role: UserRole }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      {NAV_GROUPS.map((group) => {
        const visibleItems = group.items.filter(
          (item) => !item.adminOnly || role === "admin"
        );
        if (visibleItems.length === 0) return null;

        return (
          <div key={group.label}>
            <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <div className="flex flex-col gap-1">
              {visibleItems.map((item) => {
                const isActive =
                  pathname === item.href || pathname.startsWith(item.href + "/");
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-secondary text-primary dark:shadow-[inset_3px_0_0_0_var(--primary)]"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarBrand() {
  return (
    <div className="flex items-center gap-2 px-4 py-5">
      <Image
        src="/icons/icon-192.png"
        alt="Sitara Traders logo"
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 rounded-md dark:shadow-[0_0_16px_-2px_rgba(214,164,78,0.55)]"
        priority
      />
      <div>
        <p className="text-sm font-semibold leading-none text-foreground">
          Sitara Traders
        </p>
        <p className="text-xs text-muted-foreground">Installment Manager</p>
      </div>
    </div>
  );
}