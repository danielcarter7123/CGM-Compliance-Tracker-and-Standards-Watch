import "server-only";
import { Resend } from "resend";

/** Placeholder values copied from .env.example (re_..., watch@yourdomain.com) count as not configured. */
const real = (v?: string): v is string => !!v && !v.includes("...") && !v.includes("yourdomain");

export type Mail = { to: string; subject: string; text: string; html: string };

/** Sends one transactional email (sign-in related: invites). Uses Resend when it is configured.
 *  In local development without Resend it goes to the local mail catcher (Mailpit), so nothing leaves the PC.
 *  Returns false when there is no way to send; callers then show the details on screen instead. */
export async function sendMail(m: Mail): Promise<boolean> {
  const from = process.env.DIGEST_FROM;
  if (real(process.env.RESEND_API_KEY) && real(from)) {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from, to: m.to, subject: m.subject, text: m.text, html: m.html });
    if (error) throw new Error(error.message);
    return true;
  }
  if (process.env.NODE_ENV !== "production") {
    const res = await fetch(`${process.env.LOCAL_MAILPIT_URL || "http://127.0.0.1:54324"}/api/v1/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ From: { Email: "no-reply@cgm.example", Name: "CGM Compliance Platform" }, To: [{ Email: m.to }], Subject: m.subject, Text: m.text, HTML: m.html }),
    }).catch(() => null);
    return !!res?.ok;
  }
  return false;
}
