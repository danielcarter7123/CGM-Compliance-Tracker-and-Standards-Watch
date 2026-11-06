import { LIST_NAME, isListKind, verifyUnsubscribe } from "@/lib/email-links";
import { confirmUnsubscribe } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Unsubscribe | CGM Standards Watch" };

/** Opened from the link at the bottom of a Standards Watch email. Asks first, so email security
 *  scanners that open links can't unsubscribe anyone. No sign-in needed. */
export default function Unsubscribe({ searchParams }: { searchParams: { u?: string; k?: string; t?: string; done?: string; bad?: string } }) {
  const { u = "", k, t = "", done } = searchParams;
  const ok = isListKind(k) && verifyUnsubscribe(u, k, t);
  return (
    <main className="wrap page" style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      <h1>Email preferences</h1>
      {isListKind(done) ? (
        <>
          <p className="notice ok">You&apos;re unsubscribed from {LIST_NAME[done]}.</p>
          <p className="muted">Changed your mind? Turn it back on from your <a href="/account">account page</a>.</p>
        </>
      ) : ok ? (
        <form action={confirmUnsubscribe} className="cardbox">
          <input type="hidden" name="u" value={u} />
          <input type="hidden" name="k" value={k} />
          <input type="hidden" name="t" value={t} />
          <p style={{ margin: 0 }}>Stop sending you {LIST_NAME[k]}?</p>
          <div><button className="btn-main" type="submit">Unsubscribe</button></div>
        </form>
      ) : (
        <p className="notice">This unsubscribe link isn&apos;t valid. You can change which emails you get on your <a href="/account">account page</a>.</p>
      )}
    </main>
  );
}
