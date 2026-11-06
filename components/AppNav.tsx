"use client";

import { usePathname } from "next/navigation";
import type { Section } from "@/lib/nav";

/** CGM Compliance Tracker's section tabs. Underlines the current section; sections not built
 *  yet are greyed out. */
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
        ) : (
          <a key={s.label} href={s.href} aria-current={current(s.href) ? "page" : undefined}>{s.label}</a>
        ),
      )}
    </nav>
  );
}
