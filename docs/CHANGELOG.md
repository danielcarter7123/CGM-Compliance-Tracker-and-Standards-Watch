# Changelog

What changed in the handoff, newest first. Claude Code: read this after `CLAUDE.md` so you know what is new and what was decided. Add an entry here whenever you finish a milestone.

## Nov 6, 2026: Client Tasks screen (Claude Code)

`/tracker/client-tasks` (TRACKER-SPEC §3.7, "Client Tasks"): the add-on's own task list for a client's work outside NERC compliance.
- **Who:** CGM staff (every add-on client; a "Client Tasks" tab next to Tasks rather than the pilot's Clients sub-tab) and client users whose company has the add-on (their own list, which they can add to, edit, complete and delete, as the database already allowed). Others get no tab, a redirect, a refused export and nothing by API.
- **Add-on clients** are companies with both the Tracker and Client Tasks live. CGM admins can "Turn on Client Tasks" for a Tracker client from this screen (the same switch as Clients › Applications); PMs are pointed to an admin.
- **Stat strip:** overdue, due within 30 days, open, completed this month (for the chosen client or all).
- **Filters:** client (staff), status (all open, overdue, due ≤ 30 days, each status, all), category, responsible party, search.
- **Columns:** due, task (2-line description), client (staff), category, assigned to with responsible party, priority (high in red), repeats, status.
- **Drawer:** task, client (staff), category (pick or type), description, assigned to, responsible party, due date, priority, status, date completed (never in the future; today if empty), repeats every N months/years/days with a preview of the next due date, links (https), notes; Discuss, Mark complete, Delete with a confirming tick.
- **Repeats** always follow the due date and need one; the database schedules the next one when a task is completed (`spawn_next_client_task`). No review step.
- **Separate:** client tasks don't appear on the dashboard, in reminders or in digests.
- **Discuss** opens the client's channel with the client task linked; its chip opens it in Client Tasks.
- **Export CSV** in the pilot's columns (`client-tasks-<date>.csv`).
- **Tests:** lib (states, filters, stats, repeats, CSV); `e2e/tracker-ctasks.spec.ts` (a client creates one, completion schedules the next from the due date, Discuss chip, export, CGM sees it, a client without the add-on is refused everywhere); access cases.

## Nov 6, 2026: T7 Activity Log (Claude Code)

`/tracker/activity` (TRACKER-SPEC §3.11). CGM staff see everything; a client user sees their own company's task, client-task and evidence history (the existing read policy).
- **Filters:** date range (24 hours to all time; 30 days by default), person (staff, including pilot authors not yet signed up), record type, client (staff), search over record names and notes. 200 rows, then "Show more".
- **Rows:** when, who (avatar and name), action tag, record type and name, client, details: the pilot's note and field changes with old values struck through (bookkeeping fields hidden, people and clients by name), plus RESTORED / REVERTED tags.
- **Restore** (staff): re-inserts a deleted record from its log entry. Restoring a client also brings back what was deleted with it in the same moment (products, contacts, tasks, client tasks, evidence) and re-attaches its team tasks; task chains are re-linked. Messages in a deleted client's channel are not brought back.
- **Revert** (staff): writes a change's old values back, only the fields that change touched. If the record changed since, it asks "Revert anyway? Edited since <date>" and changes nothing until confirmed.
- **Append-only:** both are database functions (`restore_entry`, `revert_entry`, migration `0014_activity_restore.sql`) that run as the signed-in person, so each record's own write rules still apply (for example, restoring a client needs a CGM admin because products are admin-only). Their writes are logged by the ordinary triggers as "restored" / "reverted" with `ref_id` pointing at the entry acted on. Each entry can be restored or reverted once. Contacts are now logged too.
- **Pilot history** carried over by the import is shown as recorded, with its notes and field changes; restore and revert apply to changes made in this app.
- **Export CSV:** one row per field change, with the filters (`cgm-activity-log-<date>.csv`).
- **Not logged:** messages (as in the pilot), and CSV exports (the pilot logged them; the log is trigger-only here).
- **Tests:** RLS (restoring a deleted client with its chain, products, contacts and team tasks; all-or-nothing when a PM lacks rights; once only; revert with "edited since"; staff only; log still append-only); lib (change rendering, pilot field names, CSV); `e2e/tracker-t7.spec.ts`.

## Nov 6, 2026: T6 Team Tasks (Claude Code)

CGM's internal work (TRACKER-SPEC §3.5), at `/tracker/team`; CGM staff only (the screen, the CSV export, and the database's existing "team staff" policy).
- **Stat strip:** my open tasks with estimated hours, past anticipated date, team open tasks with hours, completed this month. Each opens the matching filter.
- **Filters:** Assigned to me or collaborating (default) / Assigned to me / Everyone / Unassigned; All open / Past anticipated date / each status / All statuses; client (or Internal); search across title, description, links, client and people.
- **Table:** task with up to 3 links and a 2-line description, client ("Internal" or "(removed client)"), assigned to, collaborators, hours, anticipated and actual dates, status with "· late". A footer sums the hours.
- **Drawer:** task, description, links (https only, "Label | URL" per line), client, assigned to (or "Assign to me"), collaborators (no notification), anticipated and actual completion (actual never in the future; set to today when marked complete), estimated hours in 0.25 steps, status, created on/by; Mark complete; Delete with a confirming tick. Imported owners who haven't signed up show by email.
- **Export CSV** (`cgm-team-tasks-<date>.csv`) in the pilot's columns, following the filters.
- **Tests:** `lib/team.ts` unit test (filters, stats, links, CSV); `e2e/tracker-team.spec.ts` (add, refused http link, late, export, future date refused, complete, delete; a client user gets no tab, a redirect, a 403 export and an empty table by API); access cases for `/tracker/team` and `/tracker/messages`.
- **T6 is complete.**

