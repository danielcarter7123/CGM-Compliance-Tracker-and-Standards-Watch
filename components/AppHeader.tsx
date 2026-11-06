import AppNav from "@/components/AppNav";
import type { Viewer } from "@/lib/auth";
import { APP_NAME, initials, trackerSections, whoLine, type AppKey } from "@/lib/nav";

/** The header for one app in CGM Workspace. Each app has its own; inside an app, "← CGM Workspace" on the left
 *  goes back to the launcher. No links between apps (decision 17). */
export default function AppHeader({ app, viewer, reminders = 0, unread = 0 }: { app: AppKey; viewer: Viewer | null; reminders?: number; unread?: number }) {
  const back = app !== "workspace" && viewer;
  return (
    <header className={`mast app app-${app}`}>
      <div className="wrap toprow">
        {back && (
          <a className="backlink" href="/workspace" aria-label="Back to CGM Workspace">
            <span aria-hidden="true">←</span> CGM Workspace
          </a>
        )}
        <a className="brand" href={app === "watch" ? (viewer ? "/watch" : "/standards-watch") : app === "tracker" ? "/tracker" : viewer ? "/workspace" : "/login"}>
          <span className="logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cgm-logo.webp" alt="CGM Consulting Group" width={130} height={52} />
          </span>
          <span className="bname">
            {APP_NAME[app]}
            <small>{viewer ? whoLine(viewer) : "CGM Consulting Group"}</small>
          </span>
        </a>
        <nav className="sitenav" aria-label="Account and tools">
          {app === "watch" && viewer?.isEditor && <a className="admin" href="/watch/review">Review queue</a>}
          {app === "watch" && viewer?.isEditor && <a className="admin" href="/watch/digest">Digest</a>}
          {app === "workspace" && viewer?.staffRole === "admin" && <a className="admin" href="/admin">Admin</a>}
          {viewer ? (
            <a className="acct" href="/account" title={viewer.email || "Account"}>
              <span className="avatar" aria-hidden="true">{initials(viewer)}</span> Account
            </a>
          ) : (
            <a href="/login">Sign in</a>
          )}
          {app === "watch" && !viewer && <a className="cta" href="/standards-watch#plans">Plans</a>}
        </nav>
      </div>
      {app === "tracker" && viewer && (
        <div className="wrap navrow">
          <AppNav sections={trackerSections(viewer, unread)} />
          <span className="navtools">
            <a className={`remindbtn${reminders ? " has" : ""}`} href="/tracker/tasks?status=window" title="Overdue tasks and tasks inside their reminder window">
              Reminders <span className="count">{reminders}</span>
            </a>
            {viewer.isStaff && <a className="btn-main sm" href="/tracker/tasks?t=new">New task</a>}
          </span>
        </div>
      )}
    </header>
  );
}

export function AppFooter({ app }: { app: AppKey }) {
  return (
    <footer className="foot">
      <div className="wrap">
        <p>{app === "workspace" ? "CGM Workspace · Built for Generation. Engineered for reliability." : `${APP_NAME[app]} · part of CGM Workspace`} · © CGM Consulting Group</p>
      </div>
    </footer>
  );
}
