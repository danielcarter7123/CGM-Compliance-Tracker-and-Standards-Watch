"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

/** Refreshes the page when a message arrives anywhere the signed-in person can see (Supabase Realtime applies
 *  row level security, so nobody is told about conversations they can't read). */
export default function LiveRefresh() {
  const router = useRouter();
  useEffect(() => {
    const db = createClient();
    const channel = db
      .channel("messages-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_messages" }, () => router.refresh())
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [router]);
  return null;
}
