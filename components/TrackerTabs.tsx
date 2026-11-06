"use client";

import { usePathname } from "next/navigation";

export type TrackerSection = { label: string; href?: string };

/** The Tracker's section tabs. Sections still to be built are shown greyed out. */
export default function TrackerTabs({ sections }: { sections: TrackerSection[] }) {
  const path = usePathname();
  const current = (href: string) => (href === "/tracker" ? path === "/tracker" : path === href || path.startsWith(`${href}/`));
  return (
    <nav className="trk-tabs" aria-label="Tracker">
      {sections.map((s) =>
        s.href ? (
          <a key={s.label} href={s.href} aria-current={current(s.href) ? "page" : undefined}>{s.label}</a>
        ) : (
          <span key={s.label} className="soon" title="Coming in a later milestone">{s.label}</span>
        ),
      )}
    </nav>
  );
}
