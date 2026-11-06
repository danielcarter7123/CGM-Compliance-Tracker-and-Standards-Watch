import type { Viewer } from "./auth";

/* The app's one menu. The whole app is CGM Compliance Tracker; NERC Standards Watch is one page in it
   (its first section, as in the pilot). Sections not built yet show greyed out. These decide what to show
   only; row level security decides what anyone can read. */

export type Section = { label: string; href?: string; locked?: boolean };

export function appSections(v: Viewer | null): Section[] {
  if (!v) return [];
  const out: Section[] = [];
  if (v.hasAccess) out.push({ label: "Standards Watch", href: "/watch" });
  if (v.products.tracker) {
    out.push(
      { label: "Dashboard", href: "/tracker" },
      { label: "Tasks", href: "/tracker/tasks" },
      ...(!v.isStaff && v.products.client_tasks ? [{ label: "Client Tasks" }] : []),
      ...(v.isStaff ? [{ label: "Team Tasks" }] : []),
      { label: "Standards Library", href: "/tracker/standards" },
      ...(v.isStaff ? [{ label: "Clients", href: "/tracker/clients" }] : []),
      { label: "Messages" },
      { label: "Activity Log" },
    );
  } else {
    out.push({ label: "Compliance Tracker", href: "/account?need=tracker", locked: true });
  }
  return out;
}

/** Where someone goes when they open the app: the Dashboard for Tracker users, the Standards Watch page for
 *  Watch subscribers, their account page otherwise. */
export function homeFor(v: Viewer | null): string {
  if (!v) return "/login";
  if (v.products.tracker) return "/tracker";
  if (v.hasAccess) return "/watch";
  return "/account";
}

/** One line under the product name: who you are in the app. */
export function whoLine(v: Viewer): string {
  if (v.isStaff) return `CGM ${v.staffRole === "pm" ? "project manager" : v.staffRole}`;
  return v.company?.name || v.email || "";
}
