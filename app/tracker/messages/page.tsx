import LiveRefresh from "@/components/LiveRefresh";
import MessageComposer from "@/components/MessageComposer";
import { isLive } from "@/lib/entitlements";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { createChannel, deleteMessage, sendMessage } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };

type Chat = { id: string; type: "channel" | "dm" | "client"; name: string | null; members: string[]; company_id: string | null; last_at: string | null; last_by: string | null };
type Msg = { id: string; author_id: string; body: string; task_ref: { kind: string; id: string; label: string } | null; created_at: string; deleted_at: string | null };

const day = (s: string) => new Date(s).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric" });
const time = (s: string) => new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Plain text with https links made clickable (nothing else is interpreted). */
function linkify(text: string) {
  return text.split(/(https:\/\/[^\s<>"]+)/g).map((part, i) =>
    /^https:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a> : <span key={i}>{part}</span>,
  );
}

/** Messages (TRACKER-SPEC §3.10, decision 6): CGM team channels, direct messages and one channel per client.
 *  Client users see their company's channel and can message their CGM project manager. No email for messages. */
export default async function Messages({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const v = await requireTracker("/tracker/messages");
  const db = createClient();
  const [{ data: chatRows }, { data: reads }] = await Promise.all([
    db.from("chats").select("id, type, name, members, company_id, last_at, last_by"),
    db.from("chat_reads").select("chat_id, read_at").eq("user_id", v.userId),
  ]);
  const chats = (chatRows || []) as Chat[];
  const readAt = new Map((reads || []).map((r) => [r.chat_id as string, r.read_at as string]));
  const unread = (c: Chat) => !!c.last_at && c.last_by !== v.userId && (!readAt.has(c.id) || c.last_at > (readAt.get(c.id) as string));

  // Clients with a channel slot: staff see every Tracker client; a client user sees their own company.
  let clients: { id: string; name: string; pm_id: string | null }[] = [];
  if (v.isStaff) {
    const [{ data: cos }, { data: ents }] = await Promise.all([
      db.from("companies").select("id, name, pm_id").eq("sample", false).order("name"),
      db.from("entitlements").select("company_id, status").eq("product", "tracker"),
    ]);
    const live = new Set((ents || []).filter((e) => isLive(e.status as string)).map((e) => e.company_id as string));
    clients = ((cos || []) as typeof clients).filter((c) => live.has(c.id));
  } else if (v.company) {
    const { data: co } = await db.from("companies").select("id, name, pm_id").eq("id", v.company.id).maybeSingle();
    if (co) clients = [co as (typeof clients)[number]];
  }
  const myPm = !v.isStaff ? clients[0]?.pm_id || null : null;

  // People for direct messages (staff can start one with anyone; clients only with their PM).
  let people: { id: string; label: string }[] = [];
  if (v.isStaff) {
    const { data: ps } = await db.from("profiles").select("id, full_name, email, staff_role").neq("id", v.userId).order("email");
    people = (ps || []).map((p) => ({ id: p.id as string, label: `${(p.full_name as string) || (p.email as string)}${p.staff_role ? " (CGM)" : ""}` }));
  }

  // Names for DM members and authors.
  const ids = new Set<string>(chats.flatMap((c) => c.members));
  if (myPm) ids.add(myPm);

  // Which conversation is open.
  const clientChat = (cid: string) => chats.find((c) => c.type === "client" && c.company_id === cid);
  const dmWith = (uid: string) => chats.find((c) => c.type === "dm" && c.members.includes(uid) && c.members.includes(v.userId));
  let sel: Chat | undefined = sp.c ? chats.find((c) => c.id === sp.c) : undefined;
  let target: Record<string, string> = sel ? { c: sel.id } : {};
  if (!sel && sp.client) { sel = clientChat(sp.client); target = sel ? { c: sel.id } : { client: sp.client }; }
  if (!sel && sp.dm) { sel = dmWith(sp.dm); target = sel ? { c: sel.id } : { dm: sp.dm }; }
  if (!sel && !target.client && !target.dm) {
    sel = v.isStaff ? chats.find((c) => c.type === "channel" && c.name === "General") : clients[0] ? clientChat(clients[0].id) : undefined;
    if (sel) target = { c: sel.id };
    else if (!v.isStaff && clients[0]) target = { client: clients[0].id };
  }
  const selCompany = sel?.company_id || (target.client as string | undefined) || null;

  let msgs: Msg[] = [];
  if (sel) {
    const { data } = await db.from("chat_messages").select("id, author_id, body, task_ref, created_at, deleted_at").eq("chat_id", sel.id).order("created_at", { ascending: false }).limit(200);
    msgs = ((data || []) as Msg[]).reverse();
    msgs.forEach((m) => ids.add(m.author_id));
    // Opening a conversation marks it read (read markers are private to each person).
    if (unread(sel) || !readAt.has(sel.id)) {
      await db.from("chat_reads").upsert({ chat_id: sel.id, read_at: new Date().toISOString() }, { onConflict: "user_id,chat_id" });
      readAt.set(sel.id, new Date().toISOString());
    }
  }
  const { data: nameRows } = ids.size ? await db.rpc("people_names", { ids: [...ids] }) : { data: [] };
  const names = new Map(((nameRows || []) as { id: string; name: string; staff: boolean }[]).map((n) => [n.id, n]));
  const nameOf = (id: string) => (id === v.userId ? "You" : names.get(id)?.name || "Someone");

  const title = (c: Chat | undefined, t: Record<string, string>) => {
    if (c?.type === "channel") return `# ${c.name}`;
    const cid = c?.company_id || t.client;
    if (cid) return clients.find((x) => x.id === cid)?.name || "Client";
    const other = c ? c.members.find((m) => m !== v.userId) : t.dm;
    return other ? (other === myPm ? `${nameOf(other)} (your CGM project manager)` : nameOf(other)) : "Messages";
  };

  // Tasks to link: open tasks of the client in this conversation; the Discuss task is always offered.
  let tasks: { id: string; title: string }[] = [];
  if (selCompany) {
    const { data } = await db.from("tasks").select("id, title").eq("company_id", selCompany).neq("status", "done").order("due_date").limit(200);
    tasks = (data || []) as typeof tasks;
  }
  let discuss: { id: string; title: string } | null = null;
  if (sp.task) {
    const { data } = await db.from("tasks").select("id, title").eq("id", sp.task).maybeSingle();
    discuss = (data as typeof discuss) || null;
  } else if (sp.ctask) {
    const { data } = await db.from("client_tasks").select("id, title").eq("id", sp.ctask).maybeSingle();
    discuss = data ? { id: `ctask:${data.id}`, title: `${data.title} (client task)` } : null;
  }

  const channels = chats.filter((c) => c.type === "channel").sort((a, b) => (a.name === "General" ? -1 : b.name === "General" ? 1 : (a.name || "").localeCompare(b.name || "")));
  const dms = chats.filter((c) => c.type === "dm").sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));
  const isOpen = (key: string) => (sel ? sel.id === key : target.client === key || target.dm === key);
  const item = (key: string, href: string, label: string, isUnread: boolean) => (
    <a key={key} href={href} className={`convo${isOpen(key) ? " open" : ""}${isUnread ? " unread" : ""}`} aria-current={isOpen(key) ? "true" : undefined}>
      <span>{label}</span>
      {isUnread && <span className="dot" aria-label="unread">●</span>}
    </a>
  );

  let lastDay = "", lastAuthor = "", lastAt = 0;
  return (
    <main className="wrap trk-page msgs">
      <LiveRefresh />
      <div className="trk-head"><h1>Messages</h1><span className="muted small">No email or notifications for messages; they live here.</span></div>
      {sp.error && <p className="notice" role="alert">{sp.error}</p>}
      <div className="msg-grid">
        <nav className="convos" aria-label="Conversations">
          {v.isStaff && (
            <>
              <div className="convo-h">CGM team</div>
              {channels.map((c) => item(c.id, `/tracker/messages?c=${c.id}`, `# ${c.name}`, unread(c)))}
              <form action={createChannel} className="convo-new">
                <label className="sr" htmlFor="chname">New channel name</label>
                <input id="chname" name="name" type="text" placeholder="New channel" maxLength={60} />
                <button className="btn-line sm" type="submit">Add</button>
              </form>
            </>
          )}
          <div className="convo-h">Direct messages</div>
          {dms.map((c) => item(c.id, `/tracker/messages?c=${c.id}`, title(c, {}), unread(c)))}
          {!v.isStaff && myPm && !dmWith(myPm) && item(myPm, `/tracker/messages?dm=${myPm}`, `Message ${nameOf(myPm)} (your CGM project manager)`, false)}
          {!v.isStaff && !myPm && <p className="muted small convo-note">Your CGM project manager appears here once CGM assigns one to your company.</p>}
          {v.isStaff && people.length > 0 && (
            <form method="get" className="convo-new">
              <label className="sr" htmlFor="dmpick">Start a direct message</label>
              <select id="dmpick" name="dm" defaultValue="">
                <option value="" disabled>Start a direct message…</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <button className="btn-line sm" type="submit">Open</button>
            </form>
          )}
          <div className="convo-h">{v.isStaff ? "Clients" : "Your company"}</div>
          {clients.map((co) => {
            const c = clientChat(co.id);
            return item(c ? c.id : co.id, c ? `/tracker/messages?c=${c.id}` : `/tracker/messages?client=${co.id}`, co.name, c ? unread(c) : false);
          })}
        </nav>

        <section className="thread" aria-label={title(sel, target)}>
          <div className="thread-h"><h2>{title(sel, target)}</h2></div>
          <div className="thread-b">
            {!msgs.length && <p className="muted">No messages yet. {target.client || selCompany ? "This conversation is shared by CGM and the client's users." : ""}</p>}
            {msgs.length === 200 && <p className="muted small">Showing the latest 200 messages.</p>}
            {msgs.map((m) => {
              const d = day(m.created_at);
              const showDay = d !== lastDay;
              const t = new Date(m.created_at).getTime();
              const collapse = !showDay && m.author_id === lastAuthor && t - lastAt < 5 * 60e3;
              lastDay = d; lastAuthor = m.author_id; lastAt = t;
              return (
                <div key={m.id}>
                  {showDay && <div className="dayline"><span>{d}</span></div>}
                  <article className={`msg${collapse ? " cont" : ""}${m.author_id === v.userId ? " mine" : ""}`} aria-label={`Message from ${nameOf(m.author_id)}`}>
                    {!collapse && (
                      <div className="msg-h">
                        <b>{nameOf(m.author_id)}</b>
                        {names.get(m.author_id)?.staff && <span className="chip accent">CGM</span>}
                        <span className="muted small">{time(m.created_at)}</span>
                      </div>
                    )}
                    {m.deleted_at ? (
                      <p className="msg-b muted"><i>Message deleted</i></p>
                    ) : (
                      <>
                        <p className="msg-b">{linkify(m.body)}</p>
                        {m.task_ref && (
                          <a className="taskchip" href={m.task_ref.kind === "ctask" ? `/tracker/client-tasks?status=all&t=${m.task_ref.id}` : `/tracker/tasks?status=all&t=${m.task_ref.id}`}>▤ {m.task_ref.label}</a>
                        )}
                        {m.author_id === v.userId && sel && (
                          <form action={deleteMessage} className="msg-del">
                            <input type="hidden" name="id" value={m.id} />
                            <input type="hidden" name="c" value={sel.id} />
                            <button type="submit" className="linkbtn" aria-label="Delete this message">Delete</button>
                          </form>
                        )}
                      </>
                    )}
                  </article>
                </div>
              );
            })}
          </div>
          {(sel || target.client || target.dm) && (
            <MessageComposer
              key={`${sel?.id || ""}:${msgs[msgs.length - 1]?.id || ""}`}
              action={sendMessage}
              target={target}
              draftKey={sel?.id || target.client || target.dm || "none"}
              tasks={tasks}
              task={discuss}
            />
          )}
        </section>
      </div>
    </main>
  );
}
