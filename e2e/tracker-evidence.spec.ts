import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// T5b evidence (uploads and links; SharePoint waits for CGM's Microsoft registration): a client user uploads a
// file to their own task, it opens through a short-lived link, it counts as the report, links can be added and
// removed (kept on record), CIP uploads need the no-BCSI confirmation, and another company can't open the file.
// Fake files and records only; clean-up uses the local service key (local test database only).

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL, ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY, SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const run = Date.now().toString(36);
const PDF = Buffer.from(`%PDF-1.4\n% Fake test report ${run}\n%%EOF\n`);

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

test("a client uploads evidence to its own task; it counts as the report; others can't open it", async ({ page }) => {
  const [wind] = await service(`companies?select=id&name=eq.${encodeURIComponent("Demo Wind Farm LLC (fake)")}`);
  const [task] = await service("tasks", { method: "POST", body: JSON.stringify({ company_id: wind.id, title: `Fake T5b battery test ${run}`, standard_code: "PRC-005", due_date: "2099-05-31" }) });
  const [cip] = await service("tasks", { method: "POST", body: JSON.stringify({ company_id: wind.id, title: `Fake T5b access review ${run}`, standard_code: "CIP-004", due_date: "2099-05-31" }) });
  const paths: string[] = [];

  try {
    await signIn(page, "member@wind.example", "/tracker");
    await page.goto(`/tracker/tasks?status=all&t=${task.id}`);
    const panel = page.getByRole("region", { name: "Evidence" });
    await expect(panel).toContainText("No evidence yet.");

    // A type that isn't accepted.
    await panel.getByLabel("Upload a file").setInputFiles({ name: "fake.exe", mimeType: "application/octet-stream", buffer: Buffer.from("x") });
    await expect(panel.getByRole("status")).toHaveText("That type of file isn't accepted.");
    await expect(panel.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();

    // Upload a PDF.
    await panel.getByLabel("Upload a file").setInputFiles({ name: "fake report.pdf", mimeType: "application/pdf", buffer: PDF });
    await panel.getByRole("button", { name: "Upload", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Uploaded fake report.pdf." })).toBeVisible();
    const [ev] = await service(`evidence?select=id,storage_path,sha256,size_bytes,added_by&task_id=eq.${task.id}`);
    paths.push(ev.storage_path);
    expect(ev.storage_path).toMatch(new RegExp(`^${wind.id}/${task.id}/[0-9a-f-]{36}-fake_report\\.pdf$`));
    expect(ev.size_bytes).toBe(PDF.length);
    expect(ev.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(page.getByRole("region", { name: "Evidence" }).getByRole("link", { name: /fake report\.pdf/ })).toHaveAttribute("href", `/tracker/evidence/${ev.id}`);

    // It opens through a short-lived signed link and is the same file.
    const got = await page.request.get(`/tracker/evidence/${ev.id}`);
    expect(got.status()).toBe(200);
    expect(Buffer.from(await got.body()).equals(PDF)).toBe(true);

    // A link, then removed: it stays on record as removed.
    const ev2 = page.getByRole("region", { name: "Evidence" });
    await ev2.getByLabel("Or paste a link").fill("https://example.com/fake-folder");
    await ev2.getByLabel("Link name").fill(`Fake folder ${run}`);
    await ev2.getByRole("button", { name: "Add link" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Link added." })).toBeVisible();
    await page.getByRole("region", { name: "Evidence" }).getByRole("button", { name: `Remove Fake folder ${run}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "stays on record as removed" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Evidence" }).getByText("1 removed", { exact: true })).toBeVisible();

    // Close out without a link: the upload counts as the report.
    await page.locator("summary", { hasText: "Close out task" }).click();
    await page.getByLabel(/I've checked this is the date the work was performed/).check();
    await page.locator("form.closeout").getByRole("button", { name: "Close out task" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Closed out as performed" })).toBeVisible();
    await page.goto(`/tracker/tasks?status=all&q=${run}`);
    await expect(page.locator("tbody tr").filter({ hasText: `Fake T5b battery test ${run}` })).toContainText("awaiting approval");

    // CIP: uploading needs the no-BCSI confirmation.
    await page.goto(`/tracker/tasks?status=all&t=${cip.id}`);
    const cipPanel = page.getByRole("region", { name: "Evidence" });
    await cipPanel.getByLabel("Upload a file").setInputFiles({ name: "fake-list.pdf", mimeType: "application/pdf", buffer: PDF });
    await expect(cipPanel.getByRole("button", { name: "Upload", exact: true })).toBeDisabled();
    await cipPanel.getByLabel(/no BES Cyber System Information/).check();
    await expect(cipPanel.getByRole("button", { name: "Upload", exact: true })).toBeEnabled();

    // Another company: the file can't be opened, listed or downloaded.
    await page.context().clearCookies();
    await signIn(page, "admin@peaker.example", "/tracker");
    expect((await page.request.get(`/tracker/evidence/${ev.id}`, { maxRedirects: 0 })).status()).toBe(404);
    const token = await tokenOf(page);
    const direct = await fetch(`${URL_}/storage/v1/object/authenticated/evidence/${ev.storage_path}`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } });
    expect(direct.ok).toBe(false);
    const list = await fetch(`${URL_}/storage/v1/object/list/evidence`, {
      method: "POST", headers: { apikey: ANON, authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ prefix: `${wind.id}/${task.id}` }),
    });
    expect(await list.json()).toEqual([]);
  } finally {
    for (const p of paths) {
      await fetch(`${URL_}/storage/v1/object/evidence/${p}`, { method: "DELETE", headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}` } });
    }
    await service(`tasks?title=ilike.*${run}*`, { method: "PATCH", body: JSON.stringify({ next_id: null, prev_id: null }) });
    await service(`tasks?title=ilike.*${run}*`, { method: "DELETE" });
  }
});
