import { expect, test } from "@playwright/test";
import { navLinks, sectionLinks, signIn } from "./helpers";

// F1 acceptance: each role sees exactly the sections docs/ACCESS.md allows, and typing any other URL redirects.
// Fake users come from scripts/seed-dev.ts.

type Case = {
  email: string;
  /** Top-right links (account and editor tools). */
  nav: string[];
  /** The section menu under the CGM Compliance Tracker header. */
  sections: string[];
  allowed: string[];
  denied: [path: string, landsOn: string][];
  trackerLocked?: boolean;
};

const CASES: Record<string, Case> = {
  "CGM admin": {
    email: "admin@cgm.example",
    nav: ["Review queue", "Digest", "Admin", "Account"],
    sections: ["Standards Watch", "Dashboard", "Tasks", "Team Tasks", "Standards Library", "Clients", "Messages", "Activity Log"],
    allowed: ["/watch", "/tracker", "/tracker/standards", "/tracker/clients", "/admin", "/admin/review", "/admin/digest", "/account"],
    denied: [],
  },
  "CGM project manager": {
    email: "pm@cgm.example",
    nav: ["Account"],
    sections: ["Standards Watch", "Dashboard", "Tasks", "Team Tasks", "Standards Library", "Clients", "Messages", "Activity Log"],
    allowed: ["/watch", "/tracker", "/tracker/clients", "/account"],
    denied: [["/admin", "/tracker"], ["/admin/review", "/tracker"], ["/admin/digest", "/tracker"]],
  },
  "CGM staff": {
    email: "staff@cgm.example",
    nav: ["Account"],
    sections: ["Standards Watch", "Dashboard", "Tasks", "Team Tasks", "Standards Library", "Clients", "Messages", "Activity Log"],
    allowed: ["/watch", "/tracker", "/tracker/clients", "/account"],
    denied: [["/admin", "/tracker"], ["/admin/review", "/tracker"]],
  },
  "Watch-only client admin": {
    email: "admin@watch.example",
    nav: ["Account"],
    sections: ["Standards Watch", "Compliance Tracker"],
    trackerLocked: true,
    allowed: ["/watch", "/account"],
    denied: [["/tracker", "/account"], ["/tracker/standards", "/account"], ["/admin", "/watch"], ["/admin/review", "/watch"]],
  },
  "Tracker + Client Tasks client admin": {
    email: "admin@peaker.example",
    nav: ["Account"],
    sections: ["Standards Watch", "Dashboard", "Tasks", "Client Tasks", "Standards Library", "Messages", "Activity Log"],
    allowed: ["/watch", "/tracker", "/tracker/standards", "/account"],
    denied: [["/admin", "/tracker"], ["/admin/digest", "/tracker"], ["/tracker/clients", "/tracker"]],
  },
  "Tracker + Client Tasks member": {
    email: "member@peaker.example",
    nav: ["Account"],
    sections: ["Standards Watch", "Dashboard", "Tasks", "Client Tasks", "Standards Library", "Messages", "Activity Log"],
    allowed: ["/watch", "/tracker", "/account"],
    denied: [["/admin", "/tracker"]],
  },
  "Tracker-only member": {
    email: "member@wind.example",
    nav: ["Account"],
    sections: ["Standards Watch", "Dashboard", "Tasks", "Standards Library", "Messages", "Activity Log"],
    allowed: ["/watch", "/tracker", "/account"],
    denied: [["/admin", "/tracker"]],
  },
  "Signed in, no plan": {
    email: "noplan@nowhere.example",
    nav: ["Account", "Standards Watch plans"],
    sections: ["Compliance Tracker"],
    trackerLocked: true,
    allowed: ["/account"],
    denied: [["/watch", "/account"], ["/tracker", "/account"], ["/admin", "/account"], ["/admin/review", "/account"]],
  },
};

test("signed out: only public pages; protected URLs go to sign-in", async ({ page }) => {
  // The front door is the split-screen sign-in page, with no app header around it.
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.locator("header.mast")).toHaveCount(0);
  // The Standards Watch offer page for prospective subscribers.
  await page.goto("/standards-watch");
  await expect(page.locator(".mast .bname")).toContainText("CGM Compliance Tracker");
  await expect(page.locator(".watchname")).toHaveText("NERC Standards Watch");
  expect(await navLinks(page)).toEqual(["Sign in", "Standards Watch plans"]);
  expect(await sectionLinks(page)).toEqual([]);
  for (const path of ["/watch", "/tracker", "/admin", "/account"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
  }
});

for (const [role, c] of Object.entries(CASES)) {
  test(`${role}: sees exactly the allowed sections`, async ({ page }) => {
    await signIn(page, c.email);
    await expect(page.locator(".mast .bname")).toContainText("CGM Compliance Tracker");
    expect(await navLinks(page)).toEqual(c.nav);
    expect(await sectionLinks(page)).toEqual(c.sections);
    const tracker = page.locator("nav.appnav > a", { hasText: "Compliance Tracker" });
    if (c.trackerLocked) await expect(tracker).toHaveClass(/locked/);
    else await expect(tracker).toHaveCount(0);

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

test("the name NERC Standards Watch is the Watch page's own; everything else is CGM Compliance Tracker", async ({ page }) => {
  await signIn(page, "member@wind.example", "/watch");
  await expect(page).toHaveTitle("NERC Standards Watch | CGM Compliance Tracker");
  await expect(page.locator(".watchname")).toHaveText("NERC Standards Watch");
  await page.goto("/tracker/standards");
  await expect(page).toHaveTitle("Standards library | CGM Compliance Tracker");
  await expect(page.locator(".watchname")).toHaveCount(0);
  await page.goto("/");
  await expect(page).toHaveURL(/\/tracker$/); // signed-in Tracker users open the app on the Dashboard
});

test("Tracker clients see only their own company on the dashboard; staff see every client", async ({ page }) => {
  await signIn(page, "member@wind.example", "/tracker");
  await expect(page.locator("main h1")).toHaveText("Demo Wind Farm LLC (fake)");
  await expect(page.locator("table.grid tbody tr")).toHaveCount(1);
  await expect(page.getByText("Sample Peaker LLC (fake)")).toHaveCount(0);
  await expect(page.locator("nav.appnav")).not.toContainText("Clients");
  await expect(page.locator("nav.appnav")).not.toContainText("Team Tasks");

  await page.context().clearCookies();
  await signIn(page, "staff@cgm.example", "/tracker");
  await expect(page.locator("main h1")).toHaveText("All clients");
  await expect(page.locator("table.grid tbody tr")).toHaveCount(2);
  await expect(page.locator("nav.appnav")).toContainText("Team Tasks");
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
