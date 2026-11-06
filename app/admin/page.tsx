import { requireAdmin } from "@/lib/guards";
import { isLive } from "@/lib/entitlements";
import { emailsEnabled, emailsKilledByEnv } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { runTrackerEmails } from "@/lib/tracker-job";
import { addCompany, setEmails, setPerson, setProducts } from "./actions";

export const dynamic = "force-dynamic";

const PRODUCT_LABEL = { watch: "CGM Standards Watch", tracker: "CGM Compliance Tracker", client_tasks: "Client Tasks add-on", powerworks: "CGM Powerworks" } as const;
const OK: Record<string, string> = {
  products: "Products updated.",
  company: "Company added.",
  person: "Person updated.",
  "emails-on": "Automated emails are on.",
  "emails-off": "Automated emails are off.",
};

type Company = { id: string; name: string; sample: boolean; seats: number };
type Ent = { company_id: string; product: string; status: string; source: string };
type Person = { id: string; email: string | null; full_name: string | null; staff_role: string | null; company_id: string | null; company_role: string };

/** CGM admin only: which products each company holds, who is CGM staff, who belongs to which company, and app switches. */
export default async function AdminPage({ searchParams }: { searchParams: { ok?: string; error?: string; preview?: string } }) {
  await requireAdmin();
  // Checked as a CGM admin above; the dry run reads with the service role and sends nothing.
  const preview = searchParams.preview ? await runTrackerEmails(createAdminClient(), { dryRun: true }) : null;
  const db = createClient();
  const [{ data: companies }, { data: ents }, { data: people }, emailsOn] = await Promise.all([
    db.from("companies").select("id, name, sample, seats").order("name"),
    db.from("entitlements").select("company_id, product, status, source"),
    db.from("profiles").select("id, email, full_name, staff_role, company_id, company_role").order("email"),
    emailsEnabled(db),
  ]);
  const killed = emailsKilledByEnv();
  const entsFor = (id: string) => ((ents || []) as Ent[]).filter((e) => e.company_id === id);

  return (
    <main className="wrap page" style={{ display: "grid", gap: 22 }}>
      <div>
        <h1>Admin</h1>
        <p className="lede">Products, people and app switches. Only CGM admins see this page, and the database checks every change again.</p>
      </div>
      {searchParams.ok && <p className="notice ok">{OK[searchParams.ok] || "Saved."}</p>}
      {searchParams.error && <p className="notice">Couldn&apos;t save: {searchParams.error}</p>}

      <section className="cardbox wide">
        <h2>Automated emails</h2>
        <p style={{ margin: 0 }}>
          Tracker reminders, unread-message notices and scheduled digests are{" "}
          <b>{emailsOn ? "on" : "off"}</b>.
          {killed && <> The server&apos;s <code>EMAILS_DISABLED</code> setting is forcing them off, whatever this switch says.</>}
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Leave this off until the app is live and the old tracker&apos;s email sender is switched off, so nobody gets emails twice.
          Sending the weekly Watch digest by hand from the Digest page isn&apos;t affected.
        </p>
        <form action={setEmails}>
          <input type="hidden" name="on" value={emailsOn ? "false" : "true"} />
          <button className={emailsOn ? "btn-line" : "btn-main"} type="submit">{emailsOn ? "Turn emails off" : "Turn emails on"}</button>
        </form>
      </section>

      <section className="cardbox wide" id="tracker-emails">
        <h2>CGM Compliance Tracker emails</h2>
        <p style={{ margin: 0 }}>
          Weekdays at 14:00 UTC (7 a.m. Mountain, 8 a.m. in summer): client digests to each client&apos;s contacts, one digest per
          project manager across their clients, task reminders to assignees and team-task owners, and a daily unread-messages
          notice. Each email has an unsubscribe link; nothing goes out twice in a day.
        </p>
        {preview ? (
          preview.skipped ? <p className="muted" style={{ margin: 0 }}>{preview.skipped}</p> : (
            <div className="tablewrap">
              <table className="grid">
                <caption className="muted" style={{ textAlign: "left" }}>What would go out today ({preview.today}), whether or not emails are on: {preview.planned.length} email{preview.planned.length === 1 ? "" : "s"}.</caption>
                <thead><tr><th>Kind</th><th>To</th><th className="num">Items</th><th>Subject</th></tr></thead>
                <tbody>
                  {preview.planned.map((p, i) => (
                    <tr key={i}><td>{({ client_digest: "Client digest", pm_digest: "PM digest", reminders: "Reminders", messages: "Unread messages" } as Record<string, string>)[p.kind]}</td><td>{p.to}</td><td className="num">{p.items}</td><td>{p.subject}</td></tr>
                  ))}
                  {!preview.planned.length && <tr><td colSpan={4} className="muted">Nothing to send today.</td></tr>}
                </tbody>
              </table>
            </div>
          )
        ) : <p style={{ margin: 0 }}><a className="btn-line" href="/admin?preview=1#tracker-emails">Preview today&apos;s Tracker emails</a></p>}
      </section>

      <section className="cardbox wide">
        <h2>Companies and products</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          Each application is separate (CGM Workspace). Client Tasks is an add-on that only works while the Compliance Tracker is on. Stripe subscriptions are changed in Stripe.
        </p>
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Company</th><th>Products</th><th>Seats</th><th /></tr></thead>
            <tbody>
              {((companies || []) as Company[]).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}{c.sample && <span className="muted"> · sample</span>}</td>
                  <td>
                    <form id={`p-${c.id}`} action={setProducts} className="checks">
                      <input type="hidden" name="company_id" value={c.id} />
                      {(Object.keys(PRODUCT_LABEL) as (keyof typeof PRODUCT_LABEL)[]).map((p) => {
                        const e = entsFor(c.id).find((x) => x.product === p);
                        return (
                          <label key={p}>
                            <input type="checkbox" name="products" value={p} defaultChecked={!!e && isLive(e.status)} /> {PRODUCT_LABEL[p]}
                            {e?.source === "stripe" && <span className="muted"> (Stripe)</span>}
                          </label>
                        );
                      })}
                    </form>
                  </td>
                  <td>
                    <input form={`p-${c.id}`} type="number" name="seats" min={1} max={500} defaultValue={c.seats} aria-label={`Seats for ${c.name}`} className="seats" />
                  </td>
                  <td><button className="btn-line sm" form={`p-${c.id}`} type="submit">Save</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form action={addCompany} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div className="field" style={{ flex: "1 1 240px" }}>
            <label htmlFor="newco">New company</label>
            <input id="newco" name="name" type="text" placeholder="Company name" />
          </div>
          <button className="btn-line" type="submit" style={{ alignSelf: "end" }}>Add company</button>
        </form>
      </section>

      <section className="cardbox wide">
        <h2>People</h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          People appear here after they sign in once. CGM staff see every client. A PM also approves tasks and edits clients and the library. An admin can do everything here.
        </p>
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Person</th><th>CGM role</th><th>Client company</th><th>Company role</th><th /></tr></thead>
            <tbody>
              {((people || []) as Person[]).map((p) => (
                <tr key={p.id}>
                  <td>{p.full_name || "—"}<div className="muted" style={{ fontSize: 12.5 }}>{p.email}</div></td>
                  <td>
                    <select name="staff_role" form={`u-${p.id}`} defaultValue={p.staff_role || ""}>
                      <option value="">Not CGM staff</option>
                      <option value="staff">Staff</option>
                      <option value="pm">Project manager</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    <select name="company_id" form={`u-${p.id}`} defaultValue={p.company_id || ""}>
                      <option value="">None</option>
                      {((companies || []) as Company[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select name="company_role" form={`u-${p.id}`} defaultValue={p.company_role}>
                      <option value="member">Member</option>
                      <option value="admin">Company admin</option>
                    </select>
                  </td>
                  <td>
                    <form id={`u-${p.id}`} action={setPerson}>
                      <input type="hidden" name="id" value={p.id} />
                      <button className="btn-line sm" type="submit">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
