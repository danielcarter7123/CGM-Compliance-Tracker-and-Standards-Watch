import { redirect } from "next/navigation";
import { requireViewer } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { toWatchFunctions } from "@/lib/functions";
import { ALL_FUNCTIONS, REGIONS } from "@/lib/types";
import { finishWelcome } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };

/** First sign-in for a client user: name, registered functions and Regional Entity, so Watch and the digest
 *  are filtered from day one. Everything here can be changed later on the account page. */
export default async function WelcomePage({ searchParams }: { searchParams: { next?: string; joined?: string; error?: string } }) {
  const n = searchParams.next;
  const next = n?.startsWith("/") && !n.startsWith("//") && !n.startsWith("/welcome") ? n : "/workspace";
  const v = await requireViewer(`/welcome?next=${encodeURIComponent(next)}`);
  if (v.isStaff) redirect(next);

  // Start from the company's registered functions and region when the person hasn't chosen yet.
  const { data: co } = v.company
    ? await createClient().from("companies").select("functions, region").eq("id", v.company.id).maybeSingle()
    : { data: null };
  const fns = v.functions.length ? v.functions : toWatchFunctions((co?.functions as string[]) || []);
  const region = v.region || (co?.region as string | null) || "";
  const companyName = searchParams.joined || v.company?.name;

  return (
    <main className="wrap page" style={{ display: "grid", gap: 18 }}>
      <div>
        <h1>{companyName ? `Welcome to CGM Workspace, ${companyName}` : "Welcome to CGM Workspace"}</h1>
        <p className="lede">Two quick choices so Standards Watch and your weekly email show what applies to you. You can change them any time on your account page.</p>
      </div>
      {searchParams.error && <p className="notice">Couldn&apos;t save: {searchParams.error}</p>}
      <form className="cardbox" action={finishWelcome}>
        <input type="hidden" name="next" value={next} />
        <div className="field">
          <label htmlFor="full_name">Your name</label>
          <input id="full_name" name="full_name" type="text" autoComplete="name" defaultValue={v.fullName} />
        </div>
        <div className="field">
          <span className="lbl">Registered functions you work on</span>
          <div className="checks">
            {ALL_FUNCTIONS.map((f) => (
              <label key={f}><input type="checkbox" name="functions" value={f} defaultChecked={fns.includes(f)} /> {f}</label>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 13 }}>Most generator sites are GO and GOP. Leave all unchecked to see every standard.</span>
        </div>
        <div className="field">
          <label htmlFor="region">Regional Entity</label>
          <select id="region" name="region" defaultValue={region} className="selectbox">
            <option value="">Not sure</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" name="digest" defaultChecked={v.digestOptIn} /> Email me the weekly Standards Watch digest
        </label>
        <div><button className="btn-main" type="submit">Continue</button></div>
      </form>
    </main>
  );
}
