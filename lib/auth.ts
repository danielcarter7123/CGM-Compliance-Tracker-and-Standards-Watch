import { createClient } from "./supabase/server";
import { productsFrom, type Entitlement, type Products } from "./entitlements";

export type StaffRole = "admin" | "pm" | "staff";

export type Viewer = {
  userId: string;
  email: string | null;
  fullName: string;
  functions: string[];
  digestOptIn: boolean;
  calendarToken: string;
  company: { id: string; name: string } | null;
  companyRole: "member" | "admin";
  entitlements: Entitlement[];
  /** What this person can open. CGM staff can open everything. */
  products: Products;
  staffRole: StaffRole | null;
  isStaff: boolean;
  /** May approve and close performed tracker tasks. */
  canApprove: boolean;
  /** May review Standards Watch drafts and send the digest. */
  isEditor: boolean;
  /** May read Standards Watch content. */
  hasAccess: boolean;
};

/** The signed-in visitor with their profile, company and products, or null when signed out.
    UI checks only: the database's row level security is what actually enforces access. */
export async function getViewer(): Promise<Viewer | null> {
  const db = createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return null;
  const { data: p } = await db.from("profiles").select("*, company:companies!profiles_company_id_fkey(id, name)").eq("id", auth.user.id).maybeSingle();
  if (!p) return null;
  const company = (p.company as Viewer["company"]) ?? null;
  const { data: ents } = company
    ? await db.from("entitlements").select("product, status, source, current_period_end").eq("company_id", company.id)
    : { data: [] as Entitlement[] };
  const entitlements = (ents || []) as Entitlement[];
  const staffRole = (p.staff_role as StaffRole | null) ?? null;
  const isStaff = !!staffRole;
  const isEditor = staffRole === "admin" || p.role === "editor";
  const products = isStaff ? { watch: true, tracker: true, client_tasks: true } : productsFrom(entitlements);
  return {
    userId: auth.user.id,
    email: auth.user.email ?? null,
    fullName: (p.full_name as string | null) || "",
    functions: (p.functions as string[]) || [],
    digestOptIn: p.digest_opt_in !== false,
    calendarToken: String(p.calendar_token),
    company,
    companyRole: p.company_role === "admin" ? "admin" : "member",
    entitlements,
    products,
    staffRole,
    isStaff,
    canApprove: staffRole === "admin" || staffRole === "pm",
    isEditor,
    hasAccess: isEditor || products.watch,
  };
}
