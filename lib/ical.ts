import type { Deadline } from "./types";
import { events, matchesFunctions, type Classified } from "./watch";

/* The subscriber calendar feed (RFC 5545), as a pure function so it can be checked with a real parser.
   - Each event's UID depends only on what the event is (entry, label, date), never on list order, so Outlook
     and Google update events in place instead of duplicating them when the list changes.
   - Lines are folded at 75 octets (UTF-8), text is escaped, every line ends in CRLF.
   - Month-only dates (YYYY-MM) aren't calendar events and are left out. */

const ESCAPE = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const day = (d: string) => d.replace(/-/g, "");
const nextDay = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 1);
  return t.toISOString().slice(0, 10).replace(/-/g, "");
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "x";
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** Folds one content line to 75 octets per physical line without splitting a UTF-8 character. */
export function fold(line: string): string {
  const out: string[] = [];
  let cur = "", bytes = 0, limit = 75;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    if (bytes + n > limit) { out.push(cur); cur = ""; bytes = 0; limit = 74; } // continuation lines start with a space
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export type CalendarInput = { items: Classified[]; deadlines: Deadline[]; functions: string[]; site: string; now?: Date };

export function buildCalendar({ items, deadlines, functions, site, now = new Date() }: CalendarInput): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const note = "Awareness only, not a compliance determination. Confirm against the approved standard and its implementation plan.";
  const mine = items.filter((i) => i.phase !== "archived" && matchesFunctions(i.fn, functions));
  const titles = new Map(mine.map((i) => [i.id, i.title]));
  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CGM Consulting Group//Standards Watch//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:CGM Standards Watch", "NAME:CGM Standards Watch",
    "REFRESH-INTERVAL;VALUE=DURATION:PT12H", "X-PUBLISHED-TTL:PT12H",
  ];
  const seen = new Set<string>();
  const add = (uid: string, d: string, summary: string, desc: string, url: string) => {
    if (seen.has(uid)) return;
    seen.add(uid);
    lines.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(d)}`, `DTEND;VALUE=DATE:${nextDay(d)}`,
      `SUMMARY:${ESCAPE(summary)}`, `DESCRIPTION:${ESCAPE(desc)}`, `URL:${url}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  };
  for (const e of events(mine).filter((x) => isDay(x.d))) {
    const what = e.l === "effective" ? "effective" : e.l;
    add(`std-${e.id}-${slug(e.l)}-${day(e.d)}@cgm-standards-watch`, e.d, `${e.std}: ${what}`,
      `${e.std} ${titles.get(e.id) || ""}\n${e.l === "effective" ? "U.S. effective date." : e.l}\n\n${note}`, `${site}/watch#${e.id}`);
  }
  for (const d of deadlines.filter((x) => isDay(x.d) && matchesFunctions(x.fn, functions))) {
    add(`dl-${d.id}-${day(d.d)}@cgm-standards-watch`, d.d, d.t, `${d.who ? `${d.who}\n\n` : ""}${note}`, `${site}/watch`);
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export type TaskEvent = { id: string; kind: "task" | "team"; date: string; title: string; client: string; code: string };

/** The CGM Compliance Tracker task calendar (OPEN-QUESTIONS 7: calendar feeds instead of Outlook writes). One all-day
 *  event per open task on its due date (team tasks on their anticipated date). UIDs depend only on the task, so a
 *  moved due date updates the event in place. */
export function buildTaskCalendar(events: TaskEvent[], site: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const lines: string[] = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CGM Consulting Group//Compliance Tracker//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:CGM Compliance Tracker", "NAME:CGM Compliance Tracker",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
  ];
  for (const e of events.filter((x) => isDay(x.date))) {
    const url = e.kind === "team" ? `${site}/tracker/team?scope=everyone&status=all&t=${e.id}` : `${site}/tracker/tasks?status=all&t=${e.id}`;
    const summary = `${e.kind === "team" ? "Team: " : "Due: "}${e.code ? `${e.code} ` : ""}${e.title}${e.client ? ` (${e.client})` : ""}`;
    lines.push("BEGIN:VEVENT", `UID:${e.kind}-${e.id}@cgm-compliance-tracker`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(e.date)}`,
      `DTEND;VALUE=DATE:${nextDay(e.date)}`, `SUMMARY:${ESCAPE(summary)}`,
      `DESCRIPTION:${ESCAPE(`${e.kind === "team" ? "Anticipated completion" : "Due date"} in CGM Compliance Tracker.\n${url}`)}`, `URL:${url}`,
      "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
