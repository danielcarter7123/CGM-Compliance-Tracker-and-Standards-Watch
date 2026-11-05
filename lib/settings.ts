import type { SupabaseClient } from "@supabase/supabase-js";

/** True when automated emails (tracker reminders, message notices, scheduled digests) may be sent.
    Off unless a CGM admin turned it on in /admin AND the EMAILS_DISABLED environment variable isn't set.
    Every automated sender must check this first. Pass a client that can read app_settings (staff or service role). */
export async function emailsEnabled(db: SupabaseClient): Promise<boolean> {
  if (emailsKilledByEnv()) return false;
  const { data } = await db.from("app_settings").select("value").eq("key", "emails_enabled").maybeSingle();
  return data?.value === true;
}

export function emailsKilledByEnv(): boolean {
  const v = (process.env.EMAILS_DISABLED || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
