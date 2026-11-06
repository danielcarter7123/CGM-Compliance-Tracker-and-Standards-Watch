// Team Tasks: CGM's internal work (TRACKER-SPEC §3.5). Pure helpers shared by the screen, the CSV export and tests.
// Who can read or change team tasks is decided by the database (0003: CGM staff only).

export type TeamStatus = "notstarted" | "inprogress" | "onhold" | "review" | "done";
export type TeamLink = { label: string; url: string };
export type TeamTask = {
  id: string;
  title: string;
  description: string | null;
  company_id: string | null;
  owner_id: string | null;
  owner_email?: string | null;
  collaborators: string[];
  planned_date: string | null;
  actual_date: string | null;
  est_hours: number | string | null;
  status: TeamStatus;
  links: TeamLink[] | null;
  created_at: string;
  created_by: string | null;
};

export const TEAM_STATUS: [TeamStatus, string][] = [
  ["notstarted", "Not started"], ["inprogress", "In progress"], ["onhold", "On hold"], ["review", "In review"], ["done", "Complete"],
];
export const teamStatusLabel = (s: string) => TEAM_STATUS.find(([k]) => k === s)?.[1] || "Not started";

export const TEAM_SCOPES: [string, string][] = [
  ["mine", "Assigned to me or collaborating"], ["owned", "Assigned to me"], ["everyone", "Everyone"], ["unassigned", "Unassigned"],
];
export const TEAM_STATUS_FILTERS: [string, string][] = [
  ["active", "All open"], ["late", "Past anticipated date"], ...TEAM_STATUS, ["all", "All statuses"],
];

/** Past its anticipated completion date and not complete. */
export const teamLate = (t: Pick<TeamTask, "status" | "planned_date">, today: string) =>
  t.status !== "done" && !!t.planned_date && t.planned_date < today;

export const hours = (n: number) => (Math.round(n * 100) / 100).toLocaleString("en-US");
export const sumHours = (rows: Pick<TeamTask, "est_hours">[]) => rows.reduce((x, t) => x + (Number(t.est_hours) || 0), 0);
const isMine = (t: TeamTask, me: string) => t.owner_id === me || (t.collaborators || []).includes(me);

export type TeamFilters = { scope?: string; status?: string; client?: string; q?: string };

/** The pilot's filters and order: open before complete, then by anticipated date. */
export function filterTeam(
  all: TeamTask[],
  f: TeamFilters,
  ctx: { me: string; today: string; clientName: (id: string | null) => string; personName: (id: string | null) => string },
): TeamTask[] {
  const scope = f.scope || "mine", status = f.status || "active", q = (f.q || "").trim().toLowerCase();
  return all
    .filter((t) => {
      if (scope === "mine" && !isMine(t, ctx.me)) return false;
      if (scope === "owned" && t.owner_id !== ctx.me) return false;
      if (scope === "unassigned" && t.owner_id) return false;
      if (status === "active" && t.status === "done") return false;
      if (status === "late" && !teamLate(t, ctx.today)) return false;
      if (!["active", "all", "late"].includes(status) && t.status !== status) return false;
      if (f.client === "none" ? !!t.company_id : f.client && t.company_id !== f.client) return false;
      if (q) {
        const hay = [t.title, t.description, ...(t.links || []).map((l) => `${l.label} ${l.url}`), ctx.clientName(t.company_id),
          ctx.personName(t.owner_id), ...(t.collaborators || []).map(ctx.personName)].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.planned_date || "9").localeCompare(b.planned_date || "9"));
}

/** The stat strip: my open tasks, past anticipated date, team open tasks, completed this month. */
export function teamStats(all: TeamTask[], me: string, today: string) {
  const open = all.filter((t) => t.status !== "done");
  const mine = open.filter((t) => isMine(t, me));
  const monthStart = `${today.slice(0, 7)}-01`;
  return {
    mine: mine.length, mineHours: sumHours(mine),
    late: all.filter((t) => teamLate(t, today)).length,
    open: open.length, openHours: sumHours(open),
    doneThisMonth: all.filter((t) => t.status === "done" && (t.actual_date || "") >= monthStart).length,
    monthStart,
  };
}

/** Links: one per line as "Label | https://…" (or just the URL). Only https links are kept, at most `max` (3 for team tasks). */
export function parseLinks(text: string, max = 3): { links: TeamLink[]; refused: string[] } {
  const links: TeamLink[] = [], refused: string[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const [a, b] = line.includes("|") ? line.split("|").map((s) => s.trim()) : ["", line];
    if (/^https:\/\/\S+$/i.test(b)) links.push({ label: a.slice(0, 80), url: b });
    else refused.push(line);
  }
  return { links: links.slice(0, max), refused };
}
export const linksText = (links: TeamLink[] | null) => (links || []).map((l) => (l.label ? `${l.label} | ${l.url}` : l.url)).join("\n");

/** The pilot's team-task CSV columns. */
export function teamCsv(rows: TeamTask[], ctx: { clientName: (id: string | null) => string; personName: (id: string | null) => string }) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Task", "Description", "Client", "Assigned to", "Collaborators", "Estimated hours", "Anticipated completion", "Actual completion", "Status", "Links"];
  const lines = rows.map((t) =>
    [t.title, t.description, ctx.clientName(t.company_id), t.owner_id ? ctx.personName(t.owner_id) : t.owner_email || "",
      (t.collaborators || []).map(ctx.personName).join("; "), t.est_hours, t.planned_date, t.actual_date, teamStatusLabel(t.status),
      (t.links || []).map((l) => (l.label ? `${l.label}: ${l.url}` : l.url)).join(" | ")].map(q).join(","),
  );
  return [head.map(q).join(","), ...lines].join("\r\n");
}
