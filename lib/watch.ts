import type { Item } from "./types";
import { FUNCTIONS } from "./types";

/* Date and classification logic shared by the Watch page, the digest and the calendar feed.
   Same rules as the pilot page, so content behaves identically after the move. */

export const RECENT_DAYS = 365;
export const NEW_APPROVAL_DAYS = 270;
export const NEWS_DAYS = 21;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const parseDate = (s: string) => {
  const [y, m, d] = String(s).split("-").map(Number);
  return new Date(y, m - 1, d || 1);
};
export const fmt = (s?: string | null) => {
  if (!s) return "";
  const p = String(s).split("-");
  const m = MONTHS[+p[1] - 1];
  return p[2] ? `${m} ${+p[2]}, ${p[0]}` : `${m} ${p[0]}`;
};
export const fmtShort = (s: string) => {
  const p = String(s).split("-");
  return p[2] ? `${MONTHS[+p[1] - 1]} ${+p[2]}` : MONTHS[+p[1] - 1];
};
export const startOfToday = () => {
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return t;
};
export const isoToday = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};
export const daysUntil = (s: string, today = startOfToday()) => Math.round((parseDate(s).getTime() - today.getTime()) / 864e5);
export const sortDate = (s?: string | null) => (String(s || "").length === 7 ? `${s}-15` : String(s || ""));
export function rel(s: string, today = startOfToday()) {
  const n = daysUntil(s, today);
  if (n === 0) return "today";
  const a = Math.abs(n);
  const txt = a < 120 ? `${a} day${a === 1 ? "" : "s"}` : a < 730 ? `${Math.round(a / 30.44)} months` : `${(a / 365.25).toFixed(1)} years`;
  return n > 0 ? `in ${txt}` : `${txt} ago`;
}

export const isTx = (f: string) => (FUNCTIONS.tx as readonly string[]).includes(f);

export type Phase = "upcoming" | "implementing" | "recent" | "dev" | "archived";
export type Classified = Item & { phase: Phase; newApproval: boolean; freshNews: { d: string; t: string }[] };

export function classify(items: Item[], today = startOfToday()): Classified[] {
  return items
    .map((it) => {
      const freshNews = (it.news || []).filter((n) => -daysUntil(n.d, today) <= NEWS_DAYS);
      let phase: Phase;
      if (it.status === "dev" || !it.effective) phase = "dev";
      else {
        const future = (it.milestones || []).some((m) => daysUntil(m.d, today) > 0);
        if (daysUntil(it.effective, today) > 0) phase = "upcoming";
        else if (future || it.phasing) phase = "implementing";
        else if (-daysUntil(it.effective, today) <= RECENT_DAYS) phase = "recent";
        else phase = "archived";
      }
      const newApproval = phase !== "dev" && !!it.ferc && -daysUntil(sortDate(it.ferc), today) <= NEW_APPROVAL_DAYS;
      return { ...it, phase, newApproval, freshNews };
    })
    .sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));
}

export const matchesFunctions = (fns: string[] | null | undefined, selected: string[]) =>
  !selected.length || !fns || fns.some((f) => selected.includes(f));

export const SECTIONS: { k: Exclude<Phase, "archived">; h: string; note: string; pill: string }[] = [
  { k: "upcoming", h: "Coming into effect", note: "Approved and scheduled. Effective dates are U.S. dates and fall on the first day of a calendar quarter.", pill: "Coming into effect" },
  { k: "implementing", h: "In implementation", note: "In effect, with phased compliance dates still ahead.", pill: "Phasing in" },
  { k: "recent", h: "Recently took effect", note: "Became enforceable in the last 12 months. Make sure evidence is in place.", pill: "In effect" },
  { k: "dev", h: "In development", note: "Not yet approved by FERC. Worth tracking so the compliance date doesn't arrive as a surprise.", pill: "In development" },
];

/** Every dated compliance event (effective dates and phased milestones), oldest first. */
export function events(items: Classified[]) {
  const out: { d: string; std: string; l: string; id: string }[] = [];
  items.filter((i) => i.phase !== "dev" && i.phase !== "archived" && i.effective).forEach((i) => {
    out.push({ d: i.effective as string, std: i.std, l: "effective", id: i.id });
    (i.milestones || []).forEach((m) => out.push({ d: m.d, std: i.std, l: m.l, id: i.id }));
  });
  return out.sort((a, b) => a.d.localeCompare(b.d));
}
