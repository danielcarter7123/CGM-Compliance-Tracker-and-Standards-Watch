import "server-only";
import { Resend } from "resend";

/** Placeholder values copied from .env.example (re_..., watch@yourdomain.com) count as not configured. */
const real = (v?: string): v is string => !!v && !v.includes("...") && !v.includes("yourdomain");

export type Mail = { to: string; subject: string; text: string; html: string; headers?: Record<string, string> };

/** Where email goes: Resend when configured; in local development the Mailpit catcher, so nothing leaves the PC. */
export function mailTransport(): "resend" | "mailpit" | null {
  if (real(process.env.RESEND_API_KEY) && real(process.env.DIGEST_FROM)) return "resend";
  if (process.env.NODE_ENV !== "production") return "mailpit";
  return null;
}

const MAILPIT = () => process.env.LOCAL_MAILPIT_URL || "http://127.0.0.1:54324";

async function viaMailpit(m: Mail) {
  const res = await fetch(`${MAILPIT()}/api/v1/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      From: { Email: "no-reply@cgm.example", Name: "CGM Compliance Tracker" },
      To: [{ Email: m.to }],
      Subject: m.subject,
      Text: m.text,
      HTML: m.html,
      Headers: m.headers || {},
    }),
  });
  if (!res.ok) throw new Error(`Local mail catcher refused the message (${res.status}).`);
}

/** Sends one transactional email (invites). Returns false when there's no way to send; callers then
 *  show the details on screen instead. */
export async function sendMail(m: Mail): Promise<boolean> {
  const t = mailTransport();
  if (t === "resend") {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.DIGEST_FROM!, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers,
    });
    if (error) throw new Error(error.message);
    return true;
  }
  if (t === "mailpit") {
    try { await viaMailpit(m); return true; } catch { return false; }
  }
  return false;
}

/** Sends many emails (digest, alerts), 100 per Resend call. Throws with how many went out on failure. */
export async function sendBatch(list: Mail[]): Promise<number> {
  const t = mailTransport();
  if (!t) throw new Error("Email isn't configured: set RESEND_API_KEY and DIGEST_FROM.");
  let sent = 0;
  if (t === "mailpit") {
    for (const m of list) { await viaMailpit(m); sent++; }
    return sent;
  }
  const resend = new Resend(process.env.RESEND_API_KEY);
  for (let i = 0; i < list.length; i += 100) {
    const chunk = list.slice(i, i + 100).map((m) => ({
      from: process.env.DIGEST_FROM!, to: [m.to], subject: m.subject, text: m.text, html: m.html, headers: m.headers,
    }));
    const { error } = await resend.batch.send(chunk);
    if (error) throw new Error(`Sent ${sent}, then: ${error.message}`);
    sent += chunk.length;
  }
  return sent;
}
