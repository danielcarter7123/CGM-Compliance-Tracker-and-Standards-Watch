import type { SupabaseClient } from "@supabase/supabase-js";

/** Products a company can hold. The Tracker includes Standards Watch; Client Tasks needs the Tracker. */
export const PRODUCTS = ["watch", "tracker", "client_tasks"] as const;
export type Product = (typeof PRODUCTS)[number];
export type Entitlement = { product: Product; status: string; source: string; current_period_end: string | null };
export type Products = Record<Product, boolean>;

export const isLive = (status?: string | null) => status === "active" || status === "trialing";

/** Same rules as public.company_has() in supabase/migrations/0002_platform.sql. Keep them in step. */
export function productsFrom(ents: Pick<Entitlement, "product" | "status">[]): Products {
  const live = new Set(ents.filter((e) => isLive(e.status)).map((e) => e.product));
  return {
    watch: live.has("watch") || live.has("tracker"),
    tracker: live.has("tracker"),
    client_tasks: live.has("client_tasks") && live.has("tracker"),
  };
}

/** Ids of companies that currently hold a product (for server jobs using the service-role client). */
export async function companiesWith(admin: SupabaseClient, product: Product): Promise<Set<string>> {
  const { data, error } = await admin.from("entitlements").select("company_id, product, status");
  if (error) throw new Error(error.message);
  const byCompany = new Map<string, { product: Product; status: string }[]>();
  for (const e of data || []) {
    const list = byCompany.get(e.company_id as string) || [];
    list.push({ product: e.product as Product, status: e.status as string });
    byCompany.set(e.company_id as string, list);
  }
  return new Set([...byCompany].filter(([, ents]) => productsFrom(ents)[product]).map(([id]) => id));
}
