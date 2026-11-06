import type { Deadline } from "./types";
import { daysUntil, fmt, startOfToday } from "./watch";

/* What changed in published Watch content, worked out from approved drafts and the values they
   replaced (drafts.previous). Pure functions, so they're unit-tested without a database. */

export type DecidedDraft = {
  id: string;
  section: string;
  op: "upsert" | "remove";
  key: string;
  label: string | null;
  value: Record<string, unknown> | null;
  previous: Record<string, unknown> | null;
  decided_at: string | null;
};

type Ms = { d: string; l: string };
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const ms = (v: unknown): Ms[] => (Array.isArray(v) ? (v as Ms[]).filter((m) => m && m.d && m.l) : []);

/** Suggested lines for the digest's corrections box: changes to dates subscribers already saw, and removals. */
export function correctionLines(drafts: DecidedDraft[]): string[] {
  const out: string[] = [];
  for (const d of drafts) {
    const prev = d.previous, v = d.value || {};
    if (!prev) continue; // new entries aren't corrections
    if (d.section === "items") {
      const std = str(v.std) || str(prev.std) || d.key;
      if (d.op === "remove") { out.push(`${std} was removed from Standards Watch.`); continue; }
      const pe = str(prev.effective), ve = str(v.effective);
      if (pe && ve && pe !== ve) out.push(`${std}: U.S. effective date changed from ${fmt(pe)} to ${fmt(ve)}.`);
      if (pe && !ve) out.push(`${std}: the effective date of ${fmt(pe)} was withdrawn.`);
      const pf = str(prev.ferc), vf = str(v.ferc);
      if (pf && vf && pf !== vf) out.push(`${std}: FERC approval date changed from ${fmt(pf)} to ${fmt(vf)}.`);
      const now = new Map(ms(v.milestones).map((m) => [m.l, m.d]));
      for (const m of ms(prev.milestones)) {
        const nd = now.get(m.l);
        if (nd === undefined) out.push(`${std}: milestone "${m.l}" (${fmt(m.d)}) was removed.`);
        else if (nd !== m.d) out.push(`${std}: "${m.l}" moved from ${fmt(m.d)} to ${fmt(nd)}.`);
      }
    } else if (d.section === "deadlines") {
      const t = str(v.t) || str(prev.t) || d.label || d.key;
      if (d.op === "remove") { out.push(`${t} (${fmt(str(prev.d))}) was removed.`); continue; }
      const pd = str(prev.d), vd = str(v.d);
      if (pd && vd && pd !== vd) out.push(`${t}: date changed from ${fmt(pd)} to ${fmt(vd)}.`);
    }
  }
  return out;
}

export type Alert = { key: string; kind: "ferc" | "effective" | "deadline"; label: string; fn: string[] | null; href: string };

export const ALERT_WINDOW_DAYS = 14;

/** Alerts due now: new FERC approvals and new or changed effective dates from drafts approved in the last
 *  14 days, and comment periods or events within 14 days. `sent` holds keys already in alert_log. */
export function dueAlerts(drafts: DecidedDraft[], deadlines: Deadline[], sent: Set<string>, today = startOfToday()): Alert[] {
  const out: Alert[] = [];
  const recent = drafts.filter((d) => d.decided_at && (today.getTime() - new Date(d.decided_at).getTime()) / 864e5 <= ALERT_WINDOW_DAYS);
  for (const d of recent) {
    if (d.section !== "items" || d.op !== "upsert" || !d.value) continue;
    const v = d.value, prev = d.previous || {};
    const std = str(v.std) || d.key;
    const fn = Array.isArray(v.fn) ? (v.fn as string[]) : null;
    const href = `/watch#${d.key}`;
    const vf = str(v.ferc);
    if (vf && v.status !== "dev" && str(prev.ferc) !== vf) {
      out.push({ key: `ferc:${d.id}`, kind: "ferc", label: `${std} approved by FERC (${fmt(vf)}).${str(v.title) ? ` ${v.title}.` : ""}`, fn, href });
    }
    const ve = str(v.effective), pe = str(prev.effective);
    if (ve && pe !== ve) {
      out.push({
        key: `effective:${d.id}`, kind: "effective", fn, href,
        label: pe ? `${std}: U.S. effective date moved from ${fmt(pe)} to ${fmt(ve)}.` : `${std} takes effect in the U.S. on ${fmt(ve)}.`,
      });
    }
  }
  for (const dl of deadlines) {
    const n = daysUntil(dl.d, today);
    if (n < 0 || n > ALERT_WINDOW_DAYS) continue;
    out.push({
      key: `deadline:${dl.id}:${dl.d}`, kind: "deadline", fn: dl.fn ?? null, href: "/watch",
      label: `${dl.t}: ${fmt(dl.d)} (${n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`}).${dl.who ? ` ${dl.who}.` : ""}`,
    });
  }
  return out.filter((a) => !sent.has(a.key));
}
