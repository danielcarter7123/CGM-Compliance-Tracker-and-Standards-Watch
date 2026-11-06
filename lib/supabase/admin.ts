import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client. Bypasses row level security: use only in server code after checking who is asking
 *  (Stripe webhook, drafts API, digest sending, calendar feed, public teaser, signed unsubscribe links,
 *  the alert job behind CRON_SECRET). */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
