import { createClient } from "@/lib/supabase/server";
import { sanitizeSearchTerm } from "@/lib/utils/search";
import type { SearchResult } from "@/types/domain";

export class SearchServiceError extends Error {}

export async function globalSearch(term: string): Promise<SearchResult[]> {
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  const safe = sanitizeSearchTerm(trimmed);
  const supabase = await createClient();

  const [clientsRes, contractsRes, investorsRes] = await Promise.all([
    supabase
      .from("clients")
      .select("id, client_code, name, cnic, phone")
      .eq("is_deleted", false)
      .or(
        `name.ilike.%${safe}%,cnic.ilike.%${safe}%,phone.ilike.%${safe}%,client_code.ilike.%${safe}%`
      )
      .limit(8),
    supabase
      .from("contracts")
      .select("id, contract_code, product_name, client:clients(name)")
      .or(`contract_code.ilike.%${safe}%,product_name.ilike.%${safe}%`)
      .limit(8),
    supabase
      .from("investors")
      .select("id, name, active")
      .ilike("name", `%${safe}%`)
      .limit(5),
  ]);

  if (clientsRes.error) {
    throw new SearchServiceError(
      `Search failed (clients): ${clientsRes.error.message}`
    );
  }
  if (contractsRes.error) {
    throw new SearchServiceError(
      `Search failed (contracts): ${contractsRes.error.message}`
    );
  }
  if (investorsRes.error) {
    throw new SearchServiceError(
      `Search failed (investors): ${investorsRes.error.message}`
    );
  }

  const clientResults: SearchResult[] = (clientsRes.data ?? []).map((c) => ({
    type: "client" as const,
    id: c.id,
    title: c.name,
    subtitle: `${c.client_code}${c.phone ? " • " + c.phone : ""}`,
    href: `/clients/${c.id}`,
  }));

  const contractResults: SearchResult[] = (contractsRes.data ?? []).map(
    (c) => ({
      type: "contract" as const,
      id: c.id,
      title: c.contract_code,
      subtitle: `${c.product_name}${
        c.client?.name ? " • " + c.client.name : ""
      }`,
      href: `/contracts/${c.id}`,
    })
  );

  const investorResults: SearchResult[] = (investorsRes.data ?? []).map(
    (i) => ({
      type: "investor" as const,
      id: i.id,
      title: i.name,
      subtitle: i.active ? "Active investor" : "Inactive investor",
      href: `/investors/${i.id}`,
    })
  );

  return [...clientResults, ...contractResults, ...investorResults];
}