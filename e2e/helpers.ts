import { expect, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

/** Signs in through the real email-link flow, reading the link from the local mail catcher (Mailpit). */
export async function signIn(page: Page, email: string, next = "/account") {
  await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`, { method: "DELETE" });
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Work email").fill(email);
  await page.getByRole("button", { name: /sign-in link/i }).click();
  await expect(page.getByText(/Check .* for your sign-in link/)).toBeVisible();

  let link = "";
  for (let i = 0; i < 40 && !link; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { HTML: string };
      link = (msg.HTML.match(/href="([^"]+verify[^"]+)"/)?.[1] || "").replace(/&amp;/g, "&");
    } else await new Promise((r) => setTimeout(r, 250));
  }
  if (!link) throw new Error(`No sign-in email arrived for ${email}`);
  await page.goto(link);
  await page.waitForURL((u) => u.pathname === next || u.pathname.startsWith(next));
}

/** The top-right links in the header (account and editor tools). */
export async function navLinks(page: Page): Promise<string[]> {
  // The Account link starts with the initials avatar; keep the label (last line) only.
  return (await page.locator("nav.sitenav a").allInnerTexts()).map((t) => t.replace("🔒", "").trim().split(/\s*\n\s*/).pop()!.trim());
}

/** The section menu under the CGM Compliance Tracker header, including greyed-out sections. */
export async function sectionLinks(page: Page): Promise<string[]> {
  return (await page.locator("nav.appnav > a, nav.appnav > span").allInnerTexts()).map((t) => t.replace("🔒", "").replace(/\s*\d+$/, "").trim());
}
