import type { Content } from "./types";
import { classify, daysUntil, events, fmt, matchesFunctions, rel } from "./watch";

/* The weekly email. One version per subscriber, filtered to their registered functions.
   Inline styles only: email clients ignore stylesheets. */

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const C = { ink: "#0D1B2E", muted: "#55657A", line: "#D3DBE6", accent: "#1747D1", bg: "#F4F7FB" };

export function digestSubject(content: Content) {
  return `NERC Standards Watch: ${content.week?.label ?? "this week's changes"}`;
}

export function renderDigest(content: Content, functions: string[], siteUrl: string) {
  const items = classify(content.items).filter((i) => i.phase !== "archived" && matchesFunctions(i.fn, functions));
  const updated = items.filter((i) => i.freshNews.length || i.newApproval);
  const ahead = events(items).filter((e) => {
    const n = daysUntil(e.d);
    return n > 0 && n <= 120;
  });
  const dls = content.deadlines.filter((d) => {
    const n = daysUntil(d.d);
    return n >= 0 && n <= 45 && matchesFunctions(d.fn, functions);
  });
  const fnLabel = functions.length ? functions.join(", ") : "all functions";

  const h2 = (t: string) => `<h2 style="font:600 18px Arial,sans-serif;color:${C.ink};margin:28px 0 10px">${esc(t)}</h2>`;
  const row = (left: string, right: string) =>
    `<tr><td style="padding:8px 12px 8px 0;font:600 13px 'Courier New',monospace;color:${C.ink};white-space:nowrap;vertical-align:top;border-top:1px solid ${C.line}">${left}</td><td style="padding:8px 0;font:14px/1.5 Arial,sans-serif;color:${C.ink};border-top:1px solid ${C.line}">${right}</td></tr>`;

  const week = content.week
    ? `<div style="border-left:4px solid ${C.accent};background:#fff;padding:14px 18px;margin:0 0 8px">
        <div style="font:600 16px Arial,sans-serif;color:${C.ink}">${esc(content.week.label)}</div>
        <ul style="margin:8px 0 0;padding-left:18px;font:14px/1.5 Arial,sans-serif;color:${C.ink}">
        ${content.week.items.map((x) => `<li>${x.b ? `<b>${esc(x.b)}</b>${/^[A-Z]/.test(x.t || "") ? ": " : " "}` : ""}${esc(x.t)}</li>`).join("")}
        </ul></div>`
    : "";

  const updatedHtml = updated.length
    ? `${h2("Updated this week")}<table role="presentation" style="width:100%;border-collapse:collapse">${updated
        .map((i) => row(esc(i.std), `<b>${esc(i.title)}</b><br>${(i.freshNews.length ? i.freshNews.map((n) => esc(n.t)) : [esc(i.what)]).join("<br>")}`))
        .join("")}</table>`
    : "";

  const aheadHtml = ahead.length
    ? `${h2("Compliance dates in the next 120 days")}<table role="presentation" style="width:100%;border-collapse:collapse">${ahead
        .map((e) => row(esc(fmt(e.d)), `<b>${esc(e.std)}</b> ${e.l === "effective" ? "becomes enforceable" : "· " + esc(e.l)} <span style="color:${C.muted}">(${esc(rel(e.d))})</span>`))
        .join("")}</table>`
    : "";

  const dlHtml = dls.length
    ? `${h2("Comment periods and events")}<table role="presentation" style="width:100%;border-collapse:collapse">${dls
        .map((d) => row(esc(fmt(d.d)), `${esc(d.t)}<br><span style="color:${C.muted}">${esc(d.who)}</span>`))
        .join("")}</table>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:${C.bg}">
  <div style="max-width:640px;margin:0 auto;padding:24px 20px;background:${C.bg}">
    <div style="font:600 12px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:${C.accent}">CGM Consulting Group · NERC Standards Watch</div>
    <div style="font:13px Arial,sans-serif;color:${C.muted};margin:4px 0 18px">Filtered for ${esc(fnLabel)} · reviewed ${esc(fmt(content.reviewed))}</div>
    ${week}${updatedHtml}${aheadHtml}${dlHtml}
    <p style="margin:28px 0 0"><a href="${esc(siteUrl)}/watch" style="display:inline-block;background:${C.accent};color:#fff;font:600 14px Arial,sans-serif;padding:10px 18px;border-radius:4px;text-decoration:none">Open Standards Watch</a></p>
    <p style="font:12px/1.5 Arial,sans-serif;color:${C.muted};margin:24px 0 0">This summary of publicly available NERC and FERC information is for awareness only and is not a compliance determination. Confirm applicability and dates against the approved standard and its implementation plan. Change your functions or stop these emails on your <a href="${esc(siteUrl)}/account" style="color:${C.muted}">account page</a>.</p>
  </div></body></html>`;
}
