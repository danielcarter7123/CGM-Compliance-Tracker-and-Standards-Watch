import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

// W2: invites, first-login welcome, removal and seats. Needs db:start and seed:dev. Fake addresses only.
const MAILPIT = "http://127.0.0.1:54324";
const run = Date.now().toString(36);

test("a company admin invites a colleague, who joins on sign-in, sets up, and can be removed", async ({ browser }) => {
  const newbie = `newbie-${run}@peaker.example`;

  const admin = await browser.newPage();
  await signIn(admin, "admin@peaker.example", "/account");
  await expect(admin.getByRole("heading", { name: "Your team" })).toBeVisible();
  await admin.getByLabel("Invite a colleague").fill(newbie);
  await admin.getByRole("button", { name: "Send invite" }).click();
  await expect(admin.getByText(`Invite sent to ${newbie}.`)).toBeVisible();
  await expect(admin.locator("table.team")).toContainText(newbie);

  // The invite email arrived in the local mail catcher.
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${newbie}" subject:invited`)}`);
  const { messages } = (await res.json()) as { messages: { Subject: string }[] };
  expect(messages[0]?.Subject).toContain("invited you to Sample Peaker LLC (fake)");

  // The invitee signs in with that address and lands on the welcome screen, already in the company.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page, newbie, "/welcome");
  await expect(page.getByRole("heading", { name: "Welcome to CGM Compliance Tracker, Sample Peaker LLC (fake)" })).toBeVisible();
  await expect(page.getByLabel("GO", { exact: true })).toBeChecked(); // started from the company's functions
  await page.getByLabel("Your name").fill("Nina Newbie (fake)");
  await page.getByLabel("Regional Entity").selectOption("SERC");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/watch$/);
  await page.goto("/tracker");
  await expect(page).toHaveURL(/\/tracker$/);
  await page.goto("/account");
  await expect(page.getByLabel("Regional Entity")).toHaveValue("SERC");
  await expect(page.getByRole("heading", { name: "Your team" })).toHaveCount(0); // members don't manage the team

  // The admin removes them; access ends at once.
  await admin.reload();
  await admin.getByRole("button", { name: `Remove ${newbie}` }).click();
  await expect(admin.getByText("Removed from your company.")).toBeVisible();
  await page.goto("/tracker");
  await expect(page).toHaveURL(/\/account\?need=tracker/);
  await ctx.close();
});

test("seats: invites stop when every seat is used, and revoking frees one", async ({ page }) => {
  await signIn(page, "admin@peaker.example", "/account");
  const seatsLine = page.getByText(/\d+ of \d+ seats used/);
  const [used, total] = ((await seatsLine.innerText()).match(/(\d+) of (\d+)/) || []).slice(1).map(Number);
  const extra = total - used;
  for (let i = 0; i < extra; i++) {
    await page.getByLabel("Invite a colleague").fill(`seat${i}-${run}@peaker.example`);
    await page.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText(`Invite sent to seat${i}-${run}@peaker.example.`)).toBeVisible();
  }
  await expect(page.getByText(`${total} of ${total} seats used`)).toBeVisible();
  await expect(page.getByLabel("Invite a colleague")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "ask CGM for more seats" })).toBeVisible();

  for (let i = 0; i < extra; i++) {
    await page.getByRole("button", { name: `Revoke invite for seat${i}-${run}@peaker.example` }).click();
    await expect(page.getByText("Invite revoked.")).toBeVisible();
  }
  await expect(page.getByText(`${used} of ${total} seats used`)).toBeVisible();
});

test("members can't manage the team", async ({ page }) => {
  await signIn(page, "member@peaker.example", "/account");
  await expect(page.getByRole("heading", { name: "Your team" })).toHaveCount(0);
});
