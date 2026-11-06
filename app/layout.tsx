import type { Metadata } from "next";
import "./watch.css";
import "./app.css";

export const metadata: Metadata = {
  title: { default: "CGM Workspace", template: "%s | CGM Workspace" },
  description: "CGM Workspace: CGM Standards Watch, CGM Compliance Tracker and CGM Powerworks for generation and transmission entities, from CGM Consulting Group.",
};

/** The page shell only. CGM Workspace is three separate apps; each area's layout adds its own header
 *  (components/AppHeader.tsx). The sign-in page has none. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
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
      <body>{children}</body>
    </html>
  );
}
