# Open questions: ask Dan before writing any code

**Claude Code: at the start of your first session, before you write or change any code, ask Dan every question in "Ask first" below. Ask them in one message, then wait for his answers.** Record each answer under its question, with the date, and move it to "Answered". Then update anything it changes (`docs/HANDOFF.md`, `docs/ACCESS.md`, migrations, tests).

Running `npm install`, `npm run typecheck`, `npm test` and `npm run build`, and reading the docs, is fine before he answers. Writing code is not.

> **Status Nov 5, 2026:** the questions below were asked and answered. See "Answered" at the bottom. Still open: the exact evidence purge rule (confirm), pricing (W4), launch details (P1), hosting choice, and the task plans file.

## Ask first (status: answered Nov 5, 2026)

1. **What sends the live tracker's reminder emails today?**
   - The live tracker says a task's assignee gets weekday emails (reminder window, due date, every weekday while overdue). A team task's owner gets them 7 days before the anticipated date, on it, and while late.
   - Nothing in the page sends them, so it's probably a scheduled task or another tool.
   - We need to know so the app can take this over (milestone T8) and the old sender can be switched off at cutover. Otherwise people get emails from both systems.

2. **How long should evidence be kept?**
   - Evidence that someone removes in the app is only hidden, and uploaded files are never deleted automatically.
   - How long should removed evidence and app-stored files be kept before a CGM admin may purge them?
   - Do any client contracts or CIP programs set a minimum?
   - Until Dan answers, keep everything and build no purge job.

3. **Should the Sandbox Copy's task plans come across?**
   - The "CGM Master NERC Task Plans List" (step-by-step procedures) exists only in the Sandbox Copy of the tracker, not in the live one.
   - If yes, the Sandbox Copy needs the same **Export all data** button the live tracker now has. The importer already accepts `taskPlans` from that file.
   - Dan can ask Claude in claude.ai to add the button; Claude Code can't edit claude.ai artifacts.

## Still open from earlier: ask now too; each blocks only the milestone shown

4. **Pricing and packaging** (blocks W4):
   - Standards Watch prices, monthly vs annual, seats per plan, trial length;
   - is the Tracker always billed by contract;
   - is the Client Tasks add-on priced separately.
5. **One list of registered functions** (blocks T1). Watch uses GO, GOP, TO, TOP, TP, PC; the tracker uses GO, GOP, GO-2, GOP-2, TO. The suggestion is one list of all eight, with Watch treating GO-2 as GO and GOP-2 as GOP when filtering.
6. **Messages** (blocks T6): email notifications for new messages? Can client users start direct messages with their PM, or only use their company channel?
7. **Outlook** (blocks T8): keep "Add reminders to Outlook" (through Microsoft Graph), or replace it with calendar feeds?
8. **Launch details** (blocks P1):
   - Watch turnaround promise in the terms (for example, reviewed within 2 business days);
   - a second Watch reviewer;
   - brand name and domain;
   - legal review;
   - any client-required security controls.

## Answered

### Nov 5, 2026 (first Claude Code session)

1. **Reminder emails.** *Update (Nov 5):* build the reminder and notification emails, but ship them **off**. One clear admin toggle (and an env kill switch) turns them on after deployment. Dan wants reminders to land in Outlook. Nobody has confirmed what sends the live tracker's emails today, so check before cutover (T9) that the old sender is off. Plan: the app sends the reminders itself (T8). They arrive in people's Outlook inboxes like any email.
2. **Evidence retention.** Old data can cycle out after about one to two years. But some NERC tasks recur every 6, 10 or 12 years, so evidence for those must stay at least one full cycle. Proposed rule, which Dan still needs to confirm: evidence can be purged once *both* of these are true:
   - 2 years have passed since removal or task close;
   - the task's next occurrence has been completed (evidence covers at least one full interval).
   Purge is a manual CGM-admin action and is audit-logged. Until it's built, keep everything.
3. **Sandbox task plans.** Hold. Dan will provide the task plans as a separate file. Don't build T4's import until it arrives.
4. **Pricing.** Not decided; it comes later. **Launch order:** Standards Watch ships first as a standalone service. The Compliance Tracker shows as locked for Watch-only customers. W4 (Stripe) stays blocked on prices; build everything else first.
5. **Registered functions.** Use one comprehensive list, even if some functions are unused. 90% of clients are Category 1 GO/GOP, low impact. Watch filters keep their current groups, with GO-2 → GO and GOP-2 → GOP. *Built in T1:* `lib/functions.ts` holds the one list (GO, GOP, GO-2, GOP-2, TO, TOP, TP, PC) and the GO-2 → GO, GOP-2 → GOP mapping Watch uses.
6. **Messages.** Either way is fine. Decision: in-app chat. Client users can use their company channel and DM their PM. Email only for unread messages, sent as at most one daily "you have unread messages" notice, opt-out per user.
7. **Outlook calendar.** Dan has no preference. Decision: per-user calendar feeds (iCal), which Outlook can subscribe to. No Microsoft Graph calendar writes.
8. **Domain and launch.** CGM has a simple main site. Recommendation: host the app on a subdomain of the existing domain (for example `app.` or `watch.`), so the main site is untouched. The turnaround promise, second reviewer, legal review and security controls are still open (block P1 only).
9. **How Watch updates.** Keep costs low but make it reliable as a standalone app. Decision pending the hosting walkthrough (see question 10). Recommendation: an in-app weekly job reads NERC's site and drafts changes with the Claude API (pennies per run). The existing Monday task keeps posting to `/api/drafts` as a backup during the pilot. *Built Nov 5, 2026:* `lib/watch-job.ts` runs Mondays at 17:00 UTC (10 a.m. Mountain, 11 a.m. in summer; Dan moved it later because the NERC newsletter sometimes goes out around 9 a.m.). About US$1 a run. See `docs/MONDAY-TASK.md`.
10. **Hosting and database.** Dan approved Q2–9 as proposed. Hosting is a hybrid:
   - **build locally**: Supabase in Docker Desktop on Dan's PC, holding fake data and the T2a dry-run of real data;
   - **go live on the cloud**: Supabase Pro + Vercel + Resend, roughly $45–50/month;
   - deploy from GitHub.
