import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// T6 acceptance: a client user discusses a task in their company's channel and messages their CGM project manager;
// CGM sees both (with an unread count); another company sees neither, by screen or by direct API call.
// A message can be deleted by its author only (it shows as deleted). Fake records only; clean-up uses the local
// service key (local test database only).

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
  return res.json().catch(() => null);
}
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

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await expect(page.getByRole("button", { name: "Send" })).toBeEnabled(); // the page is interactive
  await page.getByLabel("Message", { exact: true }).press("Enter");
  await page.waitForURL(/sent=1/);
}

test("a client discusses a task and messages their PM; CGM sees it; another company can't", async ({ page, browser }) => {
  const [wind] = await service(`companies?select=id&name=eq.${encodeURIComponent("Demo Wind Farm LLC (fake)")}`);
  const [peaker] = await service(`companies?select=id&name=eq.${encodeURIComponent("Sample Peaker LLC (fake)")}`);
  const [pm] = await service(`profiles?select=id&email=eq.pm@cgm.example`);
  const [task] = await service("tasks", { method: "POST", body: JSON.stringify({ company_id: wind.id, title: `Fake T6 relay test ${run}`, due_date: "2099-02-28" }) });
  const hello = `Fake question about the relay test ${run}, see https://example.com/fake-${run}`;
  const toPm = `Fake note for our PM ${run}`;
  const ctx = await browser.newContext();

  try {
    // Client: from the task, Discuss opens the company channel with the task linked.
    await signIn(page, "member@wind.example", "/tracker");
    await page.goto(`/tracker/tasks?status=all&t=${task.id}`);
    await page.getByRole("link", { name: "Discuss" }).click();
    await expect(page).toHaveURL(new RegExp(`/tracker/messages\\?client=${wind.id}&task=${task.id}`));
    await expect(page.getByRole("heading", { level: 2, name: "Demo Wind Farm LLC (fake)" })).toBeVisible();
    await expect(page.getByLabel("Link task")).toHaveValue(task.id);
    await send(page, hello);
    const mine = page.getByRole("article").filter({ hasText: hello });
    await expect(mine).toBeVisible();
    await expect(mine.getByRole("link", { name: `https://example.com/fake-${run}` })).toHaveAttribute("rel", /noopener/);
    await expect(mine.getByRole("link", { name: new RegExp(`Fake T6 relay test ${run}`) })).toHaveAttribute("href", `/tracker/tasks?status=all&t=${task.id}`);

    // Delete own message: it stays as "Message deleted".
    await send(page, `Fake typo message ${run}`);
    await page.getByRole("article").filter({ hasText: `Fake typo message ${run}` }).getByRole("button", { name: "Delete this message" }).click();
    await expect(page.getByText(`Fake typo message ${run}`)).toHaveCount(0);
    await expect(page.getByText("Message deleted").last()).toBeVisible();

    // Direct message to the company's CGM project manager.
    await page.getByRole("link", { name: /your CGM project manager/ }).first().click();
    await expect(page.getByRole("heading", { level: 2, name: /Pat Manager \(your CGM project manager\)/ })).toBeVisible();
    await send(page, toPm);
    await expect(page.getByRole("article").filter({ hasText: toPm })).toBeVisible();

    // The database refuses a direct message with anyone but their own PM, and another company's channel.
    const token = await tokenOf(page);
    const [admin] = await service(`profiles?select=id&email=eq.admin@cgm.example`);
    const me = (await asUser(token, "rpc/people_names", { method: "POST", body: JSON.stringify({ ids: [] }) })).status;
    expect(me).toBe(200);
    const dm = await asUser(token, "chats", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ type: "dm", members: [admin.id, (await asUser(token, "profiles?select=id&email=eq.member@wind.example")).body[0].id] }) });
    expect(dm.status).toBe(403);
    const other = await asUser(token, "chats", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ type: "client", company_id: peaker.id }) });
    expect(other.status).toBe(403);
    expect((await asUser(token, `chats?select=id&company_id=eq.${peaker.id}`)).body).toEqual([]);

    // Another company's user sees none of it.
    const peakerPage = await ctx.newPage();
    await signIn(peakerPage, "admin@peaker.example", "/tracker/messages");
    await expect(peakerPage.getByText(hello)).toHaveCount(0);
    await expect(peakerPage.getByRole("navigation", { name: "Conversations" }).getByText("Demo Wind Farm LLC (fake)")).toHaveCount(0);
    const ptoken = await tokenOf(peakerPage);
    expect((await asUser(ptoken, `chat_messages?select=id&body=ilike.*${run}*`)).body).toEqual([]);
    await peakerPage.close();

    // CGM's PM: an unread count, the client channel and the direct message.
    await page.context().clearCookies();
    await signIn(page, "pm@cgm.example", "/tracker");
    await expect(page.locator("nav.appnav a", { hasText: "Messages" }).locator(".badge")).toBeVisible();
    await page.goto("/tracker/messages");
    await page.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: "Demo Wind Farm LLC (fake)" }).click();
    await expect(page.getByRole("article").filter({ hasText: hello })).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: hello }).getByText("Will Wind")).toBeVisible();
    await expect(page.getByRole("article").filter({ hasText: hello }).getByRole("button", { name: "Delete this message" })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Conversations" }).getByRole("link", { name: "Will Wind" }).click();
    await expect(page.getByRole("article").filter({ hasText: toPm })).toBeVisible();
    expect(pm.id).toBeTruthy();
  } finally {
    await ctx.close();
    const chats = (await service(`chats?select=id,type,members,company_id`)) as { id: string; type: string; members: string[]; company_id: string | null }[];
    const [wm] = await service(`profiles?select=id&email=eq.member@wind.example`);
    for (const c of chats.filter((c) => (c.type === "client" && c.company_id === wind.id) || (c.type === "dm" && c.members.includes(wm.id)))) {
      await service(`chat_messages?chat_id=eq.${c.id}`, { method: "DELETE" });
      await service(`chats?id=eq.${c.id}`, { method: "DELETE" });
    }
    await service(`tasks?id=eq.${task.id}`, { method: "DELETE" });
  }
});
