import { expect, test } from "@playwright/test";
import { navLinks, sectionLinks, signIn } from "./helpers";

// CGM Workspace (decision 17): one sign-in, a launcher, three separate apps. Each role lands on the launcher,
// sees exactly the apps their company has, the Tracker's own header and tabs, and is sent back to the launcher
// from anything else. Fake users come from scripts/seed-dev.ts.

type Case = {
  email: string;
  /** Launcher top-right links (account and admin tools). */
  nav: string[];
  /** Launcher cards marked "Included in your plan". */
  apps: string[];
  plan: string;
  /** CGM Compliance Tracker's section tabs (none when the Tracker isn't in the plan). */
  sections: string[];
  allowed: string[];
  denied: [path: string, landsOn: string][];
};

const ALL = ["CGM Standards Watch", "CGM Compliance Tracker", "CGM Powerworks"];
const STAFF_TABS = ["Dashboard", "Tasks", "Client Tasks", "Team Tasks", "Standards Library", "Clients", "Messages", "Activity Log"];
const CLIENT_TABS = ["Dashboard", "Tasks", "Standards Library", "Messages", "Activity Log"];

const CASES: Record<string, Case> = {
  "CGM admin": {
    email: "admin@cgm.example", nav: ["Admin", "Account"], apps: ALL, plan: "CGM staff · every application", sections: STAFF_TABS,
    allowed: ["/workspace", "/watch", "/tracker", "/tracker/standards", "/tracker/clients", "/tracker/team", "/tracker/messages", "/tracker/activity", "/tracker/client-tasks", "/admin", "/watch/review", "/watch/digest", "/account", "/powerworks"],
    denied: [],
  },
  "CGM project manager": {
    email: "pm@cgm.example", nav: ["Account"], apps: ALL, plan: "CGM staff · every application", sections: STAFF_TABS,
    allowed: ["/workspace", "/watch", "/tracker", "/tracker/clients", "/account"],
    denied: [["/admin", "/workspace"], ["/watch/review", "/workspace"], ["/watch/digest", "/workspace"]],
  },
  "CGM staff": {
    email: "staff@cgm.example", nav: ["Account"], apps: ALL, plan: "CGM staff · every application", sections: STAFF_TABS,
    allowed: ["/workspace", "/watch", "/tracker", "/tracker/clients", "/account"],
    denied: [["/admin", "/workspace"], ["/watch/review", "/workspace"]],
  },
  "Standards Watch only (client admin)": {
    email: "admin@watch.example", nav: ["Account"], apps: ["CGM Standards Watch"], plan: "Essentials access", sections: [],
    allowed: ["/workspace", "/watch", "/account"],
    denied: [["/tracker", "/workspace"], ["/tracker/standards", "/workspace"], ["/admin", "/workspace"], ["/watch/review", "/workspace"]],
  },
  "All three apps (client admin)": {
    email: "admin@peaker.example", nav: ["Account"], apps: ALL, plan: "Enterprise access", sections: ["Dashboard", "Tasks", "Client Tasks", "Standards Library", "Messages", "Activity Log"],
    allowed: ["/workspace", "/watch", "/tracker", "/tracker/standards", "/tracker/client-tasks", "/tracker/activity", "/account", "/powerworks"],
    denied: [["/admin", "/workspace"], ["/watch/digest", "/workspace"], ["/tracker/clients", "/tracker"], ["/tracker/team", "/tracker"]],
  },
  "All three apps (member)": {
    email: "member@peaker.example", nav: ["Account"], apps: ALL, plan: "Enterprise access", sections: ["Dashboard", "Tasks", "Client Tasks", "Standards Library", "Messages", "Activity Log"],
    allowed: ["/workspace", "/watch", "/tracker", "/account"],
    denied: [["/admin", "/workspace"]],
  },
  "Compliance Tracker only (member)": {
    email: "member@wind.example", nav: ["Account"], apps: ["CGM Compliance Tracker"], plan: "Essentials access", sections: CLIENT_TABS,
    allowed: ["/workspace", "/tracker", "/tracker/messages", "/account"],
    denied: [["/watch", "/workspace"], ["/admin", "/workspace"], ["/tracker/team", "/tracker"], ["/tracker/client-tasks", "/tracker"]],
  },
  "Signed in, no plan": {
    email: "noplan@nowhere.example", nav: ["Account"], apps: [], plan: "No applications yet", sections: [],
    allowed: ["/workspace", "/account"],
    denied: [["/watch", "/workspace"], ["/tracker", "/workspace"], ["/admin", "/workspace"], ["/watch/review", "/workspace"]],
  },
};

test("signed out: the sign-in screen is the front door; protected addresses go to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Sign In" })).toBeVisible();
  await expect(page.getByText("Access your CGM Workspace account")).toBeVisible();
  await expect(page.locator("header.mast")).toHaveCount(0);
  // The public CGM Standards Watch offer, in Standards Watch's own header.
  await page.goto("/standards-watch");
  await expect(page.locator(".mast .bname")).toContainText("CGM Standards Watch");
  expect(await navLinks(page)).toEqual(["Sign in", "Plans"]);
  for (const path of ["/workspace", "/watch", "/tracker", "/admin", "/account"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login\?next=/);
  }
});

for (const [role, c] of Object.entries(CASES)) {
  test(`${role}: launcher, app headers and addresses`, async ({ page }) => {
    await signIn(page, c.email, "/workspace");
    await expect(page.locator(".mast .bname")).toContainText("CGM Workspace");
    expect(await navLinks(page)).toEqual(c.nav);
    expect(await page.locator(".ws-card:not(.locked) h3").allInnerTexts()).toEqual(c.apps);
    await expect(page.locator(".ws-plan")).toHaveText(c.plan);

    if (c.sections.length) {
      await page.goto("/tracker");
      await expect(page.locator(".mast .bname")).toContainText("CGM Compliance Tracker");
      await expect(page.locator(".backlink")).toHaveAttribute("href", "/workspace");
      expect(await sectionLinks(page)).toEqual(c.sections);
      await expect(page.locator('header a[href="/watch"]')).toHaveCount(0); // no buttons between apps
    }

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

test("each app has its own name and header; CGM Powerworks is a placeholder until it's connected", async ({ page }) => {
  await signIn(page, "member@peaker.example", "/workspace");
  await page.locator(".ws-card", { hasText: "CGM Standards Watch" }).getByRole("link", { name: /Open application/ }).click();
  await expect(page).toHaveURL(/\/watch$/);
  await expect(page).toHaveTitle("CGM Standards Watch");
  await expect(page.locator(".mast .bname")).toContainText("CGM Standards Watch");
  await expect(page.locator(".watchname")).toHaveText("CGM Standards Watch");
  await expect(page.locator('header a[href="/tracker"]')).toHaveCount(0);
  await page.locator(".backlink").click();
  await expect(page).toHaveURL(/\/workspace$/);
  await page.goto("/tracker/standards");
  await expect(page).toHaveTitle("Standards library | CGM Compliance Tracker");
  await page.goto("/workspace");
  await page.locator(".ws-card", { hasText: "CGM Powerworks" }).getByRole("link", { name: /Open application/ }).click();
  await expect(page.getByRole("heading", { name: "CGM Powerworks is on its way" })).toBeVisible();
  await expect(page.getByText("It's included in your plan.")).toBeVisible();
  await page.goto("/");
  await expect(page).toHaveURL(/\/workspace$/);
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
