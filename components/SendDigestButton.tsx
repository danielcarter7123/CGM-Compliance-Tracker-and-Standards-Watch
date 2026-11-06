"use client";

import { useState, useTransition } from "react";
import { previewDigest, sendDigest } from "@/app/admin/digest/actions";

/** Corrections box, live preview (HTML and plain text) and the two-click send. */
export default function DigestComposer({
  functions, suggestions, initialHtml, initialText,
}: {
  functions: string[];
  suggestions: string[];
  initialHtml: string;
  initialText: string;
}) {
  const [corr, setCorr] = useState(suggestions.join("\n"));
  const [html, setHtml] = useState(initialHtml);
  const [text, setText] = useState(initialText);
  const [stale, setStale] = useState(false);
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const lines = () => corr.split("\n").map((l) => l.trim()).filter(Boolean);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="field">
        <label htmlFor="corrections">Corrections to earlier digests (one per line, optional)</label>
        <textarea
          id="corrections"
          value={corr}
          onChange={(e) => { setCorr(e.target.value); setStale(true); setArmed(false); }}
          placeholder="Leave empty when nothing needs correcting."
        />
        <span className="edhint">
          {suggestions.length
            ? "Suggested from dates you changed and entries you removed since the last digest. Edit or delete them before sending."
            : "Nothing published since the last digest changed a date subscribers already saw."}
        </span>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn"
          disabled={pending || !stale}
          onClick={() => start(async () => { const r = await previewDigest(functions, lines()); setHtml(r.html); setText(r.text); setStale(false); })}
        >
          Update preview
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={pending || stale}
          title={stale ? "Update the preview first, so you send what you saw" : undefined}
          onClick={() => {
            if (!armed) return setArmed(true);
            start(async () => {
              const r = await sendDigest(lines());
              setArmed(false);
              setMsg(r.ok ? `Sent to ${r.sent} subscriber${r.sent === 1 ? "" : "s"}.` : `Not sent: ${r.error}`);
            });
          }}
        >
          {pending ? "Working…" : armed ? "Click again to send to all subscribers" : "Send this week's digest"}
        </button>
        {msg && <span role="status">{msg}</span>}
      </div>
      <div className="preview"><iframe title="Digest preview" srcDoc={html} sandbox="" /></div>
      <details>
        <summary className="dnote">Plain-text version (sent alongside the HTML)</summary>
        <pre className="plaintext">{text}</pre>
      </details>
    </div>
  );
}
