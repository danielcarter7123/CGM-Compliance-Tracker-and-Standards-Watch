"use client";

import { useRef, useState, useTransition } from "react";
import { EVIDENCE_MAX_BYTES, EVIDENCE_TYPES, allowedType, evidencePath, formatBytes } from "@/lib/evidence";
import { createClient } from "@/lib/supabase/browser";

/** Upload a file as evidence. The browser puts it straight into the client's folder of the private "evidence"
 *  bucket with the person's own session (the storage rules allow only their client's folder), then the server
 *  records it on the task. Files are never overwritten. */
export default function EvidenceUpload({
  action, company, target, back, cip,
}: {
  action: (fd: FormData) => void;
  company: string;
  target: { task?: string; ctask?: string };
  back: string;
  cip: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [noBcsi, setNoBcsi] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  const pick = (f: File | null) => {
    setMsg("");
    if (f && !allowedType(f.name)) { setMsg("That type of file isn't accepted."); setFile(null); return; }
    if (f && f.size > EVIDENCE_MAX_BYTES) { setMsg(`That file is ${formatBytes(f.size)}; files can be up to 50 MB.`); setFile(null); return; }
    if (f && f.size === 0) { setMsg("That file is empty."); setFile(null); return; }
    setFile(f);
  };

  const upload = async () => {
    if (!file || busy) return;
    setBusy(true);
    setMsg("Uploading…");
    try {
      const buf = await file.arrayBuffer();
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf))).map((b) => b.toString(16).padStart(2, "0")).join("");
      const path = evidencePath(company, target, crypto.randomUUID(), file.name);
      const { error } = await createClient().storage.from("evidence").upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
      if (error) { setMsg(`The upload failed: ${error.message}`); setBusy(false); return; }
      const fd = new FormData();
      if (target.task) fd.set("task_id", target.task); else fd.set("client_task_id", target.ctask || "");
      fd.set("path", path);
      fd.set("file_name", file.name);
      fd.set("size_bytes", String(file.size));
      fd.set("mime_type", file.type);
      fd.set("sha256", sha);
      fd.set("back", back);
      if (noBcsi) fd.set("no_bcsi", "on");
      start(() => action(fd));
    } catch (e) {
      setMsg(`The upload failed: ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <div className="ev-upload">
      <label htmlFor="ev_file">Upload a file</label>
      <input
        id="ev_file" ref={input} type="file" aria-describedby="ev_file_h"
        accept={EVIDENCE_TYPES.map((t) => `.${t}`).join(",")}
        onChange={(e) => pick(e.target.files?.[0] || null)}
      />
      <span id="ev_file_h" className="muted small">PDF, Office, images, email, text or ZIP; up to 50 MB. Stored privately for this client; opened through a link that lasts a minute.</span>
      {cip && (
        <label className="checkline small">
          <input type="checkbox" checked={noBcsi} onChange={(e) => setNoBcsi(e.target.checked)} />
          This file contains no BES Cyber System Information. (CIP evidence that does belongs in CGM&apos;s SharePoint: paste its link instead.)
        </label>
      )}
      <div className="toolbar">
        <button type="button" className="btn-main sm" disabled={!file || busy || (cip && !noBcsi)} onClick={upload}>
          {busy ? "Uploading…" : "Upload"}
        </button>
        {file && !busy && <span className="small">{file.name} · {formatBytes(file.size)}</span>}
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
