import ClientFunctionsField from "@/components/ClientFunctionsField";
import { isLive } from "@/lib/entitlements";
import { REGIONS } from "@/lib/functions";
import { requireStaff } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/watch";
import { addMissingTasks } from "../tasks/actions";
import { taskKey } from "@/lib/tasks";
import { deleteClient, inviteToClient, removeClientMember, removeSamples, revokeClientInvite, saveClient, setClientProducts } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clients" };

type Company = {
  id: string; name: string; ncr_id: string | null; region: string | null; reg_date: string | null; functions: string[];
  entities: Record<string, string>; facilities: string | null; sharepoint_url: string | null; notes: string | null; sample: boolean;
  pm_id: string | null;
};
type Contact = { id: string; company_id: string; kind: string; name: string; email: string | null; digest: boolean };
type Ent = { company_id: string; product: string; status: string };

const EMPTY: Company = { id: "", name: "", ncr_id: null, region: null, reg_date: null, functions: ["GO", "GOP"], entities: {}, facilities: null, sharepoint_url: null, notes: null, sample: false, pm_id: null };

/** CGM staff only: the Tracker's client directory and the client drawer. Watch-only subscribers aren't listed. */
export default async function Clients({ searchParams }: { searchParams: { c?: string; ok?: string; error?: string } }) {
  const v = await requireStaff("/tracker/clients");
  const canEdit = v.canApprove;
  const isAdmin = v.staffRole === "admin";
  const db = createClient();
  const [{ data: cos, error }, { data: contacts }, { data: ents }, { data: openTasks }, { data: staffPeople }] = await Promise.all([
    db.from("companies").select("id, name, ncr_id, region, reg_date, functions, entities, facilities, sharepoint_url, notes, sample, pm_id").order("name"),
    db.from("contacts").select("id, company_id, kind, name, email, digest"),
    db.from("entitlements").select("company_id, product, status"),
    db.from("tasks").select("company_id, title, standard_code, requirement, sample").neq("status", "done"),
    db.from("profiles").select("id, full_name, email, staff_role").not("staff_role", "is", null).order("full_name"),
  ]);
  const entsOf = (id: string) => ((ents || []) as Ent[]).filter((e) => e.company_id === id);
  const has = (id: string, p: string) => entsOf(id).some((e) => e.product === p && isLive(e.status));
  // Tracker clients: anyone who has (or had) the Tracker, plus new clients with no products yet. Not Watch-only subscribers.
  const clients = ((cos || []) as Company[]).filter((c) => {
    const e = entsOf(c.id);
    return e.some((x) => x.product === "tracker") || e.length === 0;
  });
  const contactOf = (id: string, kind: string) => ((contacts || []) as Contact[]).find((c) => c.company_id === id && c.kind === kind);
  const openCount = (id: string) => (openTasks || []).filter((t) => t.company_id === id).length;
  const samples = clients.filter((c) => c.sample).length;

  const sel = searchParams.c === "new" ? (canEdit ? EMPTY : null) : clients.find((c) => c.id === searchParams.c) || null;
  const isNew = searchParams.c === "new";
  // People at the selected client (logins) and open invites, read as CGM staff.
  type Person = { id: string; full_name: string | null; email: string | null; company_role: string; onboarded_at: string | null };
  type Inv = { id: string; email: string; company_role: string; expires_at: string };
  let people: Person[] = [], invites: Inv[] = [];
  if (sel && !isNew) {
    const [{ data: pp }, { data: ii }] = await Promise.all([
      db.from("profiles").select("id, full_name, email, company_role, onboarded_at").eq("company_id", sel.id).is("staff_role", null).order("email"),
      db.from("invites").select("id, email, company_role, expires_at").eq("company_id", sel.id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at"),
    ]);
    people = (pp || []) as Person[];
    invites = (ii || []) as Inv[];
  }
  const person = (kind: string, label: string, digestText: string, defaultDigest: boolean) => {
    const c = sel && !isNew ? contactOf(sel.id, kind) : undefined;
    return (
      <>
        <div className="row2">
          <div className="field">
            <label htmlFor={`${kind}_name`}>{label}</label>
            <input id={`${kind}_name`} name={`${kind}_name`} type="text" defaultValue={c?.name || ""} placeholder="Name" />
          </div>
          <div className="field">
            <label htmlFor={`${kind}_email`}>{label} email</label>
            <input id={`${kind}_email`} name={`${kind}_email`} type="email" defaultValue={c?.email || ""} placeholder="name@company.com" autoComplete="off" />
          </div>
        </div>
        <label className="checkline"><input type="checkbox" name={`${kind}_digest`} defaultChecked={c ? c.digest : defaultDigest} /> {digestText}</label>
      </>
    );
  };

  return (
    <main className="wrap trk-page">
      <div className="trk-head">
        <h1>Client directory</h1>
        <span className="muted mono">{clients.length} client{clients.length === 1 ? "" : "s"}</span>
        <span className="trk-actions">
          {isAdmin && samples > 0 && (
            <form action={removeSamples}><button className="btn-line sm" type="submit">Remove sample clients and their tasks</button></form>
          )}
          {canEdit && <a className="btn-main sm" href="/tracker/clients?c=new">Add client</a>}
        </span>
      </div>
      {searchParams.ok && !sel && <p className="notice ok" role="status">{searchParams.ok}</p>}
      {searchParams.error && !sel && <p className="notice" role="alert">{searchParams.error}</p>}
      {error && <p className="notice">Couldn&apos;t load clients: {error.message}</p>}

      {sel && (
        <section className="trk-panel" aria-label={isNew ? "Add client" : sel.name}>
          <div className="trk-panel-h">
            <h2>{isNew ? "Add client" : sel.name}</h2>
            {!isNew && sel.sample && <span className="chip">SAMPLE</span>}
            <a className="btn-line sm" href="/tracker/clients">Close</a>
          </div>
          {searchParams.ok && <p className="notice ok" role="status">{searchParams.ok}</p>}
          {searchParams.error && <p className="notice" role="alert">{searchParams.error}</p>}
          {!canEdit && <p className="muted small">You can view clients. CGM project managers and admins edit them.</p>}
          <form action={saveClient} className="trk-form">
            <input type="hidden" name="id" value={sel.id} />
            <fieldset disabled={!canEdit}>
              <div className="field">
                <label htmlFor="c_name">Registered entity name</label>
                <input id="c_name" name="name" type="text" defaultValue={sel.name} required />
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="c_ncr">NCR ID</label>
                  <input id="c_ncr" name="ncr_id" type="text" className="mono" defaultValue={sel.ncr_id || ""} placeholder="NCR00000" />
                </div>
                <div className="field">
                  <label htmlFor="c_reg">Regional Entity</label>
                  <select id="c_reg" name="region" defaultValue={sel.region || ""}>
                    <option value="">—</option>
                    {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label htmlFor="c_regdate">NERC Registration Date</label>
                <input id="c_regdate" name="reg_date" type="date" defaultValue={sel.reg_date || ""} className="narrowdate" />
              </div>
              <ClientFunctionsField functions={sel.functions || []} entities={sel.entities || {}} disabled={!canEdit} />
              <div className="field">
                <label htmlFor="c_fac">Facilities</label>
                <textarea id="c_fac" name="facilities" defaultValue={sel.facilities || ""} placeholder="Plant names, units, MW, IBR vs synchronous" />
              </div>
              {person("compliance", "Primary compliance contact", "Email this contact a weekday digest of their overdue and coming-due tasks", true)}
              {person("pm", "Project Manager", "Email the Project Manager a weekday digest (one email covering every client they manage)", true)}
              {person("plant_manager", "Plant Manager", "Email the Plant Manager the weekday client digest of this client's overdue and coming-due tasks", false)}
              <div className="field">
                <label htmlFor="c_pm">CGM project manager (login)</label>
                <select id="c_pm" name="pm_id" defaultValue={sel.pm_id || ""} aria-describedby="c_pm_h">
                  <option value="">Not assigned</option>
                  {(staffPeople || []).map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}{p.staff_role === "pm" ? "" : ` (${p.staff_role})`}</option>)}
                </select>
                <span id="c_pm_h" className="muted small">The client&apos;s users can message this person directly, and they get this client in their weekday PM digest.</span>
              </div>
              <div className="field">
                <label htmlFor="c_sp">SharePoint folder</label>
                <input id="c_sp" name="sharepoint_url" type="url" defaultValue={sel.sharepoint_url || ""} placeholder="https://yourtenant.sharepoint.com/sites/…" autoComplete="off" />
                {sel.sharepoint_url && <a className="small" href={sel.sharepoint_url} target="_blank" rel="noopener noreferrer">Open SharePoint folder ↗</a>}
              </div>
              <div className="field">
                <label htmlFor="c_notes">Notes</label>
                <textarea id="c_notes" name="notes" defaultValue={sel.notes || ""} />
              </div>
              {canEdit && (
                <div className="trk-form-f"><button className="btn-main" type="submit">{isNew ? "Add client" : "Save"}</button></div>
              )}
            </fieldset>
          </form>

          {!isNew && (
            (() => {
              const others = new Set((openTasks || []).filter((t) => t.company_id !== sel.id && !t.sample).map(taskKey));
              const mine = new Set((openTasks || []).filter((t) => t.company_id === sel.id).map(taskKey));
              const missing = [...others].filter((k) => !mine.has(k)).length;
              return (
                <div className="callout">
                  <b>Task set</b>
                  {missing ? (
                    <>
                      <span>{mine.size ? `Missing tasks: ${missing} task${missing === 1 ? " is" : "s are"} assigned to other clients but not to this one.` : `Assign all ${missing} tracker tasks to this client. Copies come without due dates; set each one so reminders and digests can track it.`}</span>
                      <form action={addMissingTasks}>
                        <input type="hidden" name="company_id" value={sel.id} />
                        <button className="btn-line sm" type="submit">{mine.size ? `Add ${missing} missing task${missing === 1 ? "" : "s"}` : `Assign all ${missing} tracker tasks`}</button>
                      </form>
                    </>
                  ) : (
                    <span>This client has every task in the tracker.</span>
                  )}
                </div>
              );
            })()
          )}

          {!isNew && (
            <form action={setClientProducts} className="trk-form addons">
              <input type="hidden" name="id" value={sel.id} />
              <span className="lbl">Applications</span>
              <fieldset disabled={!isAdmin} className="addonlist">
                <label className="checkline"><input type="checkbox" name="watch" defaultChecked={has(sel.id, "watch")} /> CGM Standards Watch</label>
                <label className="checkline"><input type="checkbox" name="tracker" defaultChecked={has(sel.id, "tracker")} /> CGM Compliance Tracker</label>
                <label className="checkline"><input type="checkbox" name="client_tasks" defaultChecked={has(sel.id, "client_tasks")} /> Client Tasks add-on (needs the Tracker)</label>
                <label className="checkline"><input type="checkbox" name="powerworks" defaultChecked={has(sel.id, "powerworks")} /> CGM Powerworks</label>
              </fieldset>
              <span className="muted small">
                Each CGM Workspace application is separate. Client Tasks gives this client its own task list for work outside NERC (environmental, safety, maintenance, internal); it only works while the Tracker is on.
                {!isAdmin && " Only CGM admins change products."}
              </span>
              {isAdmin && <div><button className="btn-line sm" type="submit">Save products</button></div>}
            </form>
          )}

          {!isNew && (
            <section className="trk-form people" id="people" aria-label="People">
              <span className="lbl">People with a login</span>
              {people.length || invites.length ? (
                <ul className="peoplelist">
                  {people.map((p) => (
                    <li key={p.id}>
                      <span>
                        <b>{p.full_name || p.email}</b>
                        <span className="muted small"> {p.email} · {p.company_role === "admin" ? "company admin" : "member"}{p.onboarded_at ? "" : " · hasn't finished setting up"}</span>
                      </span>
                      {canEdit && (
                        <form action={removeClientMember}>
                          <input type="hidden" name="id" value={sel.id} />
                          <input type="hidden" name="member" value={p.id} />
                          <button className="btn-line sm" type="submit" aria-label={`Remove ${p.email}`}>Remove</button>
                        </form>
                      )}
                    </li>
                  ))}
                  {invites.map((i) => (
                    <li key={i.id}>
                      <span><b>{i.email}</b><span className="muted small"> invited as {i.company_role === "admin" ? "company admin" : "member"} · expires {fmt(i.expires_at.slice(0, 10))}</span></span>
                      {canEdit && (
                        <form action={revokeClientInvite}>
                          <input type="hidden" name="id" value={sel.id} />
                          <input type="hidden" name="invite_id" value={i.id} />
                          <button className="btn-line sm" type="submit" aria-label={`Revoke invite for ${i.email}`}>Revoke</button>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No one at this client has a login yet.</p>
              )}
              {canEdit && (
                <form action={inviteToClient} className="toolbar">
                  <input type="hidden" name="id" value={sel.id} />
                  <label className="sr" htmlFor="inv_email">Invite someone at this client</label>
                  <input id="inv_email" name="email" type="email" required placeholder="name@client.com" className="grow" />
                  <select name="company_role" defaultValue="member" aria-label="Role">
                    <option value="member">Member</option>
                    <option value="admin">Company admin</option>
                  </select>
                  <button className="btn-main sm" type="submit">Invite</button>
                </form>
              )}
              <span className="muted small">
                Client users see only this company: its Compliance Tracker tasks (mark performed, evidence, notes) and any other apps in its plan. A company admin can also invite colleagues from their account page, within the company&apos;s seats.
              </span>
            </section>
          )}

          {!isNew && isAdmin && (
            <form action={deleteClient} className="trk-form danger-zone">
              <input type="hidden" name="id" value={sel.id} />
              <label className="checkline">
                <input type="checkbox" name="confirm" /> Delete {sel.name} and its {openCount(sel.id)} open task{openCount(sel.id) === 1 ? "" : "s"} (and completed ones)
              </label>
              <div><button className="btn-line sm danger" type="submit">Delete client</button></div>
            </form>
          )}
        </section>
      )}

      <div className="tablewrap">
        <table className="grid clienttable">
          <thead>
            <tr><th>Entity</th><th>NCR ID</th><th>Registered</th><th>Region</th><th>Registered as</th><th>Project Manager</th><th>Plant Manager</th><th>Facilities</th></tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const contact = contactOf(c.id, "compliance"), pm = contactOf(c.id, "pm"), plant = contactOf(c.id, "plant_manager");
              const mapped = Object.values(c.entities || {}).filter(Boolean).length;
              return (
                <tr key={c.id}>
                  <td>
                    <a className="rowlink" href={`/tracker/clients?c=${c.id}`}><b>{c.name}</b></a>
                    {c.sample && <span className="chip">SAMPLE</span>}
                    {!has(c.id, "tracker") && <span className="chip warn" title="A CGM admin turns the Tracker on under Add-ons">TRACKER OFF</span>}
                    {has(c.id, "client_tasks") && <span className="chip accent">CLIENT TASKS</span>}
                    {c.sharepoint_url && <a className="small sp" href={c.sharepoint_url} target="_blank" rel="noopener noreferrer">SharePoint ↗</a>}
                    {contact && <div className="muted small">{contact.name}{contact.digest && <span className="chip">DIGEST</span>}</div>}
                  </td>
                  <td className="mono">{c.ncr_id || "—"}</td>
                  <td className="nowrap">{c.reg_date ? fmt(c.reg_date) : "—"}</td>
                  <td>{c.region || "—"}</td>
                  <td>
                    {(c.functions || []).map((f) => <span key={f} className="chip">{f}</span>)}
                    {mapped > 0 && <div className="muted small">{mapped} mapped entit{mapped === 1 ? "y" : "ies"}</div>}
                  </td>
                  <td>{pm ? <>{pm.name}{pm.digest && <span className="chip">DIGEST</span>}{pm.email && <div className="muted small">{pm.email}</div>}</> : "—"}</td>
                  <td>{plant ? <>{plant.name}{plant.digest && <span className="chip">DIGEST</span>}{plant.email && <div className="muted small">{plant.email}</div>}</> : "—"}</td>
                  <td className="small">{c.facilities || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </main>
  );
}
