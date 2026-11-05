import { test } from "@playwright/test";
import { signIn } from "./helpers";

// Review screenshots, not assertions. Run: SCREENSHOTS=1 npx playwright test screens
// Writes JPEGs to screenshots/ (git-ignored). Uses fake accounts and the public pilot content only.
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to take review screenshots");

const WIDTHS = [1280, 900, 390];
const PAGES: [string, string, string | null][] = [
  ["watch", "/watch", "admin@watch.example"],
  ["landing", "/", null],
  ["login", "/login", null],
];

for (const scheme of ["light", "dark"] as const) {
  for (const [name, path, who] of PAGES) {
    test(`${name} ${scheme}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      if (who) await signIn(page, who, path);
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        await page.screenshot({ path: `screenshots/${name}-${w}-${scheme}.jpg`, type: "jpeg", quality: 70, fullPage: name !== "login" });
        if (name === "watch") await page.screenshot({ path: `screenshots/${name}-${w}-${scheme}-top.jpg`, type: "jpeg", quality: 80 });
      }
    });
  }
}
