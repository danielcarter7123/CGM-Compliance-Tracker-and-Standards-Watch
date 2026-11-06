import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Where the emailed sign-in link lands: trades the one-time code for a session cookie. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") || "/watch";
  const next = nextParam.startsWith("/") ? nextParam : "/watch";
  if (code) {
    const supabase = createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Join the company that invited this address, if any. A full company is reported on the account page.
      const { data: joined, error: inviteError } = await supabase.rpc("accept_invite");
      if (inviteError) return NextResponse.redirect(new URL(`/account?error=${encodeURIComponent(inviteError.message)}`, url.origin));
      if (joined) return NextResponse.redirect(new URL(`/welcome?joined=${encodeURIComponent(String(joined))}&next=${encodeURIComponent(next)}`, url.origin));
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=link", url.origin));
}
