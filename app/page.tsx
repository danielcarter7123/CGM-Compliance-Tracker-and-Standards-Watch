import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { homeFor } from "@/lib/nav";

export const dynamic = "force-dynamic";

/** The front door of CGM Compliance Tracker: the sign-in screen when signed out, otherwise your home
 *  (Dashboard for Tracker users, Standards Watch for Watch subscribers, Account for everyone else).
 *  The NERC Standards Watch offer for prospective subscribers lives at /standards-watch. */
export default async function Home() {
  const viewer = await getViewer().catch(() => null);
  redirect(viewer ? homeFor(viewer) : "/login");
}
