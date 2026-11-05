import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { companiesWith } from "@/lib/entitlements";
import { loadContent } from "@/lib/content";
import { classify, events, matchesFunctions } from "@/lib/watch";

/** Per-subscriber iCalendar feed: compliance dates and comment deadlines for their functions. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.token)) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: p } = await admin
    .from("profiles")
    .select("functions, role, staff_role, company_id")
    .eq("calendar_token", params.token)
    .maybeSingle();
  const allowed = !!p && (!!p.staff_role || p.role === "editor" || (!!p.company_id && (await companiesWith(admin, "watch")).has(p.company_id as string)));
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  const fns = (p.functions as string[]) || [];
  const content = await loadContent(admin);
  const items = classify(content.items).filter((i) => i.phase !== "archived" && matchesFunctions(i.fn, fns));
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  const day = (d: string) => d.replace(/-/g, "");
  const next = (d: string) => {
    const t = new Date(`${d}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + 1);
    return t.toISOString().slice(0, 10).replace(/-/g, "");
  };
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const vevents: string[] = [];
  events(items).filter((e) => e.d.length === 10).forEach((e, i) => {
    vevents.push(["BEGIN:VEVENT", `UID:std-${e.id}-${i}-${day(e.d)}@standards-watch`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(e.d)}`, `DTEND;VALUE=DATE:${next(e.d)}`,
      `SUMMARY:${esc(`${e.std}: ${e.l === "effective" ? "effective" : e.l}`)}`, "TRANSP:TRANSPARENT", "END:VEVENT"].join("\r\n"));
  });
  content.deadlines.filter((d) => matchesFunctions(d.fn, fns)).forEach((d) => {
    vevents.push(["BEGIN:VEVENT", `UID:dl-${d.id}@standards-watch`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day(d.d)}`, `DTEND;VALUE=DATE:${next(d.d)}`,
      `SUMMARY:${esc(d.t)}`, `DESCRIPTION:${esc(d.who || "")}`, "TRANSP:TRANSPARENT", "END:VEVENT"].join("\r\n"));
  });
  const body = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//CGM Consulting Group//Standards Watch//EN", "X-WR-CALNAME:NERC Standards Watch", "CALSCALE:GREGORIAN", ...vevents, "END:VCALENDAR"].join("\r\n");
  return new NextResponse(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=3600" } });
}
