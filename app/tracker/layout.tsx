import "../tracker.css";
import { requireTracker } from "@/lib/guards";

/** Everything under /tracker needs the Compliance Tracker product (CGM staff always have it).
    The sections still to be built are shown greyed out so the shape of the console is visible. */
export default async function TrackerLayout({ children }: { children: React.ReactNode }) {
  const v = await requireTracker();
  const sections: { label: string; href?: string; show: boolean }[] = [
    { label: "Dashboard", href: "/tracker", show: true },
    { label: "Tasks", show: true },
    { label: "Client Tasks", show: !v.isStaff && v.products.client_tasks },
    { label: "Team Tasks", show: v.isStaff },
    { label: "Standards Library", show: true },
    { label: "Clients", show: v.isStaff },
    { label: "Messages", show: true },
    { label: "Activity Log", show: true },
  ];
  return (
    <div className="trk">
      <div className="trk-bar">
        <div className="wrap trk-barin">
          <div className="trk-who">
            <b>Compliance Tracker</b>
            <span>{v.isStaff ? `CGM ${v.staffRole === "pm" ? "project manager" : v.staffRole}` : v.company?.name}</span>
          </div>
          <nav className="trk-tabs" aria-label="Tracker">
            {sections.filter((s) => s.show).map((s) =>
              s.href ? (
                <a key={s.label} href={s.href}>{s.label}</a>
              ) : (
                <span key={s.label} className="soon" title="Coming in a later milestone">{s.label}</span>
              ),
            )}
          </nav>
        </div>
      </div>
      {children}
    </div>
  );
}
