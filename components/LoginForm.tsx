"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

/** CGM Workspace sign-in (decision 17): Microsoft first; an emailed one-time link for anyone without
 *  Microsoft 365. No passwords anywhere. The Microsoft button works once CGM's Entra app and the Supabase
 *  Azure provider are configured (docs/SETUP.md); until then it says so instead of failing. */
export default function LoginForm({ next, microsoft }: { next: string; microsoft: boolean }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const callback = () => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function withMicrosoft() {
    setMsg("");
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "azure",
      options: { scopes: "email openid profile", redirectTo: callback() },
    });
    if (error) {
      setState("error");
      setMsg(error.message);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({ email, options: { emailRedirectTo: callback() } });
    if (error) {
      setState("error");
      setMsg(error.message);
    } else setState("sent");
  }

  if (state === "sent")
    return (
      <div className="signin-sent" role="status">
        <b>Check your inbox</b>
        <p>Check {email} for your sign-in link. It works once and expires in an hour.</p>
        <button type="button" className="signin-linkbtn" onClick={() => setState("idle")}>Use a different email</button>
      </div>
    );

  return (
    <div className="signin-methods">
      <button
        type="button"
        className="signin-ms"
        onClick={withMicrosoft}
        disabled={!microsoft}
        title={microsoft ? undefined : "Available once CGM's Microsoft sign-in is connected"}
      >
        <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
          <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
          <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
        Sign in with Microsoft
      </button>
      {!microsoft && <p className="signin-note">Microsoft sign-in opens once CGM connects it. Use your work email below for now.</p>}
      <div className="signin-or" aria-hidden="true"><span>OR</span></div>
      <form className="signin-form" onSubmit={submit}>
        <label htmlFor="email">Work email</label>
        <div className="signin-field">
          <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></svg>
          <input id="email" type="email" required autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        {state === "error" && <p className="signin-alert">Couldn&apos;t sign you in: {msg}</p>}
        <button className="signin-btn" type="submit" disabled={state === "sending"}>
          {state === "sending" ? "Sending…" : "Email me a sign-in link"} <span aria-hidden="true">→</span>
        </button>
        <p className="signin-how">No password: we email you a one-time link. Use it for accounts without Microsoft 365.</p>
      </form>
    </div>
  );
}
