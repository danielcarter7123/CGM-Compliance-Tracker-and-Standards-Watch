import { expect, test } from "@playwright/test";
import { navLinks, signIn } from "./helpers";

// F1 acceptance: each role sees exactly the sections docs/ACCESS.md allows, and typing any other URL redirects.
// Fake users come from scripts/seed-dev.ts.

type Case = {
  email: string;
  nav: string[];
  allowed: string[];
  denied: [path: string, landsOn: string][];
  trackerLocked?: boolean;
};

const CASES: Record<string, Case> = {
  "CGM admin": {
    email: "admin@cgm.example",
    nav: ["Watch", "Tracker", "Review queue", "Digest", "Admin", "Account"],
    allowed: ["/watch", "/tracker", "/admin", "/admin/review", "/admin/digest", "/account"],
    denied: [],
  },
  "CGM project manager": {
    email: "pm@cgm.example",
    nav: ["Watch", "Tracker", "Account"],
    allowed: ["/watch", "/tracker", "/account"],
    denied: [["/admin", "/watch"], ["/admin/review", "/watch"], ["/admin/digest", "/watch"]],
  },
  "CGM staff": {
    email: "staff@cgm.example",
    nav: ["Watch", "Tracker", "Account"],
    allowed: ["/watch", "/tracker", "/account"],
    denied: [["/admin", "/watch"], ["/admin/review", "/watch"]],
  },
  "Watch-only client admin": {
    email: "admin@watch.example",
    nav: ["Watch", "Tracker", "Account"],
    trackerLocked: true,
    allowed: ["/watch", "/account"],
    denied: [["/tracker", "/account"], ["/admin", "/watch"], ["/admin/review", "/watch"]],
  },
  "Tracker + Client Tasks client admin": {
    email: "admin@peaker.example",
    nav: ["Watch", "Tracker", "Account"],
    allowed: ["/watch", "/tracker", "/account"],
    denied: [["/admin", "/watch"], ["/admin/digest", "/watch"]],
  },
  "Tracker + Client Tasks member": {
    email: "member@peaker.example",
    nav: ["Watch", "Tracker", "Account"],
    allowed: ["/watch", "/tracker", "/account"],
    denied: [["/admin", "/watch"]],
  },
  "Tracker-only member": {
    email: "member@wind.example",
    nav: ["Watch", "Tracker", "Account"],
    allowed: ["/watch", "/tracker", "/account"],
    denied: [["/admin", "/watch"]],
  },
  "Signed in, no plan": {
    email: "noplan@nowhere.example",
    nav: ["Tracker", "Account", "Subscribe"],
    trackerLocked: true,
    allowed: ["/account"],
    denied: [["/watch", "/account"], ["/tracker", "/account"], ["/admin", "/account"], ["/admin/review", "/account"]],
  },
};

test("signed out: only public pages; protected URLs go to sign-in", async ({ page }) => {
  await page.goto("/");
  expect(await navLinks(page)).toEqual(["Sign in", "Subscribe"]);
  for (const path of ["/watch", "/tracker", "/admin", "/account"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
  }
});

for (const [role, c] of Object.entries(CASES)) {
  test(`${role}: sees exactly the allowed sections`, async ({ page }) => {
    await signIn(page, c.email);
    expect(await navLinks(page)).toEqual(c.nav);
    const tracker = page.locator("nav.sitenav a", { hasText: "Tracker" });
    if (c.trackerLocked) await expect(tracker).toHaveClass(/locked/);
    else await expect(tracker).not.toHaveClass(/locked/);

    for (const path of c.allowed) {
      await page.goto(path);
      await expect(page, `${role} should open ${path}`).toHaveURL(new RegExp(`${path}(\\?|$)`));
    }
    for (const [path, landsOn] of c.denied) {
      await page.goto(path);
      await expect(page, `${role} must not open ${path}`).toHaveURL(new RegExp(`${landsOn}(\\?|$)`));
    }
  });
}

test("Tracker clients see only their own company on the dashboard; staff see every client", async ({ page }) => {
  await signIn(page, "member@wind.example", "/tracker");
  await expect(page.locator("main h1")).toHaveText("Demo Wind Farm LLC (fake)");
  await expect(page.locator("table.grid tbody tr")).toHaveCount(1);
  await expect(page.getByText("Sample Peaker LLC (fake)")).toHaveCount(0);
  await expect(page.locator(".trk-tabs")).not.toContainText("Clients");
  await expect(page.locator(".trk-tabs")).not.toContainText("Team Tasks");

  await page.context().clearCookies();
  await signIn(page, "staff@cgm.example", "/tracker");
  await expect(page.locator("main h1")).toHaveText("All clients");
  await expect(page.locator("table.grid tbody tr")).toHaveCount(2);
  await expect(page.locator(".trk-tabs")).toContainText("Team Tasks");
});

test("CGM admin turns automated emails on and off, and switches a company's products", async ({ page }) => {
  await signIn(page, "admin@cgm.example", "/admin");
  await expect(page.getByText("scheduled digests are off")).toBeVisible();
  await page.getByRole("button", { name: "Turn emails on" }).click();
  await expect(page.getByText("Automated emails are on.")).toBeVisible();
  await page.getByRole("button", { name: "Turn emails off" }).click();
  await expect(page.getByText("Automated emails are off.")).toBeVisible();

  // Give the Watch-only company the Tracker, check its user, then take it away again.
  const row = page.locator("table.grid").first().locator("tbody tr", { hasText: "Example Watch Co (fake)" });
  await row.getByLabel("Compliance Tracker").check();
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Products updated.")).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, "admin@watch.example", "/account");
  await page.goto("/tracker");
  await expect(page).toHaveURL(/\/tracker$/);

  await page.context().clearCookies();
  await signIn(page, "admin@cgm.example", "/admin");
  const row2 = page.locator("table.grid").first().locator("tbody tr", { hasText: "Example Watch Co (fake)" });
  await row2.getByLabel("Compliance Tracker").uncheck();
  await row2.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Products updated.")).toBeVisible();
});
