import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { needsWelcome } from "@/lib/guards";
import { APPS, planName } from "@/lib/nav";

export const dynamic = "force-dynamic";
export const metadata = { title: { absolute: "CGM Workspace" } };

const ICONS: Record<string, JSX.Element> = {
  watch: <><rect x="7" y="5" width="37" height="43" rx="3" /><path d="M15 15h21M15 21h21M15 29h8v10h-8zM28 29h8M28 35h8M15 43h21" /></>,
  tracker: <><rect x="9" y="8" width="34" height="40" rx="4" /><rect x="18" y="4" width="16" height="8" rx="2" /><path d="m15 23 3 3 5-6M28 23h8m-21 13 3 3 5-6M28 36h8" /></>,
  powerworks: <path d="M5 46h44M9 46V22l12 7V17l13 7V7h9v39M15 34h3m7 0h3m8 0h3M15 40h3m7 0h3m8 0h3" />,
};
const COPY: Record<string, { desc: string; features: string[] }> = {
  watch: {
    desc: "Reviewed weekly NERC and FERC changes for your registered functions: what was approved, what takes effect next, and what to do.",
    features: ["Weekly digest and calendar feed", "Filtered to your registered functions"],
  },
  tracker: {
    desc: "Your NERC compliance program with CGM: recurring tasks from the standards library, reminders, approvals and evidence.",
    features: ["Recurring tasks, reminders and approvals", "Evidence and a full audit trail"],
  },
  powerworks: {
    desc: "Connect plant operations, maintenance and compliance in one platform.",
    features: ["Assets, work orders and operator rounds", "Inventory and purchasing"],
  },
};
const LOCKED_NOTE: Record<string, string> = {
  watch: "CGM Standards Watch isn't in your plan yet.",
  tracker: "CGM Compliance Tracker isn't in your plan yet.",
};

/** CGM Workspace: the launcher everyone lands on after signing in (Dan's demo). Shows the apps the person's
 *  company has; the others show as available with an upgrade. CGM Powerworks opens as its own site
 *  (POWERWORKS_URL), never inside this one. */
export default async function Workspace({ searchParams }: { searchParams: { locked?: string } }) {
  const v = await getViewer();
  if (!v) redirect("/login?next=/workspace");
  if (needsWelcome(v)) redirect("/welcome?next=/workspace");
  const first = (v.fullName || "").split(" ")[0];
  const has = (k: string) => v.products[k as keyof typeof v.products];
  const count = APPS.filter((a) => has(a.key)).length;
  const href = (k: string) => (k === "watch" ? "/watch" : k === "tracker" ? "/tracker" : process.env.POWERWORKS_URL || "/powerworks");
  const explore = (k: string) =>
    k === "watch" ? "/standards-watch" : `mailto:dan@cgmconsultinggroup.com?subject=${encodeURIComponent(`Add ${APPS.find((a) => a.key === k)?.name} to our CGM Workspace`)}`;

  return (
    <main className="ws">
      <section className="ws-hero">
        <div className="wrap">
          <div className="eyebrow">Your connected generation workspace</div>
          <h1>One workspace. Every operation.</h1>
          <p>
            Welcome back{first ? `, ${first}` : ""}. Choose an application to get started.
          </p>
          <div className="ws-org">
            <b>◈ {v.isStaff ? "CGM Consulting Group" : v.company?.name || "Your organization"}</b>
            {v.isStaff ? "CGM staff workspace" : "Client workspace"}
          </div>
        </div>
      </section>

      <div className="wrap ws-main">
        {searchParams.locked && LOCKED_NOTE[searchParams.locked] && (
          <p className="notice" role="status">{LOCKED_NOTE[searchParams.locked]} Explore access below, or ask CGM.</p>
        )}
        <div className="ws-head">
          <div>
            <h2>Your applications</h2>
            <div className="muted small">
              {v.isStaff ? "Every application, as CGM staff" : `${count} application${count === 1 ? "" : "s"} available in your workspace`}
            </div>
          </div>
          <span className="ws-plan">{planName(v)}</span>
        </div>

        <div className="ws-grid">
          {APPS.map((a) => {
            const on = has(a.key);
            const external = a.key === "powerworks" && !!process.env.POWERWORKS_URL;
            return (
              <article key={a.key} className={`ws-card ws-${a.key}${on ? "" : " locked"}`} aria-label={a.name}>
                <div className="ws-art">
                  <svg viewBox="0 0 54 54" aria-hidden="true">{ICONS[a.key]}</svg>
                  <span className="ws-tag">{a.category}</span>
                </div>
                <div className="ws-body">
                  <div className="ws-status">{on ? "Included in your plan" : "Available with an upgrade"}</div>
                  <h3>{a.name}</h3>
                  <p className="ws-desc">{COPY[a.key].desc}</p>
                  <div className="ws-features">{COPY[a.key].features.map((f) => <div key={f}>{f}</div>)}</div>
                  <a
                    className="ws-launch"
                    href={on ? href(a.key) : explore(a.key)}
                    {...(external && on ? { rel: "noopener" } : {})}
                  >
                    <span>{on ? "Open application" : "Explore access"}</span>
                    <span aria-hidden="true">{on ? "↗" : "+"}</span>
                  </a>
                </div>
              </article>
            );
          })}
        </div>

        <div className="ws-footrow">
          <span>One account. A connected suite built for generation.</span>
          <a href="mailto:dan@cgmconsultinggroup.com?subject=CGM%20Workspace%20help">Need help? ↗</a>
        </div>
      </div>
    </main>
  );
}
