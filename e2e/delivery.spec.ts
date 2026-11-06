import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// W5: digest with plain text, corrections and unsubscribe; opt-in alerts (off by default) behind the email switch; calendar feed.
// All mail goes to the local Mailpit catcher. Fake accounts and fake TEST-000 entries only.
const MAILPIT = "http://127.0.0.1:54324";
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const run = Date.now().toString(36);

type Msg = { ID: string; Subject: string };
async function mailsTo(addr: string, subject: string): Promise<Msg[]> {
  const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${addr}" subject:"${subject}"`)}`);
  return ((await r.json()) as { messages: Msg[] }).messages || [];
}
async function clear(addr: string) {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${addr}"`)}`, { method: "DELETE" });
}
async function waitForMail(addr: string, subject: string) {
  for (let i = 0; i < 40; i++) {
    const m = await mailsTo(addr, subject);
    if (m.length) return m[0];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No "${subject}" email for ${addr}`);
}
async function queue(drafts: Record<string, unknown>[]) {
  const res = await fetch("http://localhost:3000/api/drafts", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.DRAFTS_API_TOKEN}` },
    body: JSON.stringify({ drafts: drafts.map((d) => ({ createdBy: "e2e test (fake)", refs: [], ...d })) }),
  });
  expect(res.status, await res.text()).toBe(200);
}
async function approveEverything(page: Page) {
  await page.goto("/watch/review");
  const all = page.getByRole("button", { name: "Approve all" });
  if (await all.count()) {
    await all.click();
    await page.getByRole("button", { name: /Click again to publish all/ }).click();
    await expect(page.getByText(/Published all \d+\./)).toBeVisible();
  } else {
    await page.getByRole("button", { name: "Approve and publish" }).first().click();
    await expect(page.getByText(/^Published: /)).toBeVisible();
  }
}

