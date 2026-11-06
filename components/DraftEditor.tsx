"use client";

import { useMemo, useState } from "react";
import { FIELDS, draftProblems, tidyDraftValue, type Field } from "@/lib/draft-fields";
import { ALL_FUNCTIONS, TOPICS, type DraftSection } from "@/lib/types";

type V = Record<string, unknown>;
type Row = Record<string, string>;

/** "Edit first": a form for each draft section with the pilot's fields, checked as you type.
 *  Reports the tidied value and its problems to the parent, which only allows approving when there are none. */
export default function DraftEditor({
  section, initial, sources, onChange,
}: {
  section: DraftSection;
  initial: V;
  sources: Record<string, string>;
  onChange: (value: V, problems: string[]) => void;
}) {
  const [v, setV] = useState<V>(() => ({ ...initial }));
  const keys = useMemo(() => Object.keys(sources), [sources]);
  const problems = draftProblems(section, tidyDraftValue(section, v), keys);

  const set = (k: string, x: unknown) => {
    const next = { ...v, [k]: x };
    setV(next);
    const tidy = tidyDraftValue(section, next);
    onChange(tidy, draftProblems(section, tidy, keys));
  };
  const id = (k: string) => `ed-${section}-${k}`;

  const input = (f: Field) => {
    const x = v[f.k];
    switch (f.kind) {
      case "long":
        return <textarea id={id(f.k)} value={String(x ?? "")} onChange={(e) => set(f.k, e.target.value)} rows={3} />;
      case "date":
        return <input id={id(f.k)} type="date" value={String(x ?? "")} onChange={(e) => set(f.k, e.target.value)} />;
      case "functions":
        return (
          <div className="edchecks" role="group" aria-label={f.label}>
            {ALL_FUNCTIONS.map((fn) => {
              const list = Array.isArray(x) ? (x as string[]) : [];
              return (
                <label key={fn}>
                  <input type="checkbox" checked={list.includes(fn)} onChange={(e) => set(f.k, e.target.checked ? [...list, fn] : list.filter((y) => y !== fn))} /> {fn}
                </label>
              );
            })}
          </div>
        );
      case "topic":
        return (
          <select id={id(f.k)} value={String(x ?? "")} onChange={(e) => set(f.k, e.target.value)}>
            <option value="">Choose…</option>
            {Object.entries(TOPICS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        );
      case "phase":
        return (
          <select id={id(f.k)} value={x === "dev" ? "dev" : ""} onChange={(e) => set(f.k, e.target.value)}>
            <option value="">Approved (has an effective date)</option>
            <option value="dev">In development</option>
          </select>
        );
      case "src-select":
        return (
          <select id={id(f.k)} value={String(x ?? "")} onChange={(e) => set(f.k, e.target.value)}>
            <option value="">Choose…</option>
            <option value="FERC">FERC</option>
            <option value="NERC">NERC</option>
          </select>
        );
      case "bool":
        return <input id={id(f.k)} type="checkbox" checked={!!x} onChange={(e) => set(f.k, e.target.checked)} />;
      case "source-keys": {
        const list = Array.isArray(x) ? (x as string[]) : [];
        return (
          <>
            <input
              id={id(f.k)}
              type="text"
              defaultValue={list.join(", ")}
              onChange={(e) => set(f.k, e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
              list={`${id(f.k)}-keys`}
            />
            <datalist id={`${id(f.k)}-keys`}>{keys.map((k) => <option key={k} value={k}>{sources[k]}</option>)}</datalist>
            {list.length > 0 && <span className="edhint">{list.map((k) => sources[k] || `${k} (unknown)`).join(" · ")}</span>}
          </>
        );
      }
      case "dated":
      case "week-items": {
        const sub = f.kind === "week-items" ? "t" : (f.sub as string);
        const first = f.kind === "week-items" ? "b" : "d";
        const rows = (Array.isArray(x) ? x : []) as Row[];
        const put = (i: number, k: string, val: string) => set(f.k, rows.map((r, j) => (j === i ? { ...r, [k]: val } : r)));
        return (
          <div className="edrows" role="group" aria-label={f.label}>
            {rows.map((r, i) => (
              <div className="edrow" key={i}>
                {f.kind === "week-items" ? (
                  <input type="text" aria-label={`${f.label} ${i + 1} bold lead-in`} placeholder="Bold lead-in (optional)" value={r.b ?? ""} onChange={(e) => put(i, "b", e.target.value)} />
                ) : (
                  <input type="date" aria-label={`${f.label} ${i + 1} date`} value={r.d ?? ""} onChange={(e) => put(i, "d", e.target.value)} />
                )}
                <input type="text" aria-label={`${f.label} ${i + 1} text`} value={r[sub] ?? ""} onChange={(e) => put(i, sub, e.target.value)} />
                <button type="button" className="btn" aria-label={`Remove ${f.label} row ${i + 1}`} onClick={() => set(f.k, rows.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
            <button type="button" className="btn" onClick={() => set(f.k, [...rows, { [first]: "", [sub]: "" }])}>Add a row</button>
          </div>
        );
      }
      default:
        return <input id={id(f.k)} type={f.kind === "url" ? "url" : "text"} value={String(x ?? "")} onChange={(e) => set(f.k, e.target.value)} />;
    }
  };

  return (
    <div className="edform">
      <div className="formgrid">
        {FIELDS[section].map((f) => {
          const wide = ["long", "functions", "dated", "week-items", "source-keys"].includes(f.kind);
          const grouped = ["functions", "dated", "week-items"].includes(f.kind);
          return (
            <div className="field" key={f.k} style={wide ? { gridColumn: "1 / -1" } : undefined}>
              {grouped ? <span className="lbl">{f.label}{f.required ? " *" : ""}</span> : <label htmlFor={id(f.k)}>{f.label}{f.required ? " *" : ""}</label>}
              {input(f)}
              {f.hint && <span className="edhint">{f.hint}</span>}
            </div>
          );
        })}
      </div>
      {problems.length > 0 && (
        <ul className="edproblems" role="status" aria-label="Fix before approving">
          {problems.map((p) => <li key={p}>{p}</li>)}
        </ul>
      )}
    </div>
  );
}
