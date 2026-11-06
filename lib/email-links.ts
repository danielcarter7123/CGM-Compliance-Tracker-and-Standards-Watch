import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { siteUrl } from "./stripe";

/* Signed unsubscribe links. The weekly digest is on by default; alerts are an opt-in extra. Each kind has its own
   link, so stopping alerts doesn't stop the digest.
   The signature is an HMAC of the user id and kind with EMAIL_LINK_SECRET (server only), so a link
   can't be forged for someone else and needs no database token. */

export type ListKind = "digest" | "alerts";
export const LIST_NAME: Record<ListKind, string> = { digest: "the weekly Standards Watch digest", alerts: "Standards Watch alerts" };
export const LIST_COLUMN: Record<ListKind, "digest_opt_in" | "alerts_opt_in"> = { digest: "digest_opt_in", alerts: "alerts_opt_in" };

function secret() {
  const s = process.env.EMAIL_LINK_SECRET || (process.env.NODE_ENV !== "production" ? process.env.SUPABASE_SERVICE_ROLE_KEY : "");
  if (!s || s.length < 24) throw new Error("EMAIL_LINK_SECRET must be set (24+ characters) to send emails with unsubscribe links.");
  return s;
}
const sign = (uid: string, kind: ListKind) => createHmac("sha256", secret()).update(`unsub:${kind}:${uid}`).digest("base64url").slice(0, 32);

export const isListKind = (k: unknown): k is ListKind => k === "digest" || k === "alerts";

export function verifyUnsubscribe(uid: string, kind: ListKind, token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uid) || typeof token !== "string") return false;
  const a = Buffer.from(sign(uid, kind));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function query(uid: string, kind: ListKind) {
  return `u=${uid}&k=${kind}&t=${sign(uid, kind)}`;
}

/** The page a person opens from the email (asks before unsubscribing, so link scanners can't). */
export const unsubscribePage = (uid: string, kind: ListKind) => `${siteUrl()}/unsubscribe?${query(uid, kind)}`;

/** Headers for one-click unsubscribe in Gmail, Outlook and Apple Mail (RFC 8058). */
export const unsubscribeHeaders = (uid: string, kind: ListKind) => ({
  "List-Unsubscribe": `<${siteUrl()}/api/unsubscribe?${query(uid, kind)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

/* Tracker emails go to addresses that may have no login (client contacts, imported assignees), so their unsubscribe
   links carry the address and kind encrypted (AES-256-GCM with a key derived from EMAIL_LINK_SECRET): no email
   address appears in a URL, and a link can't be forged or altered. Opt-outs are kept by address (email_optouts). */

export type TrackerKind = "tracker_digest" | "tracker_reminders" | "messages";
export const TRACKER_LIST_NAME: Record<TrackerKind, string> = {
  tracker_digest: "the weekday CGM Compliance Tracker digest",
  tracker_reminders: "CGM Compliance Tracker task reminders",
  messages: "the daily unread-messages notice",
};
export const isTrackerKind = (k: unknown): k is TrackerKind => k === "tracker_digest" || k === "tracker_reminders" || k === "messages";

const key = () => createHash("sha256").update(`tracker-unsub:${secret()}`).digest();

export function sealOptOut(email: string, kind: TrackerKind): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(`${kind}\n${email.toLowerCase()}`, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64url");
}

export function openOptOut(token: string): { email: string; kind: TrackerKind } | null {
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 30 || raw.length > 600) return null;
    const d = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const [kind, email] = Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8").split("\n");
    return isTrackerKind(kind) && /^[^@\s]+@[^@\s]+$/.test(email || "") ? { email, kind } : null;
  } catch {
    return null;
  }
}

export const optOutPage = (email: string, kind: TrackerKind) => `${siteUrl()}/unsubscribe?x=${sealOptOut(email, kind)}`;
export const optOutHeaders = (email: string, kind: TrackerKind) => ({
  "List-Unsubscribe": `<${siteUrl()}/api/unsubscribe?x=${sealOptOut(email, kind)}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});