test("digest: corrections suggested, sent with plain text and unsubscribe; the link turns only the digest off", async ({ page, browser }) => {
  const STD = `TEST-000-${run}`, key = `test-dg-${run}`;
  await queue([{ id: `dg-add-${run}`, section: "items", op: "upsert", key, label: `${STD} (fake)`,
    value: { std: STD, title: "Fake standard (digest test)", fn: ["GO"], topic: "ops", effective: "2099-01-01", what: "Test data.", src: [] } }]);
  await signIn(page, "admin@cgm.example", "/watch/review");
  await approveEverything(page);
  await queue([{ id: `dg-chg-${run}`, section: "items", op: "upsert", key, label: `${STD} (fake) date change`,
    value: { std: STD, title: "Fake standard (digest test)", fn: ["GO"], topic: "ops", effective: "2099-04-01", what: "Test data.", src: [] } }]);
  await approveEverything(page);

  await page.goto("/watch/digest");
  const box = page.getByLabel("Corrections to earlier digests (one per line, optional)");
  await expect(box).toHaveValue(new RegExp(`${STD}: U.S. effective date changed from Jan 1, 2099 to Apr 1, 2099.`));
  await box.fill(`${STD}: U.S. effective date changed from Jan 1, 2099 to Apr 1, 2099. (fake test correction)`);
  await page.getByRole("button", { name: "Update preview" }).click();
  await expect(page.frameLocator("iframe[title='Digest preview']").getByText("(fake test correction)")).toBeVisible();

  await clear("admin@watch.example");
  await page.getByRole("button", { name: "Send this week's digest" }).click();
  await page.getByRole("button", { name: "Click again to send to all subscribers" }).click();
  await expect(page.getByText(/Sent to \d+ subscribers?\./)).toBeVisible();

  const m = await waitForMail("admin@watch.example", "CGM Standards Watch");
  const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string; HTML: string };
  const headers = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}/headers`)).json()) as Record<string, string[]>;
  expect(full.Text).toContain("(fake test correction)");
  expect(full.Text).toContain("awareness only");
  expect(full.HTML).toContain("Corrections to earlier digests");
  expect(headers["List-Unsubscribe-Post"]?.[0]).toBe("List-Unsubscribe=One-Click");
  expect(headers["List-Unsubscribe"]?.[0]).toMatch(/\/api\/unsubscribe\?u=.+&k=digest&t=/);

  // The visible link asks first; confirming turns off the digest only.
  const link = (full.Text.match(/Unsubscribe from this digest: (\S+)/) || [])[1];
  const anon = await browser.newPage();
  await anon.goto(link.replace(/^https?:\/\/[^/]+/, ""));
  await expect(anon.getByText("Stop sending you the weekly Standards Watch digest?")).toBeVisible();
  await anon.getByRole("button", { name: "Unsubscribe" }).click();
  await expect(anon.getByText("You're unsubscribed from the weekly Standards Watch digest.")).toBeVisible();
  await anon.goto(link.replace(/^https?:\/\/[^/]+/, "").replace(/t=[^&]+/, "t=forged"));
  await expect(anon.getByText("This unsubscribe link isn't valid.")).toBeVisible();

  const wa = await browser.newContext();
  const watcher = await wa.newPage();
  await signIn(watcher, "admin@watch.example", "/account");
  await expect(watcher.getByLabel("Email me the weekly digest")).not.toBeChecked();
  await expect(watcher.getByLabel(/Also email me alerts between digests/)).not.toBeChecked(); // alerts are off by default
  await watcher.getByLabel("Email me the weekly digest").check();
  await watcher.getByRole("button", { name: "Save preferences" }).click();
  await expect(watcher.getByText("Preferences saved.")).toBeVisible();
  await wa.close();

  // Take the fake standard back off.
  await queue([{ id: `dg-rm-${run}`, section: "items", op: "remove", key, label: `Remove ${STD} (fake)` }]);
  await approveEverything(page);
});

test("alerts: opt-in only; nothing while emails are off; once on, each alert is sent once; one-click unsubscribe works", async ({ page }) => {
  const STD = `TEST-001-${run}`, key = `test-al-${run}`;
  const job = () => fetch("http://localhost:3000/api/jobs/alerts", { headers: { authorization: `Bearer ${env.CRON_SECRET}` } }).then((r) => r.json());
  expect((await fetch("http://localhost:3000/api/jobs/alerts")).status).toBe(401);

  // Only people who turn alerts on get them.
  await signIn(page, "admin@watch.example", "/account");
  const optIn = page.getByLabel(/Also email me alerts between digests/);
  await expect(optIn).not.toBeChecked();
  await optIn.check();
  await page.getByRole("button", { name: "Save preferences" }).click();
  await expect(page.getByText("Preferences saved.")).toBeVisible();
  await page.context().clearCookies();

  await queue([{ id: `al-add-${run}`, section: "items", op: "upsert", key, label: `${STD} (fake)`,
    value: { std: STD, title: "Fake standard (alert test)", fn: ["GO", "GOP"], topic: "ops", ferc: "2099-01-15", effective: "2099-10-01", what: "Test data.", src: [] } }]);
  await signIn(page, "admin@cgm.example", "/watch/review");
  await approveEverything(page);
  await page.goto("/watch/digest");
  await expect(page.locator(".dlist li", { hasText: `${STD} approved by FERC` })).toBeVisible();
  await expect(page.getByText("Automated emails are off, so nothing is sent.")).toBeVisible();

  expect((await job()).skipped).toMatch(/emails are off/);

  await clear("admin@watch.example");
  await clear("member@wind.example");
  await page.goto("/admin");
  await page.getByRole("button", { name: "Turn emails on" }).click();
  await expect(page.getByText("Automated emails are on.")).toBeVisible();
  try {
    const first = await job();
    expect(first.alerts).toBeGreaterThan(0);
    const m = await waitForMail("admin@watch.example", "Standards Watch");
    const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
    expect(full.Text).toContain(`${STD} approved by FERC`);
    expect(full.Text).toContain(`${STD} takes effect in the U.S. on Oct 1, 2099.`);
    expect((await job()).alerts).toBe(0); // never twice
    expect(await mailsTo("member@wind.example", "Standards Watch")).toHaveLength(0); // didn't opt in, gets nothing

    // One-click unsubscribe from the header turns alerts off.
    const headers = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}/headers`)).json()) as Record<string, string[]>;
    const url = headers["List-Unsubscribe"][0].replace(/^<|>$/g, "").replace(/^https?:\/\/[^/]+/, "http://localhost:3000");
    const r = await fetch(url, { method: "POST", body: "List-Unsubscribe=One-Click", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(r.status).toBe(200);
  } finally {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Turn emails off" }).click();
    await expect(page.getByText("Automated emails are off.")).toBeVisible();
  }
  await page.context().clearCookies();
  await signIn(page, "admin@watch.example", "/account");
  await expect(page.getByLabel(/Also email me alerts between digests/)).not.toBeChecked(); // one-click turned them off again

  await page.context().clearCookies();
  await signIn(page, "admin@cgm.example", "/watch/review");
  await queue([{ id: `al-rm-${run}`, section: "items", op: "remove", key, label: `Remove ${STD} (fake)` }]);
  await approveEverything(page);
});

test("calendar feed: a subscriber's feed is valid iCalendar; unknown tokens get nothing", async ({ page, request }) => {
  await signIn(page, "admin@watch.example", "/account");
  const url = (await page.locator("code", { hasText: "/api/calendar/" }).innerText()).trim().replace(/^https?:\/\/[^/]+/, "");
  const res = await request.get(url);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/calendar");
  const body = await res.text();
  expect(body.startsWith("BEGIN:VCALENDAR\r\n")).toBeTruthy();
  expect(body).toContain("BEGIN:VEVENT");
  const ICAL = (await import("ical.js")).default;
  expect(new ICAL.Component(ICAL.parse(body)).getAllSubcomponents("vevent").length).toBeGreaterThan(0);
  expect((await request.get("/api/calendar/00000000-0000-0000-0000-000000000000")).status()).toBe(404);
});
