import "../tracker.css";
import AppHeader, { AppFooter } from "@/components/AppHeader";
import { reminderTasks } from "@/lib/dashboard";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import type { Task } from "@/lib/tasks";

export const metadata = { title: { default: "CGM Compliance Tracker", template: "%s | CGM Compliance Tracker" } };

/** CGM Compliance Tracker: its own app (needs the Tracker product; CGM staff always have it), with its own header,
 *  section tabs, the Reminders button and a way back to CGM Workspace. */
export default async function TrackerLayout({ children }: { children: React.ReactNode }) {
  const v = await requireTracker();
  // The Reminders count: overdue tasks plus tasks inside their reminder window (read with the person's own access).
  const { data } = await createClient().from("tasks").select("status, due_date, remind_days").neq("status", "done").not("due_date", "is", null);
  return (
    <>
      <AppHeader app="tracker" viewer={v} reminders={reminderTasks((data || []) as Task[]).length} />
      <div className="trk">{children}</div>
      <AppFooter app="tracker" />
    </>
  );
}
