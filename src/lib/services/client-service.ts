import { createClient } from "@/lib/supabase/server";
import { mapClient, mapContract } from "./mappers";
import { BLACKLIST_OVERDUE_MONTHS_THRESHOLD } from "@/lib/utils/calculations";
import { normalizeSearchTerm } from "@/lib/utils/search";
import type {
  Client,
  ClientWithContracts,
  ClientWithBlacklistStatus,
} from "@/types/domain";
import type { ClientFormValues } from "@/lib/validations/client";

export class ClientServiceError extends Error {}

function normalizeNumber(value: string): string {
  return value.replace(/\D/g, "");
}

/** Generates the next sequential client code via the DB sequence function */
async function getNextClientCode(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<string> {
  const { data, error } = await supabase.rpc("next_client_code");
  if (error || !data) {
    throw new ClientServiceError(
      `Failed to generate client code: ${error?.message ?? "unknown error"}`
    );
  }
  return data as string;
}

/**
 * Search is done client-side (in this function, after fetching) rather
 * than pushed down to a SQL `ilike` filter. This is deliberate: phone
 * and CNIC numbers get searched in whatever format the person types
 * them (e.g. "03001234567" should match a stored "0300-1234567"), and
 * normalizing both sides of that comparison is awkward to express as a
 * single SQL filter. The tradeoff is that this fetches the full
 * non-deleted client list on every search — fine at this shop's scale,
 * worth revisiting (e.g. a normalized search column + index) if the
 * client list grows into the thousands.
 */
export async function listClients(params?: {
  search?: string;
  includeDeleted?: boolean;
}): Promise<Client[]> {
  const supabase = await createClient();
  let query = supabase.from("clients").select("*");

  if (!params?.includeDeleted) {
    query = query.eq("is_deleted", false);
  }

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) {
    throw new ClientServiceError(`Failed to list clients: ${error.message}`);
  }

  let clients = (data ?? []).map(mapClient);

  if (params?.search?.trim()) {
    const term = normalizeSearchTerm(params.search);
    const numericTerm = normalizeNumber(term);
    clients = clients.filter((c) => {
      return (
        c.name.toLowerCase().includes(term) ||
        c.clientCode.toLowerCase().includes(term) ||
        (c.cnic ?? "").toLowerCase().includes(term) ||
        (c.phone ?? "").toLowerCase().includes(term) ||
        normalizeNumber(c.cnic ?? "").includes(numericTerm) ||
        normalizeNumber(c.phone ?? "").includes(numericTerm)
      );
    });
  }

  return clients;
}

/**
 * Same as listClients, but additionally computes blacklist status per
 * client. A client is blacklisted if ANY of their contracts has been
 * continuously overdue for BLACKLIST_OVERDUE_MONTHS_THRESHOLD months
 * or more. This is computed fresh on every call (not stored) so it
 * can never drift out of sync and auto-resolves the moment a client
 * catches up — there's no separate "unblacklist" action to remember.
 *
 * Implemented as one extra query (max overdue_months per client_id,
 * grouped) rather than N+1 — fine at this shop's scale; if the client
 * list grows large, this could become a materialized view instead.
 */
export async function listClientsWithBlacklistStatus(params?: {
  search?: string;
  includeDeleted?: boolean;
}): Promise<ClientWithBlacklistStatus[]> {
  const supabase = await createClient();
  const [clients, contractsRes] = await Promise.all([
    listClients(params),
    supabase
      .from("contracts")
      .select("client_id, overdue_months")
      .gt("overdue_months", 0),
  ]);

  if (contractsRes.error) {
    throw new ClientServiceError(
      `Failed to load overdue contract data: ${contractsRes.error.message}`
    );
  }

  const maxOverdueByClient = new Map<number, number>();
  for (const row of contractsRes.data ?? []) {
    const current = maxOverdueByClient.get(row.client_id) ?? 0;
    if (row.overdue_months > current) {
      maxOverdueByClient.set(row.client_id, row.overdue_months);
    }
  }

  return clients.map((client) => {
    const maxOverdueMonths = maxOverdueByClient.get(client.id) ?? 0;
    return {
      ...client,
      maxOverdueMonths,
      isBlacklisted: maxOverdueMonths >= BLACKLIST_OVERDUE_MONTHS_THRESHOLD,
    };
  });
}

export async function getClientById(
  id: number
): Promise<ClientWithContracts | null> {
  const supabase = await createClient();

  const { data: clientRow, error: clientError } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (clientError) {
    throw new ClientServiceError(
      `Failed to fetch client: ${clientError.message}`
    );
  }
  if (!clientRow) return null;

  const { data: contractRows, error: contractError } = await supabase
    .from("contracts")
    .select("*")
    .eq("client_id", id)
    .order("created_at", { ascending: false });

  if (contractError) {
    throw new ClientServiceError(
      `Failed to fetch client contracts: ${contractError.message}`
    );
  }

  return {
    ...mapClient(clientRow),
    contracts: (contractRows ?? []).map(mapContract),
  };
}

export async function createClientRecord(
  values: ClientFormValues
): Promise<Client> {
  const supabase = await createClient();
  const clientCode = await getNextClientCode(supabase);

  const { data, error } = await supabase
    .from("clients")
    .insert({
      client_code: clientCode,
      name: values.name,
      cnic: values.cnic || null,
      phone: values.phone || null,
      address: values.address || null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ClientServiceError(
        "A client with this CNIC already exists."
      );
    }
    throw new ClientServiceError(`Failed to create client: ${error.message}`);
  }

  return mapClient(data);
}

export async function updateClientRecord(
  id: number,
  values: ClientFormValues
): Promise<Client> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("clients")
    .update({
      name: values.name,
      cnic: values.cnic || null,
      phone: values.phone || null,
      address: values.address || null,
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new ClientServiceError(
        "A client with this CNIC already exists."
      );
    }
    throw new ClientServiceError(`Failed to update client: ${error.message}`);
  }

  return mapClient(data);
}

/** Soft delete — preserves history, hides from default listings */
export async function softDeleteClient(id: number): Promise<void> {
  const supabase = await createClient();

  // Guard: don't allow deleting a client with active/overdue contracts.
  const { count, error: countError } = await supabase
    .from("contracts")
    .select("id", { count: "exact", head: true })
    .eq("client_id", id)
    .in("status", ["ACTIVE", "OVERDUE"]);

  if (countError) {
    throw new ClientServiceError(
      `Failed to check client contracts: ${countError.message}`
    );
  }
  if ((count ?? 0) > 0) {
    throw new ClientServiceError(
      "Cannot delete a client with active or overdue contracts."
    );
  }

  const { error } = await supabase
    .from("clients")
    .update({ is_deleted: true })
    .eq("id", id);

  if (error) {
    throw new ClientServiceError(`Failed to delete client: ${error.message}`);
  }
}