## Nov 6, 2026: T6 Messages (Claude Code)

Built as decided (OPEN-QUESTIONS 6): in-app chat; client users use their company channel and can direct-message their CGM project manager. The daily "you have unread messages" email comes with T8 (opt-out per person); nothing emails today.
- **Messages screen** (`/tracker/messages`):
  - CGM staff see team channels (General, plus channels they add), direct messages (start one with anyone) and one channel per Tracker client;
  - a client user sees their company's channel and "Message <PM> (your CGM project manager)";
  - messages are grouped by day with names (rpc `people_names`), https links are clickable, and a linked task shows as a chip that opens the task;
  - authors can delete their own messages, which then show as "Message deleted"; nobody can edit one;
  - Enter sends, Shift+Enter adds a line, 4,000 characters, a draft kept per conversation on the device;
  - new messages appear live (Supabase Realtime, which applies row level security).
- **Unread:** a count on the Messages tab and a dot per conversation, from `chats.last_at`/`last_by` against your own `chat_reads`.
- **Discuss** on a task opens the client's channel with that task linked.
- **Migration `0013_messages.sql`:** DMs only with your own PM (clients); one DM per pair; conversation activity set by trigger only; messages can't be edited or moved, only soft-deleted by their author; `people_names()`; General channel; realtime publication.
- **Tests:** RLS cases for all of the above; `e2e/tracker-t6.spec.ts` covers Discuss, the task chip, links, delete, the PM DM, the database refusing other DMs and another company's channel, another company seeing nothing, and the PM's unread count.

## Nov 6, 2026: close-out with a verified performed date (Claude Code)

**Decided by Dan** (OPEN-QUESTIONS 18): clients close tasks out when the report arrives, but the date recorded must be the date the work was performed.
- **"Close out task"** (`components/CloseOutForm.tsx`):
  - "Date the work was performed" starts at today, can be backdated, and is never future;
  - a confirmation tick is required, and the server checks it too;
  - a live line shows "Performed on <date> (backdated)" and when the next occurrence will be due;
  - the button stays disabled until confirmed.
- **PM correction:** the staff form shows "Date the work was performed" on performed or complete tasks. If the task repeats from completion, changing it moves the still-open next occurrence, computed with SQL `next_due` through RPC.
- **Tests:**
  - RLS: a client's backdated date is kept, a completion-based next occurrence counts from it, and the client can't change it afterwards;
  - e2e: the button is disabled until confirmed, the backdated preview, the saved date and next due, and the PM correction moving the next occurrence;
  - the T2 and T5 tests use the new steps.

## Nov 6, 2026: T5 client view (Claude Code)

**Isolation, proven end to end** (`e2e/tracker-t5.spec.ts`): a Demo Wind Farm (fake) user tries to reach Sample Peaker (fake).
- **By address:** the other company's task link, the Tasks filter, the CSV export and its client record all come up empty or redirect.
- **By calling the API directly** with their own token: reading the other company's tasks or companies returns nothing, editing them changes nothing, and inserting a task is refused.
- **Their own due date:** changing it is refused with the database's message.
- The other company's data is confirmed unchanged afterwards.

**Client task view:**
- clients see a note that CGM sets the due date, repeat schedule and assignee, and to ask their project manager;
- clients can mark their own tasks performed with an evidence link (checked in the browser test);
- there is no due-date field.

