import { redirect } from "next/navigation";
import WatchView from "@/components/WatchView";
import { getViewer } from "@/lib/auth";
import { loadContent } from "@/lib/content";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WatchPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/watch");
  if (!viewer.hasAccess) redirect("/account?need=subscription");
  // Read as the subscriber: row level security confirms the subscription again.
  const content = await loadContent(createClient());
  return (
    <main>
      <WatchView content={content} defaultFunctions={viewer.functions} />
    </main>
  );
}
