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
    return <p className="notice ok">Check {email} for your sign-in link. It works once and expires in an hour.</p>;

  return (
    <form className="cardbox" onSubmit={submit}>
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {state === "error" && <p className="notice">Couldn&apos;t send the link: {msg}</p>}
      <div><button className="btn-main" type="submit" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Email me a sign-in link"}</button></div>
    </form>
  );
}