**People** (Clients › client details): every CGM staff member sees who has a login at the client and the open invites. CGM admins and PMs can invite (member or company admin), revoke and remove, with seats enforced by the database. The invite email (`lib/invites.ts`, shared with company admins' invites) now mentions Sign in with Microsoft.

**Tests:**
- RLS: PMs invite into any client; client admins only their own; clients can't change due date, repeats or assignee directly, but can mark performed; another company can't see or touch the task (33 RLS tests).
- e2e: the isolation journey above; CGM invites a user, who joins that company and sees only its apps; removal.

**Already in place from earlier milestones:**
- client Dashboard and Tasks limited to their company (T2, T3);
- company admins invite colleagues (W2);
- Client Tasks, Messages and the Activity Log are still to come (T6, T7).

## Nov 6, 2026: CGM Workspace: three separate apps (Claude Code)

**Decided by Dan** (OPEN-QUESTIONS 17, contract in `docs/SUITE.md`): CGM Standards Watch, CGM Compliance Tracker and CGM Powerworks are separate apps on one CGM account. Clients get exactly the apps their plan includes. This supersedes decisions 15 and 16 where they differ.

**Sign-in** (`/login`): Dan's cinematic design, with the full-bleed plant at dusk and a dark glass card.
- **Microsoft first:** "Sign in with Microsoft" (Supabase Azure provider). The button is active once `NEXT_PUBLIC_MICROSOFT_SIGNIN=on`; the setup steps are in `docs/SETUP.md`.
- **Email-link fallback** for people without Microsoft 365. There are no passwords.

**Launcher** (`/workspace`, from Dan's demo):
- banner, organization box, "Your applications" with the plan badge (Essentials, Operations or Enterprise by number of apps);
- three cards, each "Open application" or "Explore access";
- everyone lands here after signing in, and locked addresses come back here.

**Each app is separate:**
- Standards Watch (`/watch`; editor screens moved to `/watch/review`, `/watch/review/log`, `/watch/digest`) and Compliance Tracker (`/tracker`) each have their own header, title and footer, with "← CGM Workspace" on the left.
- There are no links between apps. The Watch button and the Watch page's "Continue to the Dashboard" bar are gone.
- Account and Admin are Workspace pages.

**Products** (`0012_separate_apps.sql`):
- **New product:** `powerworks`.
- **Tracker separate from Watch:** the Tracker no longer includes Watch, in `company_has()` and `productsFrom()`. A unit test compares the two on all 16 product combinations.
- **No one lost access:** Tracker clients kept Watch as its own entitlement.
- **Importer:** gives imported live clients both apps, since the pilot opened with Watch.
- **Client panel:** has all four switches. A Stripe-billed Watch can't be switched off there.

**Powerworks:** the launcher tile links to `POWERWORKS_URL` (a separate site, never framed). Until that's set, `/powerworks` is a "coming soon" page.

**Names:** "CGM Standards Watch" (page, digest subject and header, calendar name), "CGM Workspace" (sign-in, launcher, invites, email sender).

**Local data:** the trial-import data was removed from the local database (`db:reset`, `seed:dev`, `import:pilot`). The fake companies now cover Watch only, Tracker only, and all three apps.

**Tests:** RLS (Watch not included with the Tracker, Powerworks product), unit (entitlements against SQL), import (both apps). e2e: every role's launcher cards, plan, Tracker header and tabs, no cross-app links, redirects to the launcher, app names, the Powerworks placeholder.

## Nov 6, 2026: T2a dry-run import of the live tracker, local only (Claude Code)

- **The run:** the Nov 5 export went into the local Supabase only (`npm run import:tracker`, then `psql` inside the local database container). The export and the SQL stay in `data/private/`, which is git-ignored, and nothing from them is committed.
- **Result:** every collection matched in and out, with no warnings. The one SQL transaction committed, and its reconciliation counts matched the report. The import wrote no app history rows.
- **Checks** (totals only, no client details):
  - every recurring chain is intact: each completed recurring task has exactly one next occurrence, which points back;
  - no task references a missing standard;
  - every client has its compliance contact, PM and Plant Manager;
  - one active Tracker entitlement per client.
- **App:** with the real data loaded, Dashboard, Tasks (all, completed), Clients, Standards and CSV export load with no page errors. The counts equal imported plus fake test data.
- **Importer fix:** the "invalid email" warning no longer prints the address itself, so console output can't carry client contact details (CLAUDE.md rule 7). The test checks this.
- **Still to do:**
  - Dan compares the Tasks and Clients screens with the live tracker side by side;
  - afterwards, `npm run db:reset`, `seed:dev` and `import:pilot` return the local database to fake data only before more automated test runs;
  - the 41 recurring obligations still need their Repeat-from setting confirmed (the live tracker had none saved).

## Nov 5, 2026: T3 dashboard and reminders (Claude Code)

**Dashboard** (`/tracker`, TRACKER-SPEC §3.2): read as the signed-in person, so staff see every client and a client sees their own company.
- **Five tiles,** each opening Tasks with the matching filter:
  - Overdue;
  - Due ≤ 30 days (leaves out Pending review);
  - Pending review, with an "awaiting report" count;
  - Open tasks across N clients;
  - Closed this quarter (since the first day of the calendar quarter).
- **Warnings:** a banner when tasks need a due date, linking to that list, and "Start by adding a client" when there are none.
- **Panels:**
  - Reminders (overdue or inside a reminder window, by due date);
  - By client (Open, Reminders, Overdue, sorted by overdue then reminders; a row opens that client's tasks);
  - Pending review (oldest performed first);
  - Upcoming schedule (next 40 outside their windows, grouped by month).

  Task rows carry the pilot's colored state bar and open the task.

**Header tools:** on Tracker screens, a **Reminders** button with a count (overdue plus inside a reminder window) opens Tasks › Reminders active. **New task** is there for staff.

**Rules:** `lib/dashboard.ts` holds the counts. Unit tests cover quarter boundaries, Due ≤ 30 days leaving out review, oldest-first review, the by-client order and month grouping.

**Tests:** e2e `tracker-t3.spec.ts` checks that every tile, the Reminders count and the By client row match the Tasks list they open, and that a client's dashboard covers only their company, without New task.

## Nov 5, 2026: Standards Watch gets its own header button (Claude Code)

**Decided by Dan** (OPEN-QUESTIONS 16):
- **Access:** Watch stays a paid, signed-in product on the same accounts as the Tracker, with no separate site.
- **Placement:** it has its own spot. The section tabs are now Tracker-only (`lib/nav.ts`), and a "NERC Standards Watch" button sits in the header beside Account, filled in while you're on the page (`components/WatchButton.tsx`).
- **Watch-only customers:** they see the button plus one locked "Compliance Tracker" tab.
- **Tests:** the access tests are updated for every role.

## Nov 5, 2026: T2 tasks core (Claude Code)

**Tasks screen** (`/tracker/tasks`, every Tracker user; RLS limits clients to their own company):
- the pilot's toolbar: search over title, standard, requirement, facility, assignee, notes and client;
- status filters: All open · Reminders active · Needs due date · Pending review · Report not posted · Overdue · Due ≤ 30 days · Completed · All tasks;
- client, standard and function filters;
- the pilot's columns and status pills, including the red dashed "report pending" pill;
- sorted by due date with no date last; Completed sorts newest first.

**Export CSV** (`/tracker/tasks/export`): the pilot's 14 columns, following the current filters, read with the person's own access.

**Task details:**
- **Staff edit every field:** client, facility, standard (with its link), requirement, due date, assignee, reminders (90/60/30/14/7/1, with the next reminder date), repeats every N months, years or days, repeat from, status, evidence and notes.
- **Checks:** a task needs a title, a client and a due date. Evidence links must be https. The performed date can't be in the future.
- **Mark performed** takes two steps, as in the pilot. It shows the next due date beforehand, and the database creates the next occurrence once.
- **Approve & close** (project managers and admins; the database refuses anyone else, and its message is shown) asks for confirmation when no report link is posted. **Send back** is there too.
- **Links:** previous and next occurrence.
- **Delete** asks for confirmation.
- **Client users** see the facts read-only. They can mark performed and save evidence and notes.

**Library and clients:**
- **Create task** on each library obligation opens a prefilled new task: due one interval from today, reminders [30, 7] or [7, 1] for day intervals.
- **Create all recurring tasks for client** works per standard.
- **Client details:** "Assign all N tracker tasks" (new client) or "Add N missing tasks" copies one task for each distinct open title, standard and requirement, without due dates. It then opens Tasks filtered to "Needs due date".

**Rules:** `lib/tasks.ts` holds the pilot's states, reminders, filters, CSV and task-set key. `nextDuePreview` mirrors SQL `next_due`, and a test checks them against each other on month ends, leap years and calendar years.

**Tests:**
- unit: next-due agreement with SQL; states, reminders, filters and CSV;
- e2e `tracker-t2.spec.ts`: staff create → mark performed → next occurrence due Feb 28, 2027 for a Jan 31 monthly task → staff approve refused with the database message → client can only post evidence and notes → PM approves; the CSV follows the filters; library Create task prefills.

**Left for later:** task plans (T4), Discuss and Outlook reminders (T6 and T8), and the completion-date "move next occurrence" prompt.

## Nov 5, 2026: sign-in is the front door (Claude Code)

- **Dan's follow-up:** the split-screen sign-in page is the app's front door. `/` sends signed-out visitors to `/login` (no app header), and signed-in people to their home.
- **Watch offer page:** the public NERC Standards Watch offer (teaser cards and plans) moved to `/standards-watch`. The "Standards Watch plans" links, the account page's "Choose a plan" and Stripe's cancel link point there.
- **Superseded:** this replaces the Tracker-first public home page described in the entry below.

## Nov 5, 2026: one app, CGM Compliance Tracker (Claude Code)

**Decided by Dan** (OPEN-QUESTIONS 15): the app is CGM Compliance Tracker, and NERC Standards Watch is one page in it. Before this, the app had been branded as Standards Watch, with the Tracker as a section.

**Header and menu:**
- one header on every screen: the CGM logo, "CGM Compliance Tracker", and the person's company or CGM role;
- top right: editor tools and Account;
- one section menu from `lib/nav.ts` (`components/AppNav.tsx`) replaces the separate site and Tracker menus.

**Who lands where** (`homeFor()`):
- Tracker users → Dashboard; Watch subscribers → Watch; others → Account;
- a blocked page sends people to their own home;
- signed-in visitors to `/` go to their home.

**Pages and titles:**
- **Watch page:** has its own "NERC Standards Watch" title, the awareness-only disclaimer and "Continue to the Dashboard →".
- **Page titles:** "<page> | CGM Compliance Tracker".
- **Public home page:** CGM Compliance Tracker first, then a NERC Standards Watch section with the teaser and plans.
- **Sign-in, welcome page and invite emails:** use the new name.
- **Footer:** "CGM Compliance Tracker · © CGM Consulting Group"; the Watch disclaimer moved onto the Watch page and the teaser.

**Tests:** the access tests now check every role's header links and section menu, and that only the Watch page uses the Watch name.

## Nov 5, 2026: T1 standards library and clients (Claude Code)

**Function list** (Dan's decision 5): `lib/functions.ts` holds the one registered-function list: GO, GOP, GO-2, GOP-2, TO, TOP, TP, PC.
- Watch folds GO-2 into GO and GOP-2 into GOP. This is applied to people's functions and to the welcome screen's company prefill.
- The pilot's mapped-entity table, with the standards behind each relationship, is ported unchanged.

**Standards library** (`/tracker/standards`, every Tracker user can read it):
- table: Standard (number-version) · Title · Applies to · Recurring obligations · Open tasks;
- search, family and function filters;
- each row expands to notes, the standard link and its obligations (with interval, repeat-from and a SUGGESTED chip);
- project managers and admins can:
  - save the version inline (every link follows it);
  - save a custom link, or reset it to the nerc.com PDF;
  - edit details (number locked);
  - add a standard (number format and uniqueness checked);
  - delete a standard, which is refused while tasks use it.

**Recurrence settings** (`/tracker/standards/recurrence`, PMs and admins):
- every recurring obligation, with Repeat from, SUGGESTED for unconfirmed rows, open-task counts and a MIXED chip;
- applying confirms the rows and, optionally, aligns open repeating tasks matched by title, standard and requirement. Due dates never change.

**Clients** (`/tracker/clients`, CGM staff):
- **Directory:** Entity (SAMPLE / TRACKER OFF / CLIENT TASKS chips, SharePoint, contact and DIGEST) · NCR ID · Registered · Region · Registered as (and mapped entities) · Project Manager · Plant Manager · Facilities.
- **Drawer:**
  - every pilot field;
  - mapped NERC entities that follow the ticked functions;
  - the compliance contact, Project Manager and Plant Manager, each with their digest box (stored in `contacts`).
- **Who can do what:**
  - PMs and admins add and edit clients; other staff only view;
  - admins switch the Tracker and Client Tasks on or off, delete a client (with its tasks, after a confirm tick) and remove sample clients.
- **Not here:** Watch-only subscribers aren't listed.

**Tracker tabs:** Standards Library and Clients are live, and the current tab is underlined.

**Tests:**
- RLS: library and template writes are PM/admin only; clients are PM/admin edit and staff read; contacts are staff-only; products and deletes are admin-only (32 RLS tests);
- e2e `tracker-t1.spec.ts`: a PM's version, link and new/delete flow; staff and clients read-only; client add with validation, entity rows, contacts, staff view, admin product switch and delete.

**Acceptance:** the library shows the pilot's 48 standards and 72 obligation templates.

**Left for T2:** "Create task", "Create all recurring tasks for client", "Assign all tracker tasks" and "Add missing tasks" (they need the tasks screens).

## Nov 5, 2026: weekly NERC drafting job (Claude Code)

**Decision 9 built:** the app drafts Standards Watch changes itself each week, and your Monday task stays as the backup.
- `lib/watch-job.ts`: Claude Opus 5.5 with web search and fetch limited to official sites (NERC, FERC, Federal Register, Regional Entities).
  - It gets the published content, pending drafts and recent decisions.
  - It answers through one strict `submit_drafts` tool.
  - It uses prompt caching across paused turns and the server-side refusal fallback.
- `lib/watch-job-core.ts` (pure, unit-tested): submission → drafts in the Monday task's shape. Values are checked against the Edit-first rules, problems are flagged rather than dropped, and the ids match the Monday task so nothing is queued twice. Only https refs are kept, and drafts already pending are skipped.
- **Schedule:** `/api/jobs/watch-drafts` runs Mondays at 17:00 UTC (`vercel.json`, `CRON_SECRET`): 10 a.m. Mountain in winter, 11 a.m. in summer. Dan moved it from 15:00 UTC because NERC's newsletter sometimes arrives around 9 a.m.
- **Review page:** "Weekly drafting job" panel with the last five runs (summary, what wasn't confirmed, estimated cost) and a two-click "Run it now".
- **Migration `0011_watch_job_runs.sql`:** the run log, readable by editors only, plus an RLS test.
- **New setting:** `ANTHROPIC_API_KEY` (`.env.example`). Without it, runs are logged as skipped.
- **Dependency:** `@anthropic-ai/sdk` 1.6.0, pinned.
- **Tests:**
  - unit: submission handling (bad dates flagged, bad JSON and unknown sections skipped, duplicates and pending skipped, non-https refs dropped, week key forced) and the cost estimate;
  - e2e: cron secret, editor panel, a run without a key logged as skipped, PMs can't reach it.
- **Not tested automatically:** a real run, which calls the Claude API and costs money.

## Nov 5, 2026: Watch alerts back as an opt-in setting, off by default (Claude Code)

**Decided by Dan:** the digest stays the default and main Watch email, but anyone who really wants a note for each change can turn alerts on (OPEN-QUESTIONS 14). This supersedes the removal below.

**What changed:**
- The alert job, cron and digest-page panel are back.
- **Migration `0010_watch_alerts_opt_in.sql`:** re-adds `profiles.alerts_opt_in` with **default false**, and `alert_log`. `0009` stays in place, since it was already applied.
- **Account page:** "Also email me alerts between digests (optional)", unchecked by default, with a note that the digest already covers everything.
- **Tests:**
  - RLS: nobody has alerts on by default; everyone has the digest on.
  - e2e: a subscriber opts in and gets the alert once. Someone who didn't opt in gets nothing. One-click unsubscribe turns alerts back off.

## Nov 5, 2026: Watch alert emails removed (Claude Code, superseded above)

**Decided by Dan:** no Watch alert emails. NERC offers its own alerts, and the point of Watch is one reviewed weekly digest instead of a stream of email (OPEN-QUESTIONS 14).

**Removed:**
- `lib/alerts.ts`, `/api/jobs/alerts` and `vercel.json`;
- the alerts checkbox on the account page and the alerts panel on the digest page;
- the alert half of `lib/changes.ts`;
- `CRON_SECRET` from `.env.example`.

**Migration `0009_no_watch_alerts.sql`:** drops `alert_log` and `profiles.alerts_opt_in`. `drafts.previous` stays, because the digest's corrections box uses it.

**Unchanged:** the unsubscribe links cover the digest only, and the one-click header is still tested.

## Nov 5, 2026: W5 delivery: digest, alerts, calendar (Claude Code)

**Migration `0008_delivery.sql`:**
- `profiles.alerts_opt_in`;
- `drafts.previous` (the published value an approved draft replaced);
- `alert_log`, which staff can read and nobody writes through the API;
- 2 RLS tests (29 in all).

**Digest** (`lib/digest.ts`, `/admin/digest`):
- Each email has a plain-text part, made from the same sections as the HTML.
- A corrections box, pre-filled from dates changed and entries removed since the last digest (`lib/changes.ts`). The editor edits it, updates the preview, then sends. Corrections show at the top of both parts.
- Each recipient gets their own signed unsubscribe link plus the one-click `List-Unsubscribe` header.
- Sending works locally through Mailpit.

**Alerts** (`lib/alerts.ts`, `/api/jobs/alerts`, `vercel.json` cron daily at 13:00 UTC):
- They cover new FERC approvals, effective dates set or moved, and comment periods or events within 14 days.
- Each person gets one email per run, filtered to their functions, and each alert goes out once.
- Nothing is sent while automated emails are off.
- The digest page lists the alerts that are due.

**Unsubscribe:** `/unsubscribe` asks before acting, and `/api/unsubscribe` is the one-click POST. The digest and alerts can each be turned off on their own, and the account page has both checkboxes.

**Calendar feed** (`lib/ical.ts`):
- RFC 5545 line folding, which was missing;
- UIDs that no longer depend on list order (the old ones would have duplicated events in Outlook);
- a description with the disclaimer, a URL, and a 12-hour refresh hint.

**New settings:** `EMAIL_LINK_SECRET` and `CRON_SECRET` (`.env.example`).

**Tests:**
- unit: digest text vs HTML, corrections and alerts from fake drafts, the calendar parsed with ical.js (folding, unique and stable UIDs, filtering);
- `e2e/delivery.spec.ts`: digest send to Mailpit with the correction, text part and headers; unsubscribe page and a forged link; alerts held while emails are off, sent once when on; one-click unsubscribe; the real feed parses.

## Nov 5, 2026: W3 review queue parity (Claude Code)

**Review queue** (`/admin/review`, editor only):
- Before/after diffs use field names ("U.S. effective date", not `effective`). Lists show as readable lines, and topics by name.
- New entries list every field.
- **Approve all** shows when 2 or more drafts are waiting. It needs two clicks, publishes oldest first, and stops at the first problem, saying how many were published.
- **Edit first** is now a form for each section, replacing the pilot's raw JSON box. The fields come from `lib/draft-fields.ts`:
  - functions and topics as choices;
  - dates as date pickers;
  - milestones, news and this-week points as rows;
  - source keys checked against the published sources.

  Problems show as you type and block "Approve edited". The server checks the edited value again before publishing.
- The draft shape is unchanged (CLAUDE.md rule 5). Empty optional fields are dropped so an edited draft looks like a Monday-task draft.

**Decision log** (`/admin/review/log`):
- every approved and rejected draft, newest first;
- who decided, when, whether it was edited, the reason, the sources, and what was published;
- filters by decision and section, 100 per page.

**Tests:**
- unit: every published pilot entry passes the checks unchanged, and bad edits (Feb 30, unknown function, unknown source, dev with an effective date, empty milestone text, http link) are caught;
- `e2e/review.spec.ts`: fake drafts arrive through `/api/drafts` (the Monday task's route) and go through edit with checks, reject, Watch showing the edit, the log and its filters, and Approve all of remove drafts that take the fake entries back off; PMs can't reach the queue or the log.

## Nov 5, 2026: W2 accounts: welcome screen, invites, seats (Claude Code)

**Decided by Dan:** editor-only screens get a red striped band so they stand out.

**Migration `0007_accounts.sql`:**
- `profiles.onboarded_at` (existing people are backfilled as done) and a check on `profiles.region`;
- new `invites` table: lower-case email, member or admin role, 14-day expiry;
- the seat check runs in a trigger: members plus open invites can't pass `companies.seats`;
- `accept_invite()`, `revoke_invite()`, `remove_member()`, which are the only ways to change membership besides CGM admins;
- `protect_profile_fields` gains a transaction-local trusted flag those functions use;
- 5 new RLS tests (27 in all).

**Screens:**
- `/welcome`: first sign-in for client users. It asks for name, functions (starting from the company's), Regional Entity and the digest.
- Account page:
  - "Your team" for company admins: seats used, members (change role, remove), open invites (revoke) and the invite form;
  - Regional Entity can be changed.
- Admin page: a seats box per company.
- The sign-in callback joins invitees to their company and sends them to the welcome screen.

**Email.** `lib/mail.ts` sends invite emails:
- through Resend when it's configured (placeholder values don't count);
- otherwise to the local mail catcher in development.

Invites are sent even while automated emails are off: they're a person's direct action, like sign-in links.

**Tests:** `e2e/accounts.spec.ts` covers invite → email → sign in → joined → welcome → access → removal → access ends, the seat limit and revoking, and that members can't manage the team.

## Nov 5, 2026: W1 Standards Watch parity and one color scheme (Claude Code)

**Decided by Dan:** sign-in stays on the email link for now; every screen uses the CGM white-and-blue palette (`docs/OPEN-QUESTIONS.md` 12–13).

**Palette.** Shared tokens on `:root` in `app/watch.css`:
- blue `--accent` #1747D1 (dark #6C94FF) and navy `--navy` #0B2347, on white surfaces and a cool grey-blue background;
- the hero countdown, CTA band and toasts are navy;
- selected chips are blue;
- "New FERC approval" moves to indigo so it doesn't blend with the accent; the other status colors are unchanged.
- Sign-in, the Tracker and the digest email read the same tokens. The editor console is dark navy instead of violet.

**W1 parity with the pilot** (`components/WatchView.tsx`, `app/watch/page.tsx`):
- filter choices are remembered per browser; the first visit starts from the company's functions;
- jumping to a card from the hero, calendar or counts flashes it;
- the calendar shows the Today rule even when every date is past;
- the "Not sure which of these apply" CTA band and the full sources list are back;
- a bottom bar shows "Next: Compliance Tracker →" for Tracker clients, and the locked Tracker for everyone else.

**Tests:**
- unit test of the HANDOFF filter cases on the pilot content;
- `e2e/watch.spec.ts`: filters, remembered filters, flash, furniture, Tracker bar;
- `e2e/screens.spec.ts` (opt-in, `SCREENSHOTS=1`) writes review screenshots at 1280/900/390 in light and dark to `screenshots/` (git-ignored).

## Nov 5, 2026: F0 local environment and F1 app shell (Claude Code)

**Decided by Dan:** answers to every open question are recorded in `docs/OPEN-QUESTIONS.md`. In short:
- Standards Watch launches first, with the Tracker shown locked.
- Automated emails are built but ship off, behind an admin switch.
- Build locally in Docker; go live on Supabase Pro + Vercel.

**F0: local environment**
- The project moved to `C:\dev\cgm-compliance-platform`, out of OneDrive. It's in git and pushed to GitHub (`danielcarter7123/CGM-Compliance-Tracker-and-Standards-Watch`).
- Supabase CLI (pinned) with `supabase/config.toml`:
  - auth redirects point at `localhost:3000`;
  - email and sign-in rate limits are raised for local testing only.
- New npm scripts:
  - `db:start`, `db:stop`, `db:reset`;
  - `db:env`, which writes the local keys into `.env.local`;
  - `seed:dev`, which creates fake users for every role, three fake companies, the CGM library and fake tasks. It refuses to run against anything that isn't local.
- Playwright (pinned) signs in through the real email-link flow via the local mail catcher. Run it with `npm run test:e2e`.
- `docs/LOCAL.md` walks through all of it.

**F1: app shell**
- The masthead shows Watch, Tracker, Review queue, Digest and Admin by role and product. The Tracker shows as **locked** (🔒) for people whose company doesn't have it, and leads to an "ask CGM" notice on `/account`.
- Route guards (`lib/guards.ts`):
  - `/tracker/**` needs the Tracker product;
  - `/admin` needs a CGM admin;
  - `/admin/review` and `/admin/digest` need an editor.
- `/tracker` has a console bar. Sections not built yet are greyed out, and Clients and Team Tasks are shown to staff only. A first dashboard shows open, overdue, due-soon and awaiting-approval counts per client, read through RLS.
- `/admin` (CGM admin):
  - the automated-email master switch;
  - each company's products (Stripe-billed products are changed in Stripe);
  - add a company;
  - each person's CGM role, client company and company role.
- `/watch` shows "Next: Compliance Tracker →" to Tracker users.
- `0006_app_settings.sql`:
  - an `app_settings` table, readable by staff and writable only by CGM admins;
  - `emails_enabled` defaults to `false`.
  - `lib/settings.ts` exposes `emailsEnabled()`, which every automated sender must check. The `EMAILS_DISABLED` env var forces email off.
- **Bug fixed:** `getViewer()` embedded `companies` from `profiles` ambiguously, because `companies.pm_id` also points at `profiles`. PostgREST refused the query, so every signed-in user looked signed out. It now names `profiles_company_id_fkey`. The Stripe portal route had the same issue.

**Tests:**
- 22 access-rule tests, including the new app-settings case;
- 13 lib tests;
- 11 Playwright tests: each of the 8 roles plus signed out, client isolation on the dashboard, and the admin switches;
- typecheck and build green.

**Still open:**
- the exact evidence purge rule (confirm);
- pricing (blocks W4);
- launch details (block P1);
- the task plans file, which Dan will send.
- The single comprehensive registered-function list (Q5) lands with T1, the client records.

## Nov 5, 2026: live data import, SharePoint and file upload, decisions

**Decided by Dan**

- Clients can mark their own tasks performed, post evidence and add notes.
- Only PMs and admins approve. All CGM staff see all clients.
- Evidence: SharePoint linked seamlessly **and** file upload.
- All of the live tracker's client data is essential and must carry over without re-entry. Build the Sandbox Copy's features.

**Changed outside this repo**

- The **live NERC Compliance Tracker** (claude.ai artifact `685Z4nk6RAxhHorCaBXnsc`, owned by a colleague; Dan is an Editor) now has an **Export all data** button. It was added in versions 42–43; nothing else on the page changed.
  - Only Editors see it. It downloads `cgm-tracker-full-export-YYYY-MM-DD.json` with every document in `clients`, `tasks`, `standards`, `teamTasks`, `activity` and `activitySnapshots`, plus the names of the CGM people the records reference.
  - It checks its counts against what the page shows and logs itself in the tracker's Activity Log.
  - The updated page is at `docs/reference/live-tracker-page.html`.

**Added to the repo**

- `supabase/migrations/0004_legacy_import.sql`:
  - fields the live tracker has that 0003 lacked (`tasks.assignee_email`, `tasks.outlook`, `team_tasks.owner_email`);
  - `legacy_id` and `legacy` (the full original document) on imported rows;
  - `legacy_people`, `legacy_snapshots`, `activity_log.source`;
  - an import mode that silences triggers;
  - `link_legacy_person()`;
  - `pm` as a contact kind.
- `supabase/migrations/0005_evidence.sql`:
  - the `evidence` table (SharePoint item, uploaded file, or link per task; soft remove only; audit-logged);
  - SharePoint folder ids and `evidence_destination` on companies;
  - a private storage bucket `evidence` with one folder per client, plus its access policies.
- `scripts/import-tracker.ts` (`npm run import:tracker`): turns the export into one SQL transaction plus a reconciliation report. It keeps everything, refuses to run twice, and reports anything it couldn't map.
- `data/private/` (git-ignored except its README): where the export file and the generated SQL go.
- Tests (34, all passing):
  - evidence and storage access cases in `tests/rls.test.mjs`;
  - `tests/import.test.ts` (8 cases on a fake export shaped like the real one);
  - a shared `tests/helpers/pg.mjs`.
- Docs:
  - `docs/IMPORT.md`, `docs/EVIDENCE.md`, this changelog, `docs/OPEN-QUESTIONS.md`;
  - HANDOFF updated with milestones T2a (dry-run import) and T5b (SharePoint and upload), a reworked T9 (cutover) and live-vs-sandbox notes;
  - ACCESS gains an evidence row and records the decisions;
  - CLAUDE.md has a client-data rule and the "ask first" flag;
  - SETUP gains Microsoft 365 and import steps;
  - `.env.example` gains `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `SUPABASE_DB_URL`.

**Open:** see `docs/OPEN-QUESTIONS.md` (three new questions to ask before coding).

## Nov 5, 2026: Standards Watch and Compliance Tracker in one project

- One app, two products, access per client subscription (`docs/ACCESS.md`):
  - `0002_platform.sql`: staff roles, company roles, entitlements;
  - `0003_tracker.sql`: library, tasks with recurrence and client-edit guard, Client Tasks, team tasks, messages, append-only audit log.
- App code reads products from `entitlements` (`lib/entitlements.ts`, `lib/auth.ts`). The Stripe webhook writes entitlements. Only company admins reach billing.
- Tracker spec from the Sandbox Copy: `docs/tracker/TRACKER-SPEC.md`, `docs/tracker/DATA-SHAPES.md`. CGM standards library seed: `data/tracker-standards-library.json` (48 standards, 72 obligations; no client data).

## Nov 5, 2026: first handoff (Standards Watch)

- `CLAUDE.md`, `docs/HANDOFF.md`, `docs/KICKOFF.md`, the reference pages, the Monday task prompt.
- Watch seed data refreshed to the Nov 2 review.

## Oct 26 – Nov 2, 2026: starter app

- Next.js + Supabase + Stripe + Resend starter for Standards Watch: Watch page, review queue, digest, calendar feed, drafts API, `0001_init.sql`, setup and architecture docs.
