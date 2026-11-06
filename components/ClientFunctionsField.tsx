"use client";

import { useState } from "react";
import { MAPPED_ENTITIES, REGISTERED_FUNCTIONS, entitiesFor } from "@/lib/functions";

/** Registered functions, and the NERC entities this client coordinates with under them. The entity rows follow
 *  the checked functions, as in the pilot; values for hidden rows are kept so unticking a function loses nothing. */
export default function ClientFunctionsField({
  functions, entities, disabled,
}: {
  functions: string[];
  entities: Record<string, string>;
  disabled: boolean;
}) {
  const [fns, setFns] = useState<string[]>(functions);
  const shown = new Set(entitiesFor(fns).map((e) => e.k));
  return (
    <>
      <div className="field">
        <span className="lbl">Registered functions</span>
        <div className="checks">
          {REGISTERED_FUNCTIONS.map((f) => (
            <label key={f}>
              <input
                type="checkbox"
                name="functions"
                value={f}
                checked={fns.includes(f)}
                disabled={disabled}
                onChange={(e) => setFns(e.target.checked ? [...fns, f] : fns.filter((x) => x !== f))}
              />{" "}
              {f}
            </label>
          ))}
        </div>
      </div>
      <div className="field">
        <span className="lbl">Functionally mapped NERC entities</span>
        {shown.size ? (
          <div className="entrows">
            {MAPPED_ENTITIES.map((e) => (
              <div key={e.k} className="entrow" hidden={!shown.has(e.k)}>
                <label htmlFor={`ent_${e.k}`}>
                  {e.label} <span className="chip">{e.ab}</span>
                  <span className="muted mono small">{e.why}</span>
                </label>
                <input id={`ent_${e.k}`} name={`ent_${e.k}`} type="text" defaultValue={entities[e.k] || ""} placeholder="Entity name / NCR ID" disabled={disabled} />
              </div>
            ))}
            <span className="muted small">The entities this client coordinates with under its registered functions. The list follows the functions checked above.</span>
          </div>
        ) : (
          <>
            {MAPPED_ENTITIES.map((e) => <input key={e.k} type="hidden" name={`ent_${e.k}`} value={entities[e.k] || ""} />)}
            <span className="muted small">Check a registered function to see the entities it maps to.</span>
          </>
        )}
      </div>
    </>
  );
}
