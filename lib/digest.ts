import type { Content } from "./types";
import { classify, daysUntil, events, fmt, matchesFunctions, rel } from "./watch";

/* The weekly email. One version per subscriber, filtered to their registered functions, as HTML and
   plain text built from the same sections. Inline styles only: email clients ignore stylesheets. */

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const C = { ink: "#0D1B2E", muted: "#55657A", line: "#D3DBE6", accent: "#1747D1", bg: "#F4F7FB", warn: "#A35400" };

export const DISCLAIMER =
  "This summary of publicly available NERC and FERC information is for awareness only and is not a compliance determination. " +
  "Confirm applicability and dates against the approved standard and its implementation plan.";

export type DigestOptions = {
  /** Corrections to earlier digests, one per line, written or confirmed by the editor. */
  corrections?: string[];
  /** This recipient's signed unsubscribe page. */
  unsubscribeUrl?: string;
};

type Row = { left: string; title?: string; lines: string[] };

/** The digest's sections for one set of functions, before any formatting. */
export function digestSections(content: Content, functions: string[]) {
  const items = classify(content.items).filter((i) => i.phase !== "archived" && matchesFunctions(i.fn, functions));
  const updated: Row[] = items
    .filter((i) => i.freshNews.length || i.newApproval)
    .map((i) => ({ left: i.std, title: i.title, lines: i.freshNews.length ? i.freshNews.map((n) => n.t) : [i.what || ""] }));
  const ahead: Row[] = events(items)
    .filter((e) => { const n = daysUntil(e.d); return n > 0 && n <= 120; })
    .map((e) => ({ left: fmt(e.d), lines: [`${e.std} ${e.l === "effective" ? "becomes enforceable" : `· ${e.l}`} (${rel(e.d)})`] }));
  const deadlines: Row[] = content.deadlines
    .filter((d) => { const n = daysUntil(d.d); return n >= 0 && n <= 45 && matchesFunctions(d.fn, functions); })
    .map((d) => ({ left: fmt(d.d), lines: [d.t, d.who || ""].filter(Boolean) }));
  return { updated, ahead, deadlines, fnLabel: functions.length ? functions.join(", ") : "all functions" };
}

export function digestSubject(content: Content) {
  return `NERC Standards Watch: ${content.week?.label ?? "this week's changes"}`;
}

