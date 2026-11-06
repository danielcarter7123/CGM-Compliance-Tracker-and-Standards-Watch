import type { Viewer } from "./auth";

/* CGM Workspace is three separate apps on one account (decision 17, docs/SUITE.md). Each app has its own
   header; "← CGM Workspace" goes back to the launcher. Nothing here links one app to another. These decide
   what to show only; row level security decides what anyone can read. */

export type AppKey = "workspace" | "watch" | "tracker";
export const APP_NAME: Record<AppKey, string> = {
  workspace: "CGM Workspace",
  watch: "CGM Standards Watch",
  tracker: "CGM Compliance Tracker",
};

export type Section = { label: string; href?: string; badge?: number };

/** CGM Compliance Tracker's section tabs. Sections not built yet show greyed out. */
export function trackerSections(v: Viewer, unread = 0): Section[] {
  return [
    { label: "Dashboard", href: "/tracker" },
    { label: "Tasks", href: "/tracker/tasks" },
    ...(!v.isStaff && v.products.client_tasks ? [{ label: "Client Tasks" }] : []),
    ...(v.isStaff ? [{ label: "Team Tasks", href: "/tracker/team" }] : []),
    { label: "Standards Library", href: "/tracker/standards" },
    ...(v.isStaff ? [{ label: "Clients", href: "/tracker/clients" }] : []),
    { label: "Messages", href: "/tracker/messages", badge: unread },
    { label: "Activity Log" },
  ];
}

/** Everyone signed in starts at the CGM Workspace launcher. */
export function homeFor(v: Viewer | null): string {
  return v ? "/workspace" : "/login";
}

/** One line under the app name: who you are. */
export function whoLine(v: Viewer): string {
  if (v.isStaff) return `CGM ${v.staffRole === "pm" ? "project manager" : v.staffRole}`;
  return v.company?.name || v.email || "";
}

export function initials(v: Viewer): string {
  const src = (v.fullName || v.email || "?").replace(/@.*/, "");
  const parts = src.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

/** The apps in the launcher, in the demo's order. */
export const APPS = [
  { key: "watch", name: "CGM Standards Watch", category: "INSIGHTS & UPDATES" },
  { key: "tracker", name: "CGM Compliance Tracker", category: "PRIORITIES & EXECUTION" },
  { key: "powerworks", name: "CGM Powerworks", category: "ASSETS & RELIABILITY" },
] as const;

/** The plan name follows from how many of the three apps a client has (docs/SUITE.md). */
export function planName(v: Viewer): string {
  if (v.isStaff) return "CGM staff · every application";
  const n = APPS.filter((a) => v.products[a.key]).length;
  return ["No applications yet", "Essentials access", "Operations access", "Enterprise access"][n];
}
