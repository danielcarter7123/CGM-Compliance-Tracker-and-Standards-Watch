import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { siteUrl } from "./stripe";

/* Signed unsubscribe links. Each email kind has its own link, so stopping alerts doesn't stop the digest.
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
