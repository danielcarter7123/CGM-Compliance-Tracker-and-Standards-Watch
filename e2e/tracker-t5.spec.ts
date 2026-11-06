import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// T5 acceptance: a client user of company A can't reach company B by any URL or direct API call. They can mark
// their own task performed with evidence; they can't change due dates, and are told why.
// Set-up and clean-up use the local service key (local test database only; fake records only).

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const run = Date.now().toString(36);

async function service(path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  });
  return res.json();
}

/** The signed-in person's own access token, read from the Supabase session cookie, to call the API as them. */
async function tokenOf(page: Page) {
  const cookies = (await page.context().cookies()).filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  let raw = decodeURIComponent(cookies.map((c) => c.value).join(""));
  if (raw.startsWith("base64-")) raw = Buffer.from(raw.slice(7), "base64").toString("utf8");
  return JSON.parse(raw).access_token as string;
}
async function asUser(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("a client user can't reach another company by URL or API; marks own task performed; can't change due dates", async ({ page }) => {
  const [wind] = await service(`companies?select=id&name=eq.${encodeURIComponent("Demo Wind Farm LLC (fake)")}`);
  const [peaker] = await service(`companies?select=id&name=eq.${encodeURIComponent("Sample Peaker LLC (fake)")}`);
  const [mine] = await service("tasks", { method: "POST", body: JSON.stringify({ company_id: wind.id, title: `Fake T5 wind task ${run}`, due_date: "2099-01-31" }) });
  const [theirs] = await service("tasks", { method: "POST", body: JSON.stringify({ company_id: peaker.id, title: `Fake T5 peaker task ${run}`, due_date: "2099-01-31", notes: "secret" }) });

  try {
    await signIn(page, "member@wind.example", "/tracker");

    // By URL: the other company's task, list, export and client record are all out of reach.
    await page.goto(`/tracker/tasks?status=all&t=${theirs.id}`);
    await expect(page.getByRole("region", { name: theirs.title })).toHaveCount(0);
    await expect(page.getByText(theirs.title)).toHaveCount(0);
    await page.goto(`/tracker/tasks?status=all&client=${peaker.id}`);
    await expect(page.locator(".trk-head .mono")).toHaveText("0 shown");
    const csv = await (await page.request.get(`/tracker/tasks/export?status=all&client=${peaker.id}`)).text();
    expect(csv.trim().split("\r\n")).toHaveLength(1); // header only
    await page.goto(`/tracker/clients?c=${peaker.id}`);
    await expect(page).toHaveURL(/\/tracker$/);

    // By direct API call with the user's own token.
    const token = await tokenOf(page);
    expect((await asUser(token, `tasks?select=id&company_id=eq.${peaker.id}`)).body).toEqual([]);
    expect((await asUser(token, `tasks?select=id&id=eq.${theirs.id}`)).body).toEqual([]);
    expect(((await asUser(token, "companies?select=id")).body as { id: string }[]).map((c) => c.id)).toEqual([wind.id]);
    expect((await asUser(token, `tasks?id=eq.${theirs.id}`, { method: "PATCH", body: JSON.stringify({ notes: "changed" }) })).body).toEqual([]);
    expect((await asUser(token, "tasks", { method: "POST", body: JSON.stringify({ company_id: peaker.id, title: "Fake injected" }) })).status).toBeGreaterThanOrEqual(400);
    const due = await asUser(token, `tasks?id=eq.${mine.id}`, { method: "PATCH", body: JSON.stringify({ due_date: "2099-12-31" }) });
    expect(due.status).toBeGreaterThanOrEqual(400);
    expect((due.body as { message: string }).message).toBe("Client users can only mark a task performed, post evidence and add notes");
    const [untouched] = await service(`tasks?select=notes&id=eq.${theirs.id}`);
    expect(untouched.notes).toBe("secret");

    // In the app: told why they can't change dates, and they can mark their own task performed with evidence.
    await page.goto(`/tracker/tasks?status=all&t=${mine.id}`);
    const drawer = page.getByRole("region", { name: mine.title });
    await expect(drawer.getByText("CGM sets the due date, repeat schedule and assignee.")).toBeVisible();
    await expect(drawer.getByLabel("Due date")).toHaveCount(0);
    await drawer.getByText("Mark performed").click();
    await drawer.getByLabel("Evidence link (optional)").fill("https://sharepoint.example/fake-evidence");
    await drawer.getByRole("button", { name: "Confirm performed" }).click();
    await expect(page.getByText("Marked performed.")).toBeVisible();
    await expect(page.getByRole("region", { name: mine.title }).locator(".pill")).toHaveText("Pending review");
  } finally {
    await service(`tasks?id=in.(${mine.id},${theirs.id})`, { method: "DELETE" });
  }
});

test("CGM invites a client user from the client's details; the person joins that company", async ({ page, browser }) => {
  const email = `fake-t5-${run}@wind.example`;
  await signIn(page, "pm@cgm.example", "/tracker/clients");
  await page.locator(".clienttable .rowlink", { hasText: "Demo Wind Farm LLC (fake)" }).click();
  const people = page.getByRole("region", { name: "People" });
  await expect(people).toContainText("member@wind.example");
  await people.getByLabel("Invite someone at this client").fill(email);
  await people.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByText(`Invite sent to ${email}.`)).toBeVisible();
  await expect(page.getByRole("region", { name: "People" })).toContainText(email);

  const ctx = await browser.newContext();
  const newbie = await ctx.newPage();
  await signIn(newbie, email, "/welcome");
  await expect(newbie.getByRole("heading", { name: "Welcome to CGM Workspace, Demo Wind Farm LLC (fake)" })).toBeVisible();
  await newbie.getByRole("button", { name: "Continue" }).click();
  await expect(newbie.locator(".ws-card:not(.locked) h3")).toHaveText(["CGM Compliance Tracker"]);
  await ctx.close();

  await page.reload();
  const row = page.getByRole("region", { name: "People" }).locator("li", { hasText: email });
  await row.getByRole("button", { name: `Remove ${email}` }).click();
  await expect(page.getByText("Removed from this client.")).toBeVisible();
});