export function renderDigest(content: Content, functions: string[], siteUrl: string, opts: DigestOptions = {}) {
  const { updated, ahead, deadlines, fnLabel } = digestSections(content, functions);
  const corrections = (opts.corrections || []).filter((c) => c.trim());

  const h2 = (t: string) => `<h2 style="font:600 18px Arial,sans-serif;color:${C.ink};margin:28px 0 10px">${esc(t)}</h2>`;
  const td = `border-top:1px solid ${C.line}`;
  const table = (rows: Row[]) =>
    `<table role="presentation" style="width:100%;border-collapse:collapse">${rows
      .map((r) => `<tr><td style="padding:8px 12px 8px 0;font:600 13px 'Courier New',monospace;color:${C.ink};white-space:nowrap;vertical-align:top;${td}">${esc(r.left)}</td><td style="padding:8px 0;font:14px/1.5 Arial,sans-serif;color:${C.ink};${td}">${r.title ? `<b>${esc(r.title)}</b><br>` : ""}${r.lines.map((l, i) => (i && !r.title && r.lines.length === 2 ? `<span style="color:${C.muted}">${esc(l)}</span>` : esc(l))).join("<br>")}</td></tr>`)
      .join("")}</table>`;

  const correctionsHtml = corrections.length
    ? `<div style="border-left:4px solid ${C.warn};background:#fff;padding:12px 18px;margin:0 0 16px;font:14px/1.5 Arial,sans-serif;color:${C.ink}">
        <b>Corrections to earlier digests</b><ul style="margin:6px 0 0;padding-left:18px">${corrections.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>`
    : "";
  const week = content.week
    ? `<div style="border-left:4px solid ${C.accent};background:#fff;padding:14px 18px;margin:0 0 8px">
        <div style="font:600 16px Arial,sans-serif;color:${C.ink}">${esc(content.week.label)}</div>
        <ul style="margin:8px 0 0;padding-left:18px;font:14px/1.5 Arial,sans-serif;color:${C.ink}">
        ${content.week.items.map((x) => `<li>${x.b ? `<b>${esc(x.b)}</b>${/^[A-Z]/.test(x.t || "") ? ": " : " "}` : ""}${esc(x.t)}</li>`).join("")}
        </ul></div>`
    : "";
  const stop = opts.unsubscribeUrl
    ? `<a href="${esc(opts.unsubscribeUrl)}" style="color:${C.muted}">Unsubscribe from this digest</a> · `
    : "";

  return `<!doctype html><html><body style="margin:0;background:${C.bg}">
  <div style="max-width:640px;margin:0 auto;padding:24px 20px;background:${C.bg}">
    <div style="font:600 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${C.accent}">CGM Consulting Group · NERC Standards Watch</div>
    <div style="font:13px Arial,sans-serif;color:${C.muted};margin:4px 0 18px">Filtered for ${esc(fnLabel)} · reviewed ${esc(fmt(content.reviewed))}</div>
    ${correctionsHtml}${week}
    ${updated.length ? h2("Updated this week") + table(updated) : ""}
    ${ahead.length ? h2("Compliance dates in the next 120 days") + table(ahead) : ""}
    ${deadlines.length ? h2("Comment periods and events") + table(deadlines) : ""}
    <p style="margin:28px 0 0"><a href="${esc(siteUrl)}/watch" style="display:inline-block;background:${C.accent};color:#fff;font:600 14px Arial,sans-serif;padding:10px 18px;border-radius:4px;text-decoration:none">Open Standards Watch</a></p>
    <p style="font:12px/1.5 Arial,sans-serif;color:${C.muted};margin:24px 0 0">${esc(DISCLAIMER)} ${stop}<a href="${esc(siteUrl)}/account" style="color:${C.muted}">Change your functions or emails</a>.</p>
  </div></body></html>`;
}

/** The same digest as plain text, for mail apps that don't show HTML and for spam filters that expect both. */
export function renderDigestText(content: Content, functions: string[], siteUrl: string, opts: DigestOptions = {}) {
  const { updated, ahead, deadlines, fnLabel } = digestSections(content, functions);
  const corrections = (opts.corrections || []).filter((c) => c.trim());
  const out: string[] = ["NERC STANDARDS WATCH · CGM Consulting Group", `Filtered for ${fnLabel} · reviewed ${fmt(content.reviewed)}`, ""];
  const section = (h: string, rows: Row[]) => {
    if (!rows.length) return;
    out.push(h.toUpperCase(), "-".repeat(h.length));
    for (const r of rows) out.push(`${r.left}${r.title ? ` · ${r.title}` : ""}`, ...r.lines.map((l) => `  ${l}`), "");
  };
  if (corrections.length) out.push("CORRECTIONS TO EARLIER DIGESTS", ...corrections.map((c) => `* ${c}`), "");
  if (content.week) {
    out.push(content.week.label.toUpperCase());
    for (const x of content.week.items) out.push(`* ${x.b ? `${x.b}${/^[A-Z]/.test(x.t || "") ? ": " : " "}` : ""}${x.t}`);
    out.push("");
  }
  section("Updated this week", updated);
  section("Compliance dates in the next 120 days", ahead);
  section("Comment periods and events", deadlines);
  out.push(`Open Standards Watch: ${siteUrl}/watch`, "", DISCLAIMER);
  if (opts.unsubscribeUrl) out.push(`Unsubscribe from this digest: ${opts.unsubscribeUrl}`);
  out.push(`Change your functions or emails: ${siteUrl}/account`);
  return out.join("\n");
}
