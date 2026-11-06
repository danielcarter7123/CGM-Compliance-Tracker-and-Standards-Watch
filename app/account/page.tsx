import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { siteUrl } from "@/lib/stripe";
import TeamCard from "@/components/TeamCard";
import { ALL_FUNCTIONS, REGIONS } from "@/lib/types";
import { fmt } from "@/lib/watch";
import { savePreferences, signOut } from "./actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { active: "Active", trialing: "Trial", past_due: "Payment past due", canceled: "Cancelled" };
const PRODUCT: Record<string, string> = { watch: "Standards Watch", tracker: "Compliance Tracker (includes Standards Watch)", client_tasks: "Client Tasks add-on" };

export default async function AccountPage({ searchParams }: { searchParams: { saved?: string; error?: string; need?: string; checkout?: string; team?: string; who?: string } }) {
  const v = await getViewer();
  if (!v) redirect("/login?next=/account");
  const stripeWatch = v.entitlements.find((e) => e.product === "watch" && e.source === "stripe");
  const calUrl = `${siteUrl()}/api/calendar/${v.calendarToken}`;

  return (
    <main className="wrap page" style={{ display: "grid", gap: 18 }}>
      <div>
        <h1>Your account</h1>
        <p className="lede">{v.email}</p>
      </div>
      {searchParams.saved && <p className="notice ok">Preferences saved.</p>}
      {searchParams.checkout === "success" && <p className="notice ok">Thanks for subscribing. Your access turns on as soon as Stripe confirms the payment, usually within a minute.</p>}
      {searchParams.need === "subscription" && !v.hasAccess && <p className="notice">Standards Watch needs an active subscription. Choose a plan below.</p>}
      {searchParams.need === "tracker" && !v.products.tracker && (
        <p className="notice">
          The Compliance Tracker is available by agreement with CGM Consulting Group. It includes Standards Watch, plus your NERC tasks, reminders and evidence in one place.{" "}
          <a href="mailto:dan@cgmconsultinggroup.com?subject=Compliance%20Tracker">Ask CGM about access</a>.
        </p>
      )}
      {searchParams.error && <p className="notice">Couldn&apos;t save: {searchParams.error}</p>}

      <section className="cardbox">
        <h2>Subscription</h2>
        {v.isStaff ? (
          <p style={{ margin: 0 }}><b>CGM staff</b> ({v.staffRole}) · full access</p>
        ) : v.entitlements.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {v.entitlements.map((e) => (
              <li key={e.product}>
                <b>{PRODUCT[e.product] || e.product}</b>: {STATUS[e.status] || e.status}
                {e.current_period_end && <> · renews {fmt(e.current_period_end.slice(0, 10))}</>}
                {e.source === "contract" && <> · by agreement with CGM</>}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0 }}><b>No subscription</b>{v.company && <> · {v.company.name}</>}</p>
        )}
        {stripeWatch && v.companyRole === "admin" ? (
          <form action="/api/stripe/portal" method="post"><button className="btn-line" type="submit">Manage billing</button></form>
        ) : !v.isStaff && !v.products.watch ? (
          <a className="btn-main" href="/#plans">Choose a plan</a>
        ) : null}
      </section>

      <form className="cardbox" action={savePreferences}>
        <h2>What you see</h2>
        <div className="field">
          <span className="lbl">Your registered functions</span>
          <div className="checks">
            {ALL_FUNCTIONS.map((f) => (
              <label key={f}><input type="checkbox" name="functions" value={f} defaultChecked={v.functions.includes(f)} /> {f}</label>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 13 }}>Your Watch page and weekly email are filtered to these. Leave all unchecked to see everything.</span>
        </div>
        <div className="field">
          <label htmlFor="region">Regional Entity</label>
          <select id="region" name="region" defaultValue={v.region || ""}>
            <option value="">Not sure</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="digest" defaultChecked={v.digestOptIn} /> Email me the weekly digest
        </label>
        <div className="field">
          <label style={{ display: "flex", gap: 8, alignItems: "center", textTransform: "none", letterSpacing: 0, fontSize: 15, fontWeight: 400, color: "var(--ink)" }}>
            <input type="checkbox" name="alerts" defaultChecked={v.alertsOptIn} /> Also email me alerts between digests (optional)
          </label>
          <span className="muted" style={{ fontSize: 13 }}>
            Off by default. The weekly digest already covers everything. Turn this on only if you want a separate email whenever FERC approves a standard, an effective date is set or moves, or a comment period or event is within 14 days.
          </span>
        </div>
        <div className="field">
          <label htmlFor="full_name">Your name</label>
          <input id="full_name" name="full_name" type="text" defaultValue={v.fullName} />
        </div>
        <div><button className="btn-main" type="submit">Save preferences</button></div>
      </form>

      {!v.isStaff && v.company && v.companyRole === "admin" && <TeamCard v={v} team={searchParams.team} who={searchParams.who} />}

      {v.hasAccess && (
        <section className="cardbox">
          <h2>Calendar feed</h2>
          <p style={{ margin: 0 }}>Add this address as a subscribed calendar in Outlook or Google Calendar. Effective dates, phased compliance dates and comment deadlines for your functions appear automatically.</p>
          <code style={{ font: "13px var(--mono)", overflowWrap: "anywhere", background: "var(--sunk)", padding: "8px 10px", borderRadius: 4 }}>{calUrl}</code>
          <span className="muted" style={{ fontSize: 13 }}>Treat this address like a password: anyone with it can see your feed.</span>
        </section>
      )}

      <form action={signOut}><button className="btn-line" type="submit">Sign out</button></form>
    </main>
  );
}
