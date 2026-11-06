import type { Metadata } from "next";
import "./watch.css";
import "./app.css";
import AppNav from "@/components/AppNav";
import SiteChrome from "@/components/SiteChrome";
import { appSections, whoLine } from "@/lib/nav";
import { getViewer } from "@/lib/auth";

export const metadata: Metadata = {
  title: { default: "CGM Compliance Tracker", template: "%s | CGM Compliance Tracker" },
  description: "NERC compliance programs for generation and transmission entities, run with CGM Consulting Group, with NERC Standards Watch.",
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
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Public+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Sans+Condensed:wght@500;600;700&display=swap"
        />
      </head>
      <body>
        <SiteChrome>
        <header className="mast app">
          <div className="wrap">
            <a className="brand" href="/" style={{ textDecoration: "none", color: "inherit" }}>
              <span className="logo">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/cgm-logo.webp" alt="CGM Consulting Group" width={130} height={52} />
              </span>
              <div className="bname">
                CGM Compliance Tracker<small>{viewer ? whoLine(viewer) : "CGM Consulting Group"}</small>
              </div>
            </a>
            <nav className="sitenav" aria-label="Account and tools">
              {viewer?.isEditor && <a className="admin" href="/admin/review">Review queue</a>}
              {viewer?.isEditor && <a className="admin" href="/admin/digest">Digest</a>}
              {viewer?.staffRole === "admin" && <a className="admin" href="/admin">Admin</a>}
              {viewer ? <a href="/account">Account</a> : <a href="/login">Sign in</a>}
              {!viewer?.hasAccess && <a className="cta" href="/#plans">Standards Watch plans</a>}
            </nav>
          </div>
          {viewer && (
            <div className="wrap navrow">
              <AppNav sections={appSections(viewer)} />
            </div>
          )}
        </header>
        </SiteChrome>
        {children}
        <SiteChrome>
        <footer className="foot">
          <div className="wrap">
            <p>CGM Compliance Tracker · © CGM Consulting Group</p>
          </div>
        </footer>
        </SiteChrome>
      </body>
    </html>
  );
}
