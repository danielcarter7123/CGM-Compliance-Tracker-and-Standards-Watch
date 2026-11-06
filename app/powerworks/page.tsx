import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "CGM Powerworks" };

/** Placeholder for CGM Powerworks, a separate app with its own server and database (docs/SUITE.md).
 *  When it's deployed, set POWERWORKS_URL and the launcher tile links straight to it; this page then
 *  forwards there too. Powerworks is never shown inside this site (it forbids framing). */
export default async function Powerworks() {
  const v = await getViewer();
  if (!v) redirect("/login?next=/workspace");
  if (process.env.POWERWORKS_URL) redirect(process.env.POWERWORKS_URL);
  const has = v.products.powerworks;
  return (
    <main className="wrap page" style={{ display: "grid", gap: 16, maxWidth: 760 }}>
      <p><a href="/workspace">← CGM Workspace</a></p>
      <h1>CGM Powerworks is on its way</h1>
      <p className="lede">
        Asset management for generation: assets, work orders, operator rounds, compliance, inventory and purchasing. It opens as its own
        application with the same CGM account, and comes back here with &ldquo;← CGM workspace&rdquo;.
      </p>
      <p className="notice">
        {has
          ? "It's included in your plan. This tile opens CGM Powerworks as soon as it's connected."
          : "It isn't in your plan yet. Ask CGM about adding it."}{" "}
        <a href="mailto:dan@cgmconsultinggroup.com?subject=CGM%20Powerworks">Contact CGM</a>
      </p>
    </main>
  );
}
