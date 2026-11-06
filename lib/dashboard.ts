import { hasReport, taskState, todayIso, type Task } from "./tasks";
import { daysUntil, parseDate, startOfToday } from "./watch";

/* The pilot's Dashboard numbers (TRACKER-SPEC §3.2), as one pure function so the date rules are unit-tested. */

export type DashClient = { id: string; name: string };

/** First day of the current calendar quarter, YYYY-MM-DD. */
export function quarterStart(today = startOfToday()) {
  return todayIso(new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1));
}

/** Tasks that need attention now: overdue, or inside their reminder window. Sorted by due date. */
export function reminderTasks(tasks: Task[], today = startOfToday()) {
  return tasks
    .filter((t) => t.status !== "done")
    .filter((t) => { const s = taskState(t, today); return s === "overdue" || s === "window"; })
    .sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
}

export function dashboard(tasks: Task[], clients: DashClient[], today = startOfToday()) {
  const active = tasks.filter((t) => t.status !== "done");
  const overdue = active.filter((t) => taskState(t, today) === "overdue");
  const due30 = active.filter((t) => {
    if (t.status === "review" || !t.due_date) return false;
    const n = daysUntil(t.due_date, today);
    return n >= 0 && n <= 30;
  });
  const review = active.filter((t) => t.status === "review").sort((a, b) => (a.completed_at || "").localeCompare(b.completed_at || ""));
  const awaitingReport = review.filter((t) => !hasReport(t)).length;
  const qStart = quarterStart(today);
  const closedThisQuarter = tasks.filter((t) => t.status === "done" && (t.completed_at || "") >= qStart).length;
  const noDueDate = active.filter((t) => !t.due_date).length;
  const reminders = reminderTasks(tasks, today);

  const byClient = clients
    .map((c) => {
      const ts = active.filter((t) => t.company_id === c.id);
      return {
        client: c,
        open: ts.length,
        reminders: ts.filter((t) => taskState(t, today) === "window").length,
        overdue: ts.filter((t) => taskState(t, today) === "overdue").length,
      };
    })
    .sort((a, b) => b.overdue - a.overdue || b.reminders - a.reminders || a.client.name.localeCompare(b.client.name));

  // The next 40 open tasks outside their reminder windows, grouped by month.
  const upcoming = active
    .filter((t) => t.due_date && !["overdue", "window", "review"].includes(taskState(t, today)))
    .sort((a, b) => (a.due_date as string).localeCompare(b.due_date as string))
    .slice(0, 40);
  const months: { label: string; tasks: Task[] }[] = [];
  for (const t of upcoming) {
    const label = parseDate(t.due_date as string).toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!months.length || months[months.length - 1].label !== label) months.push({ label, tasks: [] });
    months[months.length - 1].tasks.push(t);
  }

  return {
    overdue: overdue.length,
    due30: due30.length,
    review,
    awaitingReport,
    open: active.length,
    clients: clients.length,
    closedThisQuarter,
    qStart,
    noDueDate,
    reminders,
    byClient,
    upcoming: months,
  };
}