11. **Git.** Yes. Dan has an empty GitHub repository ready.
12. **Sign-in method.** Keep the one-time email link for now: no passwords. "Sign in with Microsoft" (Azure via Supabase) can come later. It needs a CGM app registration in Microsoft Entra, which SharePoint evidence will need anyway.
13. **Look.** Dan likes the sign-in page's white and blue. Decision: one CGM white-and-blue palette across every screen (Watch, Tracker, sign-in, editor console, digest email). The pilot's orange accent and the violet editor console are retired. Editor-only screens keep a red striped "Editor only" band so they stand out (Dan is the only one who sees them). Layouts and fonts stay as in the pilots.
14. **Watch email: digest by default, alerts opt-in.** NERC already offers its own email alerts. Standards Watch's value is having everything in one place, in one reviewed weekly digest, not more email. So everyone gets the weekly digest by default. Alerts (new FERC approvals, effective dates set or moved, deadlines within 14 days) are an optional setting on the account page for anyone who really wants a note for each change. They're **off by default** (`0010_watch_alerts_opt_in.sql`; the brief removal in `0009` was superseded). Tracker reminders (T8) are a separate matter: they're about a client's own tasks.
15. **Name and structure.** The app is **CGM Compliance Tracker**, and that name goes at the top of every screen. **NERC Standards Watch is one scrollable page** in it, and the only page titled with that name. The Tracker is everything else. Dan said this during the handoff, but it was lost: "build the Watch page first" meant launch order, not that Watch was the face of the app.
   - One header and one section menu for the whole app: Standards Watch · Dashboard · Tasks · … · Activity Log.
   - Watch-only subscribers see Standards Watch and a locked Compliance Tracker.
   - The front door is the split-screen sign-in page Dan approved: signed-out visitors to the app go straight to it, with no app header around it (option B, Dan's follow-up). The NERC Standards Watch offer for prospective subscribers is at `/standards-watch`, which the "Standards Watch plans" links and Stripe's cancel link point to.
   - Signed-in Tracker users open on the Dashboard. After signing in they see Watch first, with "Continue to the Dashboard", as in the pilot.
16. **Standards Watch access and placement.**
   - **Access:** Watch is a paid product people sign in to, with the same email-link accounts as the Tracker. There is no public full page and no separate Watch site.
   - **Who sees what:** Watch-only customers sign in and land on the Watch page; the Tracker shows as one locked tab. A Watch customer who later signs a Tracker agreement keeps the same account (an admin switches the Tracker on).
   - **Prospects:** `/standards-watch` (description, sample cards, plans) and the weekly digest serve people without an account.
   - **Placement:** Watch has its own "NERC Standards Watch" button in the header (`components/WatchButton.tsx`), not a tab mixed in with the Tracker sections.
   - **Offered, not built:** a one-click "Open Standards Watch" link in the digest that signs the reader in.
17. **Three separate apps in one CGM Workspace** (Nov 6, 2026). This supersedes 15 and 16 where they differ; the contract is `docs/SUITE.md`.
   - **The apps:** CGM Standards Watch (the newsletter), CGM Compliance Tracker (tasks) and CGM Powerworks (asset management, a separate project) are three separate apps owned by CGM. A client uses them with one account and has exactly the apps their plan includes. The Tracker no longer includes Watch.
   - **After sign-in:** people land on the **CGM Workspace** launcher (Dan's demo), with Essentials, Operations or Enterprise following from the number of apps.
   - **Inside each app:** its own header, with "← CGM Workspace" on the left. No cross-app buttons.
   - **Sign-in:** one shared sign-in screen in the cinematic design (Dan's image). **Microsoft is the main path**, as the Powerworks chat advised. The fallback for clients without Microsoft 365 is the emailed one-time link, chosen instead of a password box so no passwords are stored. Dan can still ask for passwords.
   - **Powerworks:** the tile is a plain link to its own address (`POWERWORKS_URL`), never an iframe, never merged code. A "coming soon" page stands in until it's set.
   - **Client ID and name:** use the same client ID (`companies.id`) and name in every app. One place to set up clients across the Workspace and the Powerworks Control Center is decided at plug-in time.

**Client data:** the live tracker's data is essential to how the internal tracker runs. It must be carried over completely and handled under CLAUDE.md rule 7.

### Earlier

| Date | Question | Answer |
|---|---|---|
| Nov 5, 2026 | Can clients mark their own tasks performed? | Yes: mark performed, post evidence, add notes. |
| Nov 5, 2026 | Who approves performed tasks? | PMs and admins only. All CGM staff see all clients. |
| Nov 5, 2026 | Evidence storage | SharePoint linked seamlessly **and** file upload (`docs/EVIDENCE.md`). |
| Nov 5, 2026 | Which tracker's data? | The live tracker's data, carried over in full with no re-entry (`docs/IMPORT.md`). Build the Sandbox Copy's features. |
| Nov 5, 2026 | Both products in one project? | Yes: one app, access set per client's subscription (`docs/ACCESS.md`). |
