import { LIST_NAME, TRACKER_LIST_NAME, isListKind, isTrackerKind, openOptOut, verifyUnsubscribe } from "@/lib/email-links";
import { confirmUnsubscribe } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email preferences" };

/** Opened from the link at the bottom of an email. Asks first, so email security scanners that open links can't
 *  unsubscribe anyone. No sign-in needed. Standards Watch links carry a signed user id (u, k, t); Tracker links carry
 *  the address and kind encrypted (x), since their recipients may have no login. */
export default function Unsubscribe({ searchParams }: { searchParams: { u?: string; k?: string; t?: string; x?: string; done?: string; bad?: string } }) {
  const { u = "", k, t = "", x = "", done } = searchParams;
  const tracker = x ? openOptOut(x) : null;
  const ok = !!tracker || (isListKind(k) && verifyUnsubscribe(u, k, t));
  const name = tracker ? TRACKER_LIST_NAME[tracker.kind] : isListKind(k) ? LIST_NAME[k] : "";
  const doneName = isListKind(done) ? LIST_NAME[done] : isTrackerKind(done) ? TRACKER_LIST_NAME[done] : "";
  return (
    <main className="wrap page" style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      <h1>Email preferences</h1>
      {doneName ? (
        <>
          <p className="notice ok">You&apos;re unsubscribed from {doneName}. Other emails you get from us aren&apos;t affected.</p>
          <p className="muted">Changed your mind? Turn it back on from your <a href="/account">account page</a>, or ask your CGM project manager.</p>
        </>
      ) : ok ? (
        <form action={confirmUnsubscribe} className="cardbox">
          {tracker ? <input type="hidden" name="x" value={x} /> : (
            <>
              <input type="hidden" name="u" value={u} />
              <input type="hidden" name="k" value={k} />
              <input type="hidden" name="t" value={t} />
            </>
          )}
          <p style={{ margin: 0 }}>Stop sending you {name}?</p>
          <div><button className="btn-main" type="submit">Unsubscribe</button></div>
        </form>
      ) : (
        <p className="notice">This unsubscribe link isn&apos;t valid. You can change which emails you get on your <a href="/account">account page</a>.</p>
      )}
    </main>
  );
}
