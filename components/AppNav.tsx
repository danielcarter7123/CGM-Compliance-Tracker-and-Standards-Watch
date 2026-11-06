"use client";

import { usePathname } from "next/navigation";
import type { Section } from "@/lib/nav";

/** The section menu under the CGM Compliance Tracker header. Underlines the current section; sections not built
 *  yet are greyed out; a locked section links to the account page, which explains how to get it. */
export default function AppNav({ sections }: { sections: Section[] }) {
  const path = usePathname();
  const current = (href: string) =>
    href === "/tracker" ? path === "/tracker" : path === href || path.startsWith(`${href}/`);
  if (!sections.length) return null;
  return (
    <nav className="appnav" aria-label="Sections">
      {sections.map((s) =>
        !s.href ? (
          <span key={s.label} className="soon" title="Coming in a later milestone">{s.label}</span>
        ) : s.locked ? (
          <a key={s.label} href={s.href} className="locked" title="Available by agreement with CGM Consulting Group">
            {s.label} <span aria-hidden="true">🔒</span>
          </a>
        ) : (
          <a key={s.label} href={s.href} aria-current={current(s.href) ? "page" : undefined}>{s.label}</a>
        ),
      )}
    </nav>
  );
}
