import { fmt } from "./watch";

/* What changed in published Watch content, worked out from approved drafts and the values they
   replaced (drafts.previous). Used for the digest's corrections box. Pure functions, so they're unit-tested without a database. */

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
