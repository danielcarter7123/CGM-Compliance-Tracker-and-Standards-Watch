import "server-only";
import { sendMail } from "./mail";
import { siteUrl } from "./stripe";

const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]);

/** The CGM Workspace invite email, sent when a company admin or CGM invites someone. Returns false when it
 *  couldn't be sent; the invite still works when the person signs in with that address. */
export async function sendInviteEmail(who: string, company: string, email: string): Promise<boolean> {
  const link = `${siteUrl()}/login?next=/workspace`; // the sign-in callback shows new joiners the welcome screen first
  try {
    return await sendMail({
      to: email,
      subject: `${who} invited you to ${company} on CGM Workspace`,
      text:
        `${who} invited you to join ${company} on CGM Workspace from CGM Consulting Group.\n\n` +
        `Sign in with this email address (${email}) at:\n${link}\n\n` +
        `Use "Sign in with Microsoft" if your company uses Microsoft 365, or have a one-time sign-in link emailed to you. ` +
        `There's no password. The invite expires in 14 days.`,
      html: `<div style="font:15px/1.5 Arial,sans-serif;color:#0D1B2E;max-width:520px">
  <p><b>${esc(who)}</b> invited you to join <b>${esc(company)}</b> on CGM Workspace from CGM Consulting Group.</p>
  <p>Sign in with this email address (${esc(email)}): use &ldquo;Sign in with Microsoft&rdquo; if your company uses Microsoft 365, or have a one-time link emailed to you. There&rsquo;s no password.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#1747D1;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Sign in to accept</a></p>
  <p style="color:#55657A;font-size:13px">The invite expires in 14 days.</p></div>`,
    });
  } catch {
    return false;
  }
}
