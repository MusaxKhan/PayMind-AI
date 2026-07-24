"use client";

import * as React from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Users as UsersIcon, WifiOff } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { getClientsList } from "@/lib/actions/client-picker-actions";
import { offlineDb } from "@/lib/offline/db";
import { useOnlineStatus } from "@/lib/offline/use-online-status";
import { formatDate } from "@/lib/utils/format";
import { normalizeSearchTerm } from "@/lib/utils/search";
import { cn } from "@/lib/utils";
import { BlacklistBadge } from "@/components/shared/blacklist-badge";
import type { ClientWithBlacklistStatus } from "@/types/domain";

function normalizeNumber(value: string): string {
  return value.replace(/\D/g, "");
}

export default function ClientsPage() {
  const { isOnline } = useOnlineStatus();
  const [search, setSearch] = React.useState("");
  const [onlineClients, setOnlineClients] = React.useState<ClientWithBlacklistStatus[] | null>(null);
  const [isLoadingOnline, setIsLoadingOnline] = React.useState(false);

  // Online path: fetch fresh from the server, same as before.
  React.useEffect(() => {
    if (!isOnline) return;
    let cancelled = false;
    setIsLoadingOnline(true);
    getClientsList(search)
      .then((data) => {
        if (!cancelled) setOnlineClients(data);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingOnline(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOnline, search]);

  // Offline path: read straight from the Dexie cache. useLiveQuery keeps
  // this reactive — if the cache refreshes in the background once
  // connectivity returns, this list updates on its own.
  const cachedClients = useLiveQuery(
    () =>
      offlineDb.clients
        .filter((c) => {
          if (c.isDeleted) return false;

          const term = normalizeSearchTerm(search);
          if (!term) return true;

          const numericTerm = normalizeNumber(term);
          return (
            c.name.toLowerCase().includes(term) ||
            c.clientCode.toLowerCase().includes(term) ||
            (c.cnic ?? "").toLowerCase().includes(term) ||
            (c.phone ?? "").toLowerCase().includes(term) ||
            normalizeNumber(c.cnic ?? "").includes(numericTerm) ||
            normalizeNumber(c.phone ?? "").includes(numericTerm)
          );
        })
        .toArray(),
    [search]
  );

  const clients = isOnline ? onlineClients : cachedClients;
  const isLoading = isOnline ? isLoadingOnline && onlineClients === null : clients === undefined;

  function hasCreatedAt(
    c: ClientWithBlacklistStatus | { updatedAt: string }
  ): c is ClientWithBlacklistStatus {
    return "createdAt" in c;
  }

  // Normalize both shapes (server Client has createdAt, cached CachedClient
  // only has updatedAt) into one display-safe shape up front, rather than
  // narrowing inline in the JSX below.
  const rows = (clients ?? []).map((c) => ({
    id: c.id,
    clientCode: c.clientCode,
    name: c.name,
    cnic: c.cnic,
    phone: c.phone,
    dateLabel: hasCreatedAt(c) ? c.createdAt : c.updatedAt,
    isBlacklisted: c.isBlacklisted,
    maxOverdueMonths: c.maxOverdueMonths,
  }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {clients ? rows.length : "—"}{" "}
            {rows.length === 1 ? "client" : "clients"} on record
          </p>
        </div>
        <Button asChild>
          <Link href="/clients/new">
            <Plus className="h-4 w-4" />
            New Client
          </Link>
        </Button>
      </div>

      {!isOnline && (
        <Badge variant="overdue" className="flex w-fit items-center gap-1.5">
          <WifiOff className="h-3.5 w-3.5" />
          Offline — showing cached clients (most recent 500)
        </Badge>
      )}

      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, CNIC, phone, or code..."
        className="max-w-sm"
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <p className="text-sm text-muted-foreground">Loading…</p>
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <UsersIcon className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">
                {search ? "No clients match your search." : "No clients yet."}
              </p>
              {!search && isOnline && (
                <Button asChild size="sm" variant="outline" className="mt-2">
                  <Link href="/clients/new">Add your first client</Link>
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>CNIC</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Enrolled</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((client) => (
                  <TableRow
                    key={client.id}
                    className={cn(
                      "cursor-pointer",
                      client.isBlacklisted && "bg-status-overdue-bg/40"
                    )}
                  >
                    <TableCell>
                      <Link
                        href={`/clients/${client.id}`}
                        className="block font-medium text-accent hover:underline"
                      >
                        {client.clientCode}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Link href={`/clients/${client.id}`} className="block">
                        <span
                          className={cn(
                            client.isBlacklisted &&
                              "font-medium text-status-overdue"
                          )}
                        >
                          {client.name}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.cnic || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {client.phone || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(client.dateLabel)}
                    </TableCell>
                    <TableCell>
                      {client.isBlacklisted ? (
                        <BlacklistBadge maxOverdueMonths={client.maxOverdueMonths} />
                      ) : (
                        <span className="text-xs text-muted-foreground">Good standing</span>
                      )}
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