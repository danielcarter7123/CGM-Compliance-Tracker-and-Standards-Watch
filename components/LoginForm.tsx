"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
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
    <form className="signin-form" onSubmit={submit}>
      <label htmlFor="email">Work email</label>
      <input
        id="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {state === "error" && <p className="signin-alert">Couldn&apos;t send the link: {msg}</p>}
      <button className="signin-btn" type="submit" disabled={state === "sending"}>
        {state === "sending" ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
