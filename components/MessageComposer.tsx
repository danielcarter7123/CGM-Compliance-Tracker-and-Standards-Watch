"use client";

import { useEffect, useRef, useState } from "react";

/** The message box (TRACKER-SPEC §3.10): Enter sends, Shift+Enter adds a line, 4,000 characters, a draft kept per
 *  conversation on this device, and an optional linked task shown as a chip. */
export default function MessageComposer({
  action, target, draftKey, tasks, task,
}: {
  action: (fd: FormData) => void;
  target: Record<string, string>;
  draftKey: string;
  tasks: { id: string; title: string }[];
  task?: { id: string; title: string } | null;
}) {
  // The box itself holds the text (so anything typed before the page finishes loading isn't lost).
  const [body, setBody] = useState("");
  const [taskId, setTaskId] = useState(task?.id || "");
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const key = `cgm-draft:${draftKey}`;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    if (!el.value) { try { el.value = localStorage.getItem(key) || ""; } catch {} }
    setBody(el.value);
  }, [key]);
  const change = (v: string) => {
    setBody(v);
    try { v ? localStorage.setItem(key, v) : localStorage.removeItem(key); } catch {}
  };
  const options = task && !tasks.some((t) => t.id === task.id) ? [task, ...tasks] : tasks;

  return (
    <form
      ref={form}
      action={action}
      className="composer"
      onSubmit={() => { try { localStorage.removeItem(key); } catch {} }}
    >
      {Object.entries(target).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {options.length > 0 && (
        <div className="composer-task">
          <label htmlFor="task_id">Link task</label>
          <select id="task_id" name="task_id" value={taskId} onChange={(e) => setTaskId(e.target.value)}>
            <option value="">None</option>
            {options.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
          </select>
        </div>
      )}
      <label className="sr" htmlFor="body">Message</label>
      <textarea
        id="body"
        name="body"
        ref={box}
        defaultValue=""
        maxLength={4000}
        rows={3}
        placeholder="Write a message. Enter sends; Shift+Enter adds a new line."
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            if (e.currentTarget.value.trim()) form.current?.requestSubmit();
          }
        }}
      />
      <div className="composer-f">
        <span className="muted small">{body.length > 3500 ? `${4000 - body.length} characters left` : ""}</span>
        <button className="btn-main sm" type="submit" disabled={!body.trim()}>Send</button>
      </div>
    </form>
  );
}
