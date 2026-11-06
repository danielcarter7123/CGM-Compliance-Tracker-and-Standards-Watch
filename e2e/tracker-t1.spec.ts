import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// T1: standards library and clients. Fake accounts and fake records only; anything created is removed again.
const run = Date.now().toString(36).toUpperCase();

test("library: a PM edits a standard's version and link, adds and deletes a standard", async ({ page }) => {
  await signIn(page, "pm@cgm.example", "/tracker/standards");
  await expect(page.getByRole("heading", { name: "Standards library" })).toBeVisible();
  await expect(page.locator(".trk-head .mono")).toHaveText("48 of 48");

  // Expand PRC-005, change its version, then put it back.
  await page.goto("/tracker/standards?open=PRC-005");
  const prc = page.locator(".stdgroup", { has: page.locator("#ver-PRC-005") });
  if (await prc.getByRole("button", { name: "Reset to nerc.com default" }).count()) {
    await prc.getByRole("button", { name: "Reset to nerc.com default" }).click(); // leftover from an interrupted run
    await expect(page.getByText("PRC-005 links to the nerc.com PDF again.")).toBeVisible();
  }
  const ver = page.locator("#ver-PRC-005");
  const original = await ver.inputValue();
  await ver.fill("99");
  await page.locator("form", { has: ver }).getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText("PRC-005 is now version 99. Every link uses it.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open PRC-005-99 ↗" })).toHaveAttribute("href", /PRC-005-99\.pdf$/);
  await page.locator("#ver-PRC-005").fill(original);
  await page.locator("form", { has: page.locator("#ver-PRC-005") }).getByRole("button", { name: "Save version" }).click();
  await expect(page.getByText(`PRC-005 is now version ${original}.`)).toBeVisible();

  // Custom link, then back to the nerc.com default.
  await page.locator("#url-PRC-005").fill("https://example.com/fake-prc-005");
  await page.getByRole("button", { name: "Save link" }).first().click();
  await expect(page.getByText("PRC-005 link saved.")).toBeVisible();
  await expect(page.locator(".stdgroup", { has: page.locator("#ver-PRC-005") }).getByText("Custom link", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reset to nerc.com default" }).click();
  await expect(page.getByText("PRC-005 links to the nerc.com PDF again.")).toBeVisible();

  // New standard, number checked, then deleted.
  const code = `FAK-${run}`;
  await page.goto("/tracker/standards?new=1");
  let form = page.getByRole("region", { name: "New standard" });
  await form.getByLabel("Standard number").fill("not a number");
  await form.getByLabel("Version").fill("1");
  await form.getByLabel("Title").fill("Fake standard for tests");
  await form.getByRole("button", { name: "Add standard" }).click();
  await expect(page.getByText("Enter the standard number like PRC-031 or BAL-001-TRE.")).toBeVisible();
  form = page.getByRole("region", { name: "New standard" });
  await form.getByLabel("Standard number").fill(code);
  await form.getByLabel("Version").fill("1");
  await form.getByLabel("Title").fill("Fake standard for tests");
  await form.getByRole("button", { name: "Add standard" }).click();
  await expect(page.getByText(`${code}-1 added to the library.`)).toBeVisible();
  await page.goto(`/tracker/standards?edit=${code}`);
  await page.getByRole("button", { name: `Delete ${code}` }).click();
  await expect(page.getByText(`${code} removed from the library.`)).toBeVisible();

  // Recurrence settings: suggested rows are marked, with open-task counts.
  await page.goto("/tracker/standards/recurrence");
  await expect(page.getByRole("heading", { name: "Recurrence settings" })).toBeVisible();
  await expect(page.locator("tbody tr").first()).toBeVisible();
});

test("library: staff and clients read it but can't edit; clients don't get the Clients section", async ({ page }) => {
  await signIn(page, "staff@cgm.example", "/tracker/standards");
  await expect(page.getByRole("link", { name: "New standard" })).toHaveCount(0);
  await page.goto("/tracker/standards?open=PRC-005");
  await expect(page.locator("#ver-PRC-005")).toHaveCount(0);
  await page.goto("/tracker/standards/recurrence");
  await expect(page).toHaveURL(/\/tracker\/standards$/);

  await page.context().clearCookies();
  await signIn(page, "member@wind.example", "/tracker/standards");
  await expect(page.locator(".trk-head .mono")).toHaveText("48 of 48");
  await expect(page.getByRole("link", { name: "Edit standard details" })).toHaveCount(0);
  await page.goto("/tracker/clients");
  await expect(page).toHaveURL(/\/tracker$/);
});

test("clients: a PM adds a client with contacts and mapped entities; staff only view; an admin turns the Tracker on and deletes it", async ({ page }) => {
  const name = `Fake Client ${run} LLC`;
  await signIn(page, "pm@cgm.example", "/tracker/clients");
  await page.getByRole("link", { name: "Add client" }).click();
  await page.waitForLoadState("networkidle"); // the function checkboxes are interactive once the page script has loaded
  await page.getByLabel("Registered entity name").fill(name);
  await page.getByLabel("NCR ID").fill("NCR00000");
  await page.getByLabel("Regional Entity").selectOption("WECC");
  // Mapped entities follow the functions: a TO maps to a Transmission Service Provider, a GO alone doesn't.
  await expect(page.getByLabel(/Transmission Service Provider/)).toBeHidden();
  await page.getByRole("checkbox", { name: "TO", exact: true }).check();
  await expect(page.getByLabel(/Transmission Service Provider/)).toBeVisible();
  await page.getByLabel(/Reliability Coordinator/).fill("Fake RC / NCR00001");
  await page.getByLabel("Primary compliance contact", { exact: true }).fill("Casey Contact (fake)");
  await page.getByLabel("Primary compliance contact email").fill("not-an-email");
  // The browser refuses a malformed email before anything is sent (the server checks again).
  expect(await page.getByLabel("Primary compliance contact email").evaluate((el) => (el as HTMLInputElement).checkValidity())).toBe(false);
  await page.getByLabel("Primary compliance contact email").fill("casey@fake.example");
  await page.getByRole("button", { name: "Add client" }).click();
  await expect(page.getByText(`${name} added.`)).toBeVisible();
  const row = page.locator(".clienttable tbody tr", { hasText: name });
  await expect(row).toContainText("TRACKER OFF");
  await expect(row).toContainText("Casey Contact (fake)");
  await expect(row).toContainText("1 mapped entity");
  // PMs can't change products.
  await expect(page.getByRole("button", { name: "Save products" })).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, "staff@cgm.example", "/tracker/clients");
  await page.locator(".clienttable .rowlink", { hasText: name }).click();
  await expect(page.getByText("You can view clients. CGM project managers and admins edit them.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);

  await page.context().clearCookies();
  await signIn(page, "admin@cgm.example", "/tracker/clients");
  await page.locator(".clienttable .rowlink", { hasText: name }).click();
  await page.getByLabel("CGM Compliance Tracker").check();
  await page.getByRole("button", { name: "Save products" }).click();
  await expect(page.getByText("Products updated.")).toBeVisible();
  await expect(page.locator(".clienttable tbody tr", { hasText: name })).not.toContainText("TRACKER OFF");
  await page.getByRole("button", { name: "Delete client" }).click();
  await expect(page.getByText("Tick the box to confirm.")).toBeVisible();
  await page.getByLabel(new RegExp(`Delete ${name}`)).check();
  await page.getByRole("button", { name: "Delete client" }).click();
  await expect(page.getByText(`${name} and its tasks were deleted.`)).toBeVisible();
  await expect(page.locator(".clienttable tbody tr", { hasText: name })).toHaveCount(0);
});
