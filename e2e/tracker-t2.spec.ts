import { expect, test, type Page } from "@playwright/test";
import { signIn } from "./helpers";

// T2 acceptance: create → mark performed → next occurrence with the right date → staff approve refused with the
// database's message → PM approves. Fake client and task only; both tasks are deleted at the end.
const run = Date.now().toString(36);
const TITLE = `Fake monthly check ${run}`;

async function openTask(page: Page, status: string, nth: "first" | "last" = "first") {
  await page.goto(`/tracker/tasks?status=${status}&q=${encodeURIComponent(TITLE)}`);
  const links = page.locator(".tasktable .rowlink", { hasText: TITLE });
  await (nth === "first" ? links.first() : links.last()).click();
  await expect(page.getByRole("region", { name: TITLE })).toBeVisible();
  return page.getByRole("region", { name: TITLE });
}

test("tasks: create, mark performed, next occurrence, staff can't approve, PM approves", async ({ page, request }) => {
  await signIn(page, "staff@cgm.example", "/tracker/tasks");
  await page.getByRole("link", { name: "New task" }).click();
  const form = page.getByRole("region", { name: "New task" });
  await form.getByLabel("Task", { exact: true }).fill(TITLE);
  await form.getByLabel("Client").selectOption({ label: "Demo Wind Farm LLC (fake)" });
  await form.getByLabel("Due date").fill("2027-01-31");
  await form.getByLabel("Repeats every").fill("1");
  await form.getByLabel("Repeat unit").selectOption("m");
  await form.getByLabel("Repeat from").selectOption("due");
  await form.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Task added.")).toBeVisible();

  // Mark performed (two steps); a monthly task due Jan 31 repeats on Feb 28 (month end clamps).
  let drawer = page.getByRole("region", { name: TITLE });
  await drawer.getByText("Mark performed").click();
  await expect(drawer.getByText("The next occurrence is created right away, due Feb 28, 2027.")).toBeVisible();
  await drawer.getByRole("button", { name: "Confirm performed" }).click();
  await expect(page.getByText("Marked performed. The next occurrence is scheduled.")).toBeVisible();
  drawer = page.getByRole("region", { name: TITLE });
  await expect(drawer.locator(".pill")).toHaveText("Pending review");
  await expect(drawer.getByRole("link", { name: "Next occurrence, due Feb 28, 2027 →" })).toBeVisible();

  // Staff can't approve: the database refuses and its message is shown.
  await drawer.getByLabel("Approve without a report link").check();
  await drawer.getByRole("button", { name: "Approve & close" }).click();
  await expect(page.getByRole("region", { name: TITLE }).getByRole("alert")).toHaveText("Only a CGM project manager or admin can approve and close a task");

  // CSV export follows the filters.
  const csv = await (await request.get(`/tracker/tasks/export?status=all&q=${encodeURIComponent(TITLE)}`, { headers: { cookie: (await page.context().cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })).text();
  expect(csv).toContain(`"${TITLE}"`);
  expect(csv.split("\r\n")).toHaveLength(3); // header, the performed task, its next occurrence

  // A client user sees the task but can only post evidence and notes.
  await page.context().clearCookies();
  await signIn(page, "member@wind.example", "/tracker/tasks");
  drawer = await openTask(page, "all");
  await expect(drawer.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Save evidence and notes" })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Approve & close" })).toHaveCount(0);

  // A PM approves (without a report link, after confirming).
  await page.context().clearCookies();
  await signIn(page, "pm@cgm.example", "/tracker/tasks");
  drawer = await openTask(page, "review");
  await drawer.getByRole("button", { name: "Approve & close" }).click();
  await expect(page.getByRole("region", { name: TITLE }).getByRole("alert")).toContainText("No report link is posted.");
  drawer = page.getByRole("region", { name: TITLE });
  await drawer.getByLabel("Approve without a report link").check();
  await drawer.getByRole("button", { name: "Approve & close" }).click();
  await expect(page.getByText("Approved and closed.")).toBeVisible();
  await expect(page.getByRole("region", { name: TITLE }).locator(".pill")).toHaveText("Complete");

  // The next occurrence is open and due Feb 28, 2027. Clean up both.
  await page.goto(`/tracker/tasks?status=all&q=${encodeURIComponent(TITLE)}`);
  await expect(page.locator(".tasktable tbody tr", { hasText: "Feb 28, 2027" })).toHaveCount(1);
  for (let i = 0; i < 2; i++) {
    drawer = await openTask(page, "all");
    await drawer.getByLabel("Delete this task").check();
    await drawer.getByRole("button", { name: "Delete task" }).click();
    await expect(page.getByText("Task deleted.")).toBeVisible();
  }
  await page.goto(`/tracker/tasks?status=all&q=${encodeURIComponent(TITLE)}`);
  await expect(page.locator(".tasktable .rowlink", { hasText: TITLE })).toHaveCount(0);
});

test("tasks: Create task from a library obligation prefills it", async ({ page }) => {
  await signIn(page, "staff@cgm.example", "/tracker/standards");
  await page.goto("/tracker/standards?open=PRC-005");
  await page.locator(".stdgroup", { has: page.getByText("PRC-005-", { exact: false }).first() }).getByRole("link", { name: "Create task" }).first().click();
  const form = page.getByRole("region", { name: "New task" });
  await expect(form.getByLabel("Task", { exact: true })).not.toHaveValue("");
  await expect(form.getByLabel("Standard")).toHaveValue("PRC-005");
  await expect(form.getByLabel("Due date")).not.toHaveValue("");
});
