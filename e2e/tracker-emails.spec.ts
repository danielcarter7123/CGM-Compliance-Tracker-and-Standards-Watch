import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// T8 Tracker emails: with emails switched on, the weekday job sends the client digest to the client's contact and a
// reminder to the task's assignee (to the local mail catcher), never twice in a day; the unsubscribe link works
// without a login and stops that email; one-click unsubscribe works; the account page manages a person's own
// settings; the task calendar feed shows only that person's tasks. Fake addresses and records only.

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const MAILPIT = "http://127.0.0.1:54324";
const run = Date.now().toString(36);
const CONTACT = `contact-${run}@fake.example`, ASSIGNEE = `assignee-${run}@fake.example`;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = new Date();
const twoDaysAgo = iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 2));

async function service(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  });
  return res.json().catch(() => null);
}
const job = () => fetch("http://localhost:3000/api/jobs/tracker-emails", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }).then((r) => r.json());
async function inbox(addr: string) {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${addr}"`)}`);
  return ((await r.json()) as { messages: { ID: string; Subject: string }[] }).messages || [];
}
const full = async (id: string) => (await (await fetch(`${MAILPIT}/api/v1/message/${id}`)).json()) as { Text: string; HTML: string };

test("weekday Tracker emails: digest and reminder sent once; unsubscribe; account settings; task calendar", async ({ page }) => {
  test.skip([0, 6].includes(today.getDay()), "Tracker emails go out on weekdays only");
  const [wind] = await service(`companies?select=id&name=eq.${encodeURIComponent("Demo Wind Farm LLC (fake)")}`);
  const [task] = await service("tasks", { method: "POST", body: JSON.stringify({ company_id: wind.id, title: `Fake T8 overdue check ${run}`, standard_code: "PRC-005", due_date: twoDaysAgo, assignee_email: ASSIGNEE }) });
  const [contact] = await service("contacts", { method: "POST", body: JSON.stringify({ company_id: wind.id, kind: "compliance", name: "Fake Contact", email: CONTACT, digest: true }) });
  await service("app_settings?key=eq.emails_enabled", { method: "PATCH", body: JSON.stringify({ value: true }) });

  try {
    const first = await job();
    expect(first.error).toBeUndefined();
    expect(first.sent).toBeGreaterThanOrEqual(2);

    // The client's contact: their client's digest, with the overdue task.
    const [digest] = await inbox(CONTACT);
    expect(digest.Subject).toMatch(/^Demo Wind Farm LLC \(fake\): \d+ overdue/);
    const d = await full(digest.ID);
    expect(d.Text).toContain(`Fake T8 overdue check ${run}`);
    expect(d.Text).not.toContain(CONTACT);
    // The assignee: a reminder.
    const [rem] = await inbox(ASSIGNEE);
    expect(rem.Subject).toBe(`Reminder: Fake T8 overdue check ${run} is 2 days overdue`);

    // Not twice in a day.
    await job();
    expect(await inbox(CONTACT)).toHaveLength(1);
    expect(await inbox(ASSIGNEE)).toHaveLength(1);

    // Unsubscribe without a login (the link carries no email address), then the digest stops.
    const link = d.Text.match(/Unsubscribe: (\S+)/)![1];
    expect(link).toMatch(/\/unsubscribe\?x=[\w-]+$/);
    expect(link).not.toContain("fake.example");
    await page.goto(link.replace(/^https?:\/\/[^/]+/, ""));
    await expect(page.getByText("Stop sending you the weekday CGM Compliance Tracker digest?")).toBeVisible();
    await page.getByRole("button", { name: "Unsubscribe" }).click();
    await expect(page.getByText("You’re unsubscribed from the weekday CGM Compliance Tracker digest.".replace("’", "'"))).toBeVisible();
    expect(await service(`email_optouts?select=kind&email=eq.${CONTACT}`)).toEqual([{ kind: "tracker_digest" }]);
    await service(`tracker_email_log?recipient=eq.${CONTACT}`, { method: "DELETE" });
    await job();
    expect(await inbox(CONTACT)).toHaveLength(1);

    // One-click unsubscribe from the mail app's header.
    const r = await full(rem.ID);
    const oneClick = r.Text.match(/Unsubscribe: \S+\?x=([\w-]+)/)![1];
    const res = await fetch(`http://localhost:3000/api/unsubscribe?x=${oneClick}`, { method: "POST" });
    expect(await res.json()).toEqual({ unsubscribed: "tracker_reminders" });
    expect((await fetch(`http://localhost:3000/api/unsubscribe?x=${oneClick.slice(0, -2)}AA`, { method: "POST" })).status).toBe(400);

    // The account page: a person's own settings.
    await signIn(page, "member@wind.example", "/account");
    const box = page.locator("#tracker-emails");
    await box.getByLabel(/One notice a day when I have new unread messages/).uncheck();
    await box.getByRole("button", { name: "Save email settings" }).click();
    await expect(page.getByText("Preferences saved.")).toBeVisible();
    expect(await service("email_optouts?select=kind&email=eq.member@wind.example")).toEqual([{ kind: "messages" }]);
    await page.locator("#tracker-emails").getByLabel(/One notice a day/).check();
    await page.locator("#tracker-emails").getByRole("button", { name: "Save email settings" }).click();
    await expect.poll(() => service("email_optouts?select=kind&email=eq.member@wind.example")).toEqual([]);

    // Task calendar: their company's tasks only.
    const feed = (await page.locator("code", { hasText: "/api/calendar/tracker/" }).innerText()).trim();
    const ics = await (await page.request.get(feed.replace(/^https?:\/\/[^/]+/, ""))).text();
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain(`UID:task-${task.id}@cgm-compliance-tracker`);
    const [peaker] = await service("profiles?select=calendar_token&email=eq.admin@peaker.example");
    const other = await (await page.request.get(`/api/calendar/tracker/${peaker.calendar_token}`)).text();
    expect(other).not.toContain(task.id);
    expect((await page.request.get("/api/calendar/tracker/00000000-0000-0000-0000-000000000000")).status()).toBe(404);

    // The Admin page previews today's emails without sending.
    await page.context().clearCookies();
    await signIn(page, "admin@cgm.example", "/workspace");
    await page.goto("/admin");
    await page.getByRole("link", { name: "Preview today's Tracker emails" }).click();
    await expect(page.locator("#tracker-emails caption")).toContainText("What would go out today");
  } finally {
    await service("app_settings?key=eq.emails_enabled", { method: "PATCH", body: JSON.stringify({ value: false }) });
    for (const e of [CONTACT, ASSIGNEE]) {
      await service(`email_optouts?email=eq.${e}`, { method: "DELETE" });
      await service(`tracker_email_log?recipient=eq.${e}`, { method: "DELETE" });
      await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${e}"`)}`, { method: "DELETE" });
    }
    await service("email_optouts?email=eq.member@wind.example", { method: "DELETE" });
    await service(`contacts?id=eq.${contact.id}`, { method: "DELETE" });
    await service(`tasks?id=eq.${task.id}`, { method: "DELETE" });
  }
});
