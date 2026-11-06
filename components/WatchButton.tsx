"use client";

import { usePathname } from "next/navigation";

/** NERC Standards Watch's own spot in the header: a button of its own, not one of the Tracker's section tabs
 *  (Dan's decision 16). Filled while you're on the Watch page. */
export default function WatchButton() {
  const path = usePathname();
  const here = path === "/watch";
  return (
    <a className={`watchbtn${here ? " here" : ""}`} href="/watch" aria-current={here ? "page" : undefined}>
      <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 6h14M3 12h9M3 18h7m4-1.5 2.5 2.5 5-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      NERC Standards Watch
    </a>
  );
}
