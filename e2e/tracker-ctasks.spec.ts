import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// Client Tasks add-on: a client with the add-on keeps its own non-NERC list; completing a repeating task schedules
// the next one from its due date; Discuss links it in the client's channel; CGM sees it; a client without the
// add-on can't reach it by screen, export or API. Fake records only; clean-up uses the local service key.

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

test("a client keeps its own non-NERC tasks; repeats follow the due date; others can't reach them", async ({ page }) => {
  const title = `Fake stormwater inspection ${run}`;
  try {
    await signIn(page, "member@peaker.example", "/tracker");
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Client Tasks" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Client Tasks" })).toBeVisible();

    await page.locator("main").getByRole("link", { name: "New client task" }).click();
    const form = page.getByRole("region", { name: "New client task" });
    await form.getByLabel("Task", { exact: true }).fill(title);
    await expect(form.getByLabel("Client", { exact: true })).toHaveCount(0); // their own company only
    await form.getByLabel("Category").fill("Environmental");
    await form.getByLabel("Assigned to").fill("Fake Contractor Co");
    await form.getByLabel("Responsible party").selectOption("contractor");
    await form.getByLabel("Due date").fill("2026-01-10");
    await form.getByLabel("Priority").selectOption("high");
    await form.getByLabel("Repeats every").fill("3");
    await form.getByLabel("Links").fill("Permit | https://example.com/fake-permit");
    await form.getByRole("button", { name: "Create task" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Client task added." })).toBeVisible();

    const row = page.locator("tbody tr").filter({ hasText: title });
    await expect(row).toContainText("Environmental");
    await expect(row).toContainText("Contractor / vendor");
    await expect(row).toContainText("Every 3 months");
    await expect(row).toContainText("overdue");
    await expect(row.locator("td.hi")).toHaveText("High");
    await expect(page.getByRole("region", { name: title })).toContainText("Completing this one schedules the next for Apr 10, 2026");

    // Complete: the next one is due three months after the due date, not after today.
    await page.getByRole("region", { name: title }).getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByRole("status").filter({ hasText: "The next one is scheduled." })).toBeVisible();
    const chain = await service(`client_tasks?select=id,due_date,status,prev_id,completed_at&title=eq.${encodeURIComponent(title)}&order=due_date`);
    expect(chain.map((t: { due_date: string; status: string }) => [t.due_date, t.status])).toEqual([["2026-01-10", "done"], ["2026-04-10", "notstarted"]]);
    expect(chain[1].prev_id).toBe(chain[0].id);

    // Discuss: the client's channel with the client task linked.
    await page.goto(`/tracker/client-tasks?status=all&t=${chain[1].id}`);
    await page.getByRole("region", { name: title }).getByRole("link", { name: "Discuss" }).click();
    await expect(page.getByLabel("Link task")).toHaveValue(`ctask:${chain[1].id}`);
    await page.getByLabel("Message", { exact: true }).fill(`Fake note on the inspection ${run}`);
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled();
    await page.getByLabel("Message", { exact: true }).press("Enter");
    await page.waitForURL(/sent=1/);
    await expect(page.getByRole("article").filter({ hasText: `Fake note on the inspection ${run}` }).getByRole("link", { name: new RegExp(title) }))
      .toHaveAttribute("href", `/tracker/client-tasks?status=all&t=${chain[1].id}`);

    // Export.
    const csv = (await (await page.request.get(`/tracker/client-tasks/export?status=all&q=${run}`)).text()).trim().split("\r\n");
    expect(csv).toHaveLength(3);
    expect(csv[1]).toContain('"Contractor / vendor"');

    // CGM sees it, with the client named; Demo Wind Farm (no add-on) isn't in the client filter.
    await page.context().clearCookies();
    await signIn(page, "pm@cgm.example", "/tracker");
    await page.goto(`/tracker/client-tasks?q=${run}`);
    await expect(page.locator("tbody tr").filter({ hasText: title })).toContainText("Sample Peaker LLC (fake)");
    await expect(page.getByRole("combobox", { name: "Client" }).locator("option", { hasText: "Demo Wind Farm" })).toHaveCount(0);

    // A client without the add-on: no tab, redirect, export refused, nothing by API.
    await page.context().clearCookies();
    await signIn(page, "member@wind.example", "/tracker");
    await expect(page.getByRole("navigation", { name: "Sections" }).getByText("Client Tasks")).toHaveCount(0);
    await page.goto("/tracker/client-tasks");
    await expect(page).toHaveURL(/\/tracker$/);
    expect((await page.request.get("/tracker/client-tasks/export?status=all")).status()).toBe(403);
    const res = await fetch(`${URL_}/rest/v1/client_tasks?select=id`, { headers: { apikey: ANON, authorization: `Bearer ${await tokenOf(page)}` } });
    expect(await res.json()).toEqual([]);
  } finally {
    await service(`chat_messages?body=ilike.*${run}*`, { method: "DELETE" });
    const rows = (await service(`client_tasks?select=id&title=eq.${encodeURIComponent(title)}`)) || [];
    await service(`client_tasks?title=eq.${encodeURIComponent(title)}`, { method: "PATCH", body: JSON.stringify({ prev_id: null, next_id: null }) });
    for (const r of rows) await service(`client_tasks?id=eq.${r.id}`, { method: "DELETE" });
  }
});
