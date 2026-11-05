"use client";

import { usePathname } from "next/navigation";

/** Full-screen pages (sign-in) hide the site masthead and footer. The children are rendered on the server. */
const BARE = ["/login"];

export default function SiteChrome({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (BARE.some((p) => path === p || path.startsWith(`${p}/`))) return null;
  return <>{children}</>;
}
