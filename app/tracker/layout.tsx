import "../tracker.css";
import { requireTracker } from "@/lib/guards";

/** The Tracker's sections need the Compliance Tracker product (CGM staff always have it).
    The menu itself is the app header (app/layout.tsx, lib/nav.ts). */
export default async function TrackerLayout({ children }: { children: React.ReactNode }) {
  await requireTracker();
  return <div className="trk">{children}</div>;
}
