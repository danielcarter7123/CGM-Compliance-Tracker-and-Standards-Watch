import { redirect } from "next/navigation";
import { getViewer, type Viewer } from "./auth";

/** Route guards for server components and layouts. They decide what to show and where to send people;
    row level security in the database is what actually protects the data. */

export async function requireViewer(next: string): Promise<Viewer> {
  const v = await getViewer();
  if (!v) redirect(`/login?next=${encodeURIComponent(next)}`);
  return v;
}

export async function requireTracker(next = "/tracker"): Promise<Viewer> {
  const v = await requireViewer(next);
  if (!v.products.tracker) redirect("/account?need=tracker");
  return v;
}

export async function requireStaff(next = "/tracker"): Promise<Viewer> {
  const v = await requireTracker(next);
  if (!v.isStaff) redirect("/tracker");
  return v;
}

export async function requireAdmin(next = "/admin"): Promise<Viewer> {
  const v = await requireViewer(next);
  if (v.staffRole !== "admin") redirect(v.hasAccess ? "/watch" : "/account");
  return v;
}

export async function requireEditor(next = "/admin/review"): Promise<Viewer> {
  const v = await requireViewer(next);
  if (!v.isEditor) redirect(v.hasAccess ? "/watch" : "/account");
  return v;
}
