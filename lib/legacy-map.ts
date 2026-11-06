// How one pilot-tracker record becomes rows in this app. Shared by the importer (scripts/import-tracker.ts) and by
// Restore of records deleted before the move (Activity Log), so both produce exactly the same rows and ids.
// Pure functions; nothing here reads or writes the database.
import { createHash } from "node:crypto";

export type Row = Record<string, unknown>;

export const REGIONS = ["MRO", "NPCC", "RF", "SERC", "Texas RE", "WECC"];
export const TASK_STATUS = ["open", "inprogress", "review", "done"];
export const TEAM_STATUS = ["notstarted", "inprogress", "onhold", "review", "done"];
export const CTASK_STATUS = ["notstarted", "inprogress", "onhold", "done"];
export const REMIND = [90, 60, 30, 14, 7, 1];
export const CODE_RE = /^[A-Z]{2,4}-[A-Z0-9.\-]+$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Deterministic UUID (v5-style) so the same pilot record always maps to the same id. */
export function uuidFrom(kind: string, id: string) {
  const h = createHash("sha1").update(`cgm-tracker:${kind}:${id}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const date = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
export const text = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
export const https = (v: unknown) => (typeof v === "string" && /^https:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);
export const email = (v: unknown) => (typeof v === "string" && EMAIL_RE.test(v.trim()) ? v.trim() : null);
export const unit = (u: unknown) => (u === "d" || u === "y" ? u : "m");
export const recurN = (r: any) => Math.max(0, Number.parseInt(r?.n, 10) || 0);
export const links = (v: unknown) =>
  Array.isArray(v) ? v.filter((l: any) => https(l?.url)).map((l: any) => ({ label: String(l.label || ""), url: https(l.url) })) : [];

/** A library standard and its obligation templates. Null when the number isn't valid. */
export function mapStandard(docId: string, s: any): { standard: Row; templates: Row[] } | null {
  const code = String(s.code || docId).trim().toUpperCase();
  if (!CODE_RE.test(code)) return null;
  return {
    standard: {
      code, version: String(s.version || "?"), title: String(s.title || code), family: String(s.family || code.split("-")[0]),
      applies: Array.isArray(s.applies) ? s.applies.map(String) : [], url: https(s.url), notes: text(s.notes), custom: !!s.custom,
    },
    templates: (s.templates || []).map((t: any, i: number) => ({
      id: uuidFrom("template", `${code}|${i}`), standard_code: code, req: String(t.req || ""), title: String(t.title || "(untitled obligation)"),
      recur_n: recurN(t.recur), recur_unit: unit(t.recur?.unit), recur_basis: t.recur?.basis === "done" ? "done" : "due",
      basis_confirmed: t.recur?.basis === "done" || t.recur?.basis === "due", pos: i,
    })),
  };
}

/** A client: the company, its contacts (compliance, PM, plant manager) and its products. Warnings never carry
 *  contact details (CLAUDE.md rule 7). */
export function mapClient(docId: string, c: any, warn: (w: string) => void = () => {}) {
  const id = uuidFrom("client", docId);
  if (c.region && !REGIONS.includes(c.region)) warn(`Client ${docId}: region "${c.region}" not recognised; left blank (kept in legacy).`);
  const company: Row = {
    id, name: String(c.name || "(unnamed client)"), legacy_id: docId, ncr_id: text(c.ncr), region: REGIONS.includes(c.region) ? c.region : null,
    reg_date: date(c.regDate), functions: Array.isArray(c.functions) ? c.functions.map(String) : [], entities: c.entities || {},
    facilities: text(c.facilities), sharepoint_url: https(c.sharepoint), notes: text(c.notes), sample: !!c.sample, legacy: c,
  };
  const contacts: Row[] = [];
  const person = (kind: string, name: unknown, mail: unknown, digest: boolean) => {
    if (!text(name) && !email(mail)) return;
    if (mail && !email(mail)) warn(`Client ${docId}: ${kind} email is not valid; left blank (original kept in legacy).`);
    contacts.push({ id: uuidFrom("contact", `${docId}|${kind}`), company_id: id, kind, name: String(text(name) || text(mail)), email: email(mail), digest });
  };
  person("compliance", c.contact, c.contactEmail, c.digest !== false);
  person("pm", c.pmName, c.pmEmail, c.pmDigest !== false);
  person("plant_manager", c.plantMgrName, c.plantMgrEmail, c.plantMgrDigest === true);
  const entitlements: Row[] = [];
  if (!c.sample) entitlements.push({ company_id: id, product: "tracker", status: "active", source: "contract", notes: "Imported from the pilot tracker" });
  // The pilot tracker opened with Standards Watch, so its clients keep Watch, now as its own app (decision 17).
  if (!c.sample) entitlements.push({ company_id: id, product: "watch", status: "active", source: "contract", notes: "Imported from the pilot tracker (Standards Watch was part of it)" });
  if (!c.sample && c.workspace === true) entitlements.push({ company_id: id, product: "client_tasks", status: "active", source: "contract", notes: "Imported from the pilot tracker" });
  return { company, contacts, entitlements };
}

/** A NERC task. The caller decides the company (by the pilot client id), whether the standard number is known,
 *  and the chain links (by the pilot task ids). */
export function mapTask(
  docId: string, t: any,
  ctx: { companyId: string; standard: string | null; today: string; exportedAt: string; warn?: (w: string) => void },
): Row {
  const status = TASK_STATUS.includes(t.status) ? t.status : "open";
  let completed = date(t.completedAt);
  if (completed && completed > ctx.today) { ctx.warn?.(`Task ${docId}: completion date ${completed} is in the future; left blank (kept in legacy).`); completed = null; }
  return {
    id: uuidFrom("task", docId), company_id: ctx.companyId, title: String(t.title || "(untitled task)"), facility: text(t.facility),
    standard_code: ctx.standard, requirement: text(t.requirement), due_date: date(t.dueDate), assignee_text: text(t.assignee),
    assignee_email: email(t.assigneeEmail), remind_days: Array.isArray(t.remindDays) ? t.remindDays.map(Number).filter((n: number) => REMIND.includes(n)) : [30, 7],
    recur_n: recurN(t.recur), recur_unit: unit(t.recur?.unit), recur_basis: t.recur?.basis === "done" ? "done" : "due",
    status, evidence: text(t.evidence), notes: text(t.notes), created_at: date(t.createdAt) ? `${t.createdAt}T12:00:00Z` : ctx.exportedAt,
    completed_at: completed, reviewed_at: date(t.reviewedAt), plan_id: text(t.planId), outlook: t.outlook || null, sample: !!t.sample,
    legacy_id: docId, legacy: t,
  };
}
export const standardOf = (t: any) => (t.standard ? String(t.standard).trim().toUpperCase() : null);

export function mapTeamTask(docId: string, t: any, ctx: { companyId: string | null; exportedAt: string }): Row {
  const est = t.estHours === "" || t.estHours == null || isNaN(Number(t.estHours)) ? null : Number(t.estHours);
  return {
    id: uuidFrom("team", docId), title: String(t.title || "(untitled)"), description: text(t.description),
    company_id: ctx.companyId, owner_legacy: text(t.owner), owner_email: email(t.ownerEmail),
    collaborators_legacy: Array.isArray(t.collaborators) ? t.collaborators.map(String) : [], planned_date: date(t.plannedDate),
    actual_date: date(t.actualDate), est_hours: est, status: TEAM_STATUS.includes(t.status) ? t.status : "notstarted", links: links(t.links),
    created_at: date(t.createdAt) ? `${t.createdAt}T12:00:00Z` : ctx.exportedAt, created_by_legacy: text(t.createdBy), legacy_id: docId, legacy: t,
  };
}

export function mapClientTask(docId: string, t: any, ctx: { companyId: string }): Row {
  return {
    id: uuidFrom("ctask", docId), company_id: ctx.companyId, title: String(t.title || "(untitled)"),
    description: text(t.description), notes: text(t.notes), category: text(t.category), assigned_to: text(t.assignedTo),
    party: ["client", "contractor", "cgm", "agency", "other"].includes(t.party) ? t.party : "client", due_date: date(t.dueDate),
    completed_at: date(t.completedAt), priority: ["low", "normal", "high"].includes(t.priority) ? t.priority : "normal",
    status: CTASK_STATUS.includes(t.status) ? t.status : "notstarted", recur_n: recurN(t.recur), recur_unit: unit(t.recur?.unit),
    links: links(t.links), legacy_id: docId, legacy: t,
  };
}
