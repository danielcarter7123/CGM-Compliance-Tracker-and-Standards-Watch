import type { Metadata } from "next";
import "./watch.css";
import "./app.css";
import { getViewer } from "@/lib/auth";

export const metadata: Metadata = {
  title: "NERC Standards Watch | CGM Consulting Group",
  description: "Reviewed, function-filtered updates on new and changing NERC Reliability Standards for generation and transmission entities.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer().catch(() => null);
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <header className="mast">
          <div className="wrap">
            <a className="brand" href="/" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/cgm-logo.webp" alt="CGM Consulting Group" width={130} height={52} />
              </span>
              <div className="bname">
                NERC Standards Watch<small>Standards changes for generation &amp; transmission</small>
              </div>
            </a>
            <nav className="sitenav" aria-label="Site">
              {viewer?.hasAccess && <a href="/watch">Watch</a>}
              {viewer?.isEditor && <a className="admin" href="/admin/review">Review queue</a>}
              {viewer?.isEditor && <a className="admin" href="/admin/digest">Digest</a>}
              {viewer ? <a href="/account">Account</a> : <a href="/login">Sign in</a>}
              {!viewer?.hasAccess && <a className="cta" href="/#plans">Subscribe</a>}
            </nav>
          </div>
        </header>
        {children}
        <footer className="foot">
          <div className="wrap">
            <p>
              Standards Watch summarizes publicly available NERC and FERC information for awareness only and is not a compliance determination.
              Confirm applicability and dates against the approved standard, its implementation plan, and your Regional Entity. U.S. effective dates shown.
            </p>
            <p>© CGM Consulting Group</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
