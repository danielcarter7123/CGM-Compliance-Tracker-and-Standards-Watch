import { createClient } from "@/lib/supabase/server";
import type { Viewer } from "@/lib/auth";
import { fmt } from "@/lib/watch";
import { inviteColleague, removeMember, revokeInvite, setMemberRole } from "@/app/account/team";

type Member = { id: string; email: string | null; full_name: string | null; company_role: string; onboarded_at: string | null };
type Invite = { id: string; email: string; company_role: string; expires_at: string };

const NOTICE: Record<string, string> = {
  invited: "Invite sent.",
  revoked: "Invite revoked. Its seat is free again.",
  removed: "Removed from your company. They can no longer see your company's information.",
  role: "Role updated.",
};

/** Company admins: seats, colleagues, open invites and the invite form. Read through row level security. */
export default async function TeamCard({ v, team, who }: { v: Viewer; team?: string; who?: string }) {
  if (!v.company) return null;
  const db = createClient();
  const [{ data: co }, { data: members }, { data: invites }] = await Promise.all([
    db.from("companies").select("seats").eq("id", v.company.id).single(),
    db.from("profiles").select("id, email, full_name, company_role, onboarded_at").eq("company_id", v.company.id).is("staff_role", null).order("email"),
    db
      .from("invites")
      .select("id, email, company_role, expires_at")
      .eq("company_id", v.company.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at"),
  ]);
  const seats = (co?.seats as number) ?? 0;
  const used = (members?.length ?? 0) + (invites?.length ?? 0);
  const full = used >= seats;

  return (
    <section className="cardbox wide" id="team">
      <h2>Your team</h2>
      <p style={{ margin: 0 }}>
        <b>{used} of {seats} seats used</b> at {v.company.name}. An open invite holds a seat until it&apos;s accepted, revoked, or expires after 14 days.
      </p>
      {team === "invited-nomail" && (
        <p className="notice">
          Invite created, but the email couldn&apos;t be sent. Ask {who} to sign in on this site with that address; they&apos;ll join your company automatically.
        </p>
      )}
      {team && NOTICE[team] && <p className="notice ok">{team === "invited" && who ? `Invite sent to ${who}.` : NOTICE[team]}</p>}

      <div className="tablewrap">
        <table className="grid team">
          <thead><tr><th>Person</th><th>Role</th><th /></tr></thead>
          <tbody>
            {((members || []) as Member[]).map((m) => (
              <tr key={m.id}>
                <td>
                  {m.full_name || m.email}
                  {m.full_name && <div className="muted" style={{ fontSize: 13 }}>{m.email}</div>}
                  {!m.onboarded_at && <div className="muted" style={{ fontSize: 13 }}>Hasn&apos;t finished setting up yet</div>}
                </td>
                <td>
                  {m.id === v.userId ? (
                    <span>{m.company_role === "admin" ? "Admin (you)" : "Member (you)"}</span>
                  ) : (
                    <form action={setMemberRole} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input type="hidden" name="id" value={m.id} />
                      <select name="company_role" defaultValue={m.company_role} aria-label={`Role for ${m.email}`}>
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                      <button className="btn-line sm" type="submit">Save</button>
                    </form>
                  )}
                </td>
                <td>
                  {m.id !== v.userId && (
                    <form action={removeMember}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="btn-line sm" type="submit" aria-label={`Remove ${m.email}`}>Remove</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {((invites || []) as Invite[]).map((i) => (
              <tr key={i.id}>
                <td>
                  {i.email}
                  <div className="muted" style={{ fontSize: 13 }}>Invited · expires {fmt(i.expires_at.slice(0, 10))}</div>
                </td>
                <td>{i.company_role === "admin" ? "Admin" : "Member"}</td>
                <td>
                  <form action={revokeInvite}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="btn-line sm" type="submit" aria-label={`Revoke invite for ${i.email}`}>Revoke</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {full ? (
        <p className="muted" style={{ margin: 0 }}>
          All seats are in use. Remove someone or revoke an invite, or{" "}
          <a href={`mailto:dan@cgmconsultinggroup.com?subject=${encodeURIComponent(`More seats for ${v.company.name}`)}`}>ask CGM for more seats</a>.
        </p>
      ) : (
        <form action={inviteColleague} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
          <div className="field" style={{ flex: "1 1 260px" }}>
            <label htmlFor="invite-email">Invite a colleague</label>
            <input id="invite-email" name="email" type="email" required placeholder="name@company.com" />
          </div>
          <div className="field">
            <label htmlFor="invite-role">Role</label>
            <select id="invite-role" name="company_role" defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button className="btn-main" type="submit">Send invite</button>
        </form>
      )}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>
        Admins can invite and remove people and manage billing. Members see your company&apos;s information but can&apos;t change the team.
      </p>
    </section>
  );
}
