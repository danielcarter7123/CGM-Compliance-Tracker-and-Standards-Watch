import "../login.css";
import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in" };

/** The one sign-in for CGM Workspace (Dan's cinematic design). It leads to the launcher, which opens
 *  CGM Standards Watch, CGM Compliance Tracker and CGM Powerworks. */
export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const next = searchParams.next && searchParams.next.startsWith("/") && !searchParams.next.startsWith("//") ? searchParams.next : "/workspace";
  const microsoft = process.env.NEXT_PUBLIC_MICROSOFT_SIGNIN === "on";
  return (
    <main className="signin">
      <section className="signin-art" aria-label="CGM Workspace">
        <div className="signin-brand">
          <span className="signin-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cgm-logo.webp" alt="CGM Consulting Group" width={170} height={62} />
          </span>
          <span className="signin-name">
            CGM Workspace
            <small>Standards Watch · Compliance Tracker · Powerworks</small>
          </span>
        </div>
        <div className="signin-tag">
          <span className="signin-rule" aria-hidden="true" />
          <p>Built for Generation.<br />Engineered for reliability.</p>
        </div>
      </section>

      <section className="signin-card" aria-label="Sign in">
        <h1>Sign In</h1>
        <p className="signin-sub">Access your CGM Workspace account</p>
        {searchParams.error && <p className="signin-alert">That sign-in didn&apos;t work or the link has expired. Try again below.</p>}
        <LoginForm next={next} microsoft={microsoft} />
        <div className="signin-foot">
          <span>Need access? <a href="mailto:dan@cgmconsultinggroup.com?subject=Access%20to%20CGM%20Workspace">Contact CGM</a></span>
          <a href="/standards-watch">CGM Standards Watch plans</a>
        </div>
      </section>
    </main>
  );
}
