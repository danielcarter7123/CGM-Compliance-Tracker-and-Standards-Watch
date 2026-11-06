import { NextResponse, type NextRequest } from "next/server";
import { LIST_COLUMN, isListKind, verifyUnsubscribe } from "@/lib/email-links";
import { createAdminClient } from "@/lib/supabase/admin";

/** One-click unsubscribe (RFC 8058): mail apps POST here from the List-Unsubscribe header.
 *  The signed link is the check; there's no session. */
export async function POST(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const u = p.get("u") || "", k = p.get("k"), t = p.get("t") || "";
  if (!isListKind(k) || !verifyUnsubscribe(u, k, t)) return NextResponse.json({ error: "invalid link" }, { status: 400 });
  const { error } = await createAdminClient().from("profiles").update({ [LIST_COLUMN[k]]: false }).eq("id", u);
  if (error) return NextResponse.json({ error: "could not update" }, { status: 500 });
  return NextResponse.json({ unsubscribed: k });
}
