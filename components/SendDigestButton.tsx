"use client";

import { useState, useTransition } from "react";
import { sendDigest } from "@/app/admin/digest/actions";

export default function SendDigestButton() {
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      {msg && <span role="status">{msg}</span>}
      <button
        className="btn primary"
        disabled={pending}
        onClick={() => {
          if (!armed) return setArmed(true);
          start(async () => {
            const r = await sendDigest();
            setArmed(false);
            setMsg(r.ok ? `Sent to ${r.sent} subscriber${r.sent === 1 ? "" : "s"}.` : `Not sent: ${r.error}`);
          });
        }}
      >
        {pending ? "Sending…" : armed ? "Click again to send to all subscribers" : "Send this week's digest"}
      </button>
    </span>
  );
}
