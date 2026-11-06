import "../login.css";
import LoginForm from "@/components/LoginForm";

export const metadata = { title: "Sign in" };

const FEATURES = [
  {
    label: "NERC Standards Watch: reviewed changes for your functions",
    icon: <path d="M3 6h14M3 12h9M3 18h7m4-1.5 2.5 2.5 5-5" />,
  },
  {
    label: "Recurring tasks, reminders and approvals",
    icon: (
      <>
        <rect x="5" y="4" width="14" height="17" rx="2" />
        <path d="M9 3h6v3H9zM9 11l2 2 4-4M9 17h6" />
      </>
    ),
  },
  {
    label: "Evidence and a full audit trail",
    icon: <path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6l8-3zm-3.5 9 2.5 2.5 4.5-5" />,
  },
];

export default function LoginPage({ searchParams }: { searchParams: { next?: string; error?: string } }) {
  const next = searchParams.next && searchParams.next.startsWith("/") ? searchParams.next : "/watch";
  return (
    <main className="signin">
      <section className="signin-art" aria-label="CGM Compliance Tracker">
        <a className="signin-logo" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/cgm-logo.webp" alt="CGM Consulting Group: NERC Compliance, Grid Reliability" width={200} height={72} />
        </a>
        <div className="signin-pitch">
          <div className="signin-product">CGM Compliance Tracker</div>
          <h1>Confidence in every requirement.</h1>
          <p>NERC compliance for Generator Owners and Operators, run with CGM Consulting Group.</p>
          <ul>
            {FEATURES.map((f) => (
              <li key={f.label}>
                <svg viewBox="0 0 24 24" aria-hidden="true">{f.icon}</svg>
                {f.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="signin-panel">
        <div className="signin-box">
          <h2>Welcome back</h2>
          <p className="signin-sub">Sign in to CGM Compliance Tracker.</p>
          {searchParams.error && <p className="signin-alert">That sign-in link didn&apos;t work or has expired. Request a new one below.</p>}
          <LoginForm next={next} />
          <p className="signin-how">
            We email you a one-time sign-in link, so there&apos;s no password to remember or reset.
          </p>
          <div className="signin-foot">
            <span>
              Need access? <a href="mailto:dan@cgmconsultinggroup.com?subject=Access%20to%20the%20CGM%20Compliance%20Platform">Contact CGM</a>
            </span>
            <a href="/#plans">See Standards Watch plans</a>
          </div>
        </div>
      </section>
    </main>
  );
}
