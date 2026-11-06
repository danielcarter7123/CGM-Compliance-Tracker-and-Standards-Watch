# Handoff: CGM Compliance Platform (Standards Watch + Compliance Tracker)

> **⚠ STOP: before writing any code, ask Dan the open questions.**
> Open `docs/OPEN-QUESTIONS.md` and ask him every question under "Ask first" and "Still open", in one message, then wait for his answers and record them there. Reading docs and running install, typecheck, tests and build are fine before he answers. Then read `docs/CHANGELOG.md` for what changed most recently.

Prepared Nov 5, 2026 for Claude Code. Read `CLAUDE.md` first for the rules. This file covers the brief, current status, the build plan and the open decisions. `docs/ACCESS.md` covers who can do what.

## 1. The product

One web app, two products, with access set per client by what they've bought:

- **Standards Watch.** Compliance staff at generation and transmission utilities need to know which NERC reliability standards are changing and what to do before each compliance date. Watch gives them one reviewed page filtered to their registered functions, a weekly email digest and a calendar feed. A scheduled AI task drafts each week's changes from NERC's emailed newsletter and the NERC and FERC sites; a CGM editor approves every change. Sold self-serve. Transmission entities are the first target.
- **Compliance Tracker.** CGM runs its clients' NERC compliance programs in it:
  - recurring and one-time tasks per client, generated from a standards library of obligation templates;
  - reminders, a "performed → report posted → PM approves" review step, and evidence links;
  - step-by-step task plans, internal team tasks, messages and an audit log.
  - In the pilot only CGM staff use it. In the app, client users on a Tracker agreement also log in and see their own company's tasks, mark work performed and post evidence.
  - It includes Standards Watch (the pilot opens with the Watch page before the tracker). An optional **Client Tasks** add-on tracks a client's non-NERC work.

The two share logins, companies, billing, email delivery, the audit log and the design system. They're separate sections of one Next.js app: `/watch` and `/tracker`.

## 2. Where things stand

### Pilots (keep running until cutover)

| Piece | Where | Notes |
|---|---|---|
| Standards Watch page | claude.ai artifact `2EB75dreBg2j6QydnPbGGD` | Master Watch content and review queue. Snapshot: `docs/reference/pilot-watch-page.html`. |
| **Compliance Tracker (live)** | claude.ai artifact `685Z4nk6RAxhHorCaBXnsc` (owned by a colleague; Dan is an Editor) | **The source of truth for data.** In daily use by CGM. Has an Editors-only **Export all data** button (added Nov 5, 2026) that feeds the importer. Snapshot: `docs/reference/live-tracker-page.html`. |
| Compliance Tracker (Sandbox Copy) | claude.ai artifact `DjexDTiLux4WG2xDNwpvLW` | **The source of truth for features** (review step, task plans, Client Tasks, messages, embedded Watch). Its data is an older copy. Snapshot: `docs/reference/pilot-tracker-page.html`; spec: `docs/tracker/`. |
| Monday draft task | Scheduled, Mondays 9:47 AM Mountain | Writes Watch drafts only. Prompt in `docs/reference/monday-task-prompt.md`. |
| Weekday sync task | Scheduled, weekdays 5:43 PM Mountain | Copies approved Watch content into the tracker copy. Retired once both read one database. |
| Related artifacts, out of scope | CGM Compliance Reporting portal; RSAW Workbench | Linked from the tracker. Bring them in later (see "Later"). |

Watch pilot results: first Monday run Nov 2, 2026. Ten drafts were queued and all ten approved, with no edits and no rejections. The test runs to Nov 27.

### This repo

| Done | Verified by |
|---|---|
| Watch schema (`0001_init.sql`) | tests |
| **Platform access model** (`0002_platform.sql`): CGM staff roles (admin, pm, staff), client company roles (admin, member), per-company `entitlements` for `watch`, `tracker`, `client_tasks`, tracker client fields on `companies`, `contacts` | 18 access-rule tests in `tests/rls.test.mjs` |
| **Tracker schema** (`0003_tracker.sql`): library standards and obligation templates, task plans, tasks with recurrence and the client-edit guard, client tasks, team tasks, chats and messages, append-only activity log written by triggers | same tests: isolation, client edits, approval, recurrence, add-on, messages, audit log |
| Watch app: landing + teaser, email-link login, `/watch`, `/account`, `/admin/review`, `/admin/digest`, Stripe checkout/portal/webhook (now writing `entitlements`), Resend digest, iCal, `/api/drafts` | typecheck, build; lib tests on real data |
| `lib/entitlements.ts` + `lib/auth.ts` expose `products`, `staffRole`, `canApprove` to the UI | typecheck; unit test |
| **Evidence** (`0005_evidence.sql`): SharePoint items, uploaded files (private storage bucket, one folder per client) and links, per task; soft remove only; audit-logged | 3 evidence/storage access tests |
| **Live-data import** (`0004_legacy_import.sql`, `scripts/import-tracker.ts`): the live tracker's export becomes one SQL transaction (clients, contacts, Tracker entitlements, library, tasks with recurrence chains, team tasks, people, full history, deleted-record snapshots), keeping every original document in `legacy` | 8 import tests on a fake export shaped like the real one |
| Seed data: `data/pilot-content.json` (live Watch content, Nov 2 review) and `data/tracker-standards-library.json` (CGM's 48 standards and 72 obligation templates; **no client data**) | load tests |

Not built yet (F0 and F1 are done, see CHANGELOG): every Tracker screen beyond the first dashboard, the Microsoft Graph (SharePoint) code, tracker digests and reminders, client user invitations, and anything run against live Supabase, Stripe, Resend or Microsoft 365 (no accounts yet).

### Client data: carried over, not re-entered

All of the live tracker's client data is essential and moves into the app as it is (`docs/IMPORT.md`):

1. Dan clicks **Export all data** in the live tracker.
2. He drops the file in `data/private/`, which is git-ignored.
3. `npm run import:tracker` turns it into one SQL transaction with a reconciliation report.

The importer is built and tested; nothing needs re-entering. The client data never goes into git, fixtures, screenshots or logs. It lives only in `data/private/` on Dan's machine and in the Supabase database.

## 3. Users

See `docs/ACCESS.md` for the full matrix. In short:

- **Visitor / no plan:** landing page, Watch teaser, plans.
- **Watch client:** Standards Watch, digest, calendar feed.
- **Tracker client:** Watch, plus their own company's tasks (view, mark performed, post evidence, notes), the standards library, their company's message channel and their task history. With the add-on, also their Client Tasks list.
- **Client company admin:** the above, plus seeing colleagues and managing billing.
- **CGM staff:** every client's tracker data, team tasks, task plans, CGM channels.
- **CGM PM:** staff, plus approving performed tasks and editing clients and the library.
- **CGM admin (Dan):** everything, including Watch review, products and roles.

## 4. Behavior to match

### Standards Watch

`docs/reference/pilot-watch-page.html` is the visual and functional spec (pair it with `data/pilot-content.json`). Most of the logic is already ported in `lib/watch.ts` and `components/WatchView.tsx`.

- **Sections:** Coming into effect · In implementation · Recently took effect (365 days) · In development. Older items are archived.
- **Badges:** "New FERC approval" (270 days); News box (21 days).
- **Hero:** next dated event for the selected functions, as a day count with jump-to-card.
- **Page furniture:** this-week strip; four count tiles; function chips (All · GO GOP | TO TOP TP PC), topic chips and search; cards with "What changes" / "What to do" (plus the TO/TOP/TP/PC paragraph) and milestones.
- **Rail:** calendar by year with a today rule, comment periods (highlighted ≤14 days), recent FERC and NERC actions.
- **Around the content:** CTA band, footer disclaimer and sources, light and dark themes.
- **Editor review queue:** violet console, field diffs, Approve / Edit first / Reject / Approve all, decision log.
- **Inside the Tracker:** the pilot shows Watch first each browser session ("Next: Compliance Tracker →"). In the app, a Tracker user lands on `/watch` once per session with that button. The locked Tracker button becomes a real link for anyone with the product.

### Compliance Tracker

`docs/tracker/TRACKER-SPEC.md` is the spec, with section numbers referenced below. `docs/tracker/DATA-SHAPES.md` maps pilot fields to tables.

- **Dashboard (§3.2):** five stat tiles, reminders, by-client table, pending review, upcoming schedule.
- **Tasks (§3.3):**
  - filters, table and drawer;
  - lifecycle: performed (two-step), report-pending vs awaiting approval, Approve & close, Send back;
  - next occurrence (now a database trigger), reminder windows, validation.
- **Task plans side panel (§3.4).**
- **Team Tasks (§3.5):** staff only.
- **Standards library (§3.6):**
  - expand, edit, inline version and link;
  - "Create task" and "Create all recurring tasks for client";
  - recurrence settings with SUGGESTED bases to confirm.
- **Clients (§3.7):**
  - directory and drawer, mapped entities, contacts and digests;
  - "Assign all tracker tasks" / "Add missing tasks";
  - Client Tasks sub-tab.
- **Messages (§3.10):** channels, DMs, client channels, task chips, unread state.
- **Activity Log (§3.11):** filters, change details, restore and revert.
- **Reporting Forms and Audit Worksheets (§3.8–3.9):** link-out pages for now.
- **Client view (new):** a trimmed tracker for client users:
  - Dashboard and Tasks for their company only, with Mark performed and Evidence;
  - their messages channel, their history, and Client Tasks if they have the add-on.
  - No team tasks, task plans, other clients, or library editing.

## 5. Build plan

Each milestone ends with `npm run typecheck && npm test && npm run build` green and its acceptance checks met. Stop at **Ask Dan** items rather than assuming. Watch milestones (W) come first because Watch is nearly done and builds the shared foundation the Tracker (T) reuses.

### Foundation
- **F0. Local environment.**
  - `supabase init` / `supabase start`; apply all migrations; `npm run import:pilot` and `npm run import:library` against local.
  - Playwright set up, with sign-in through the local mail catcher (Inbucket).
  - A dev seed script that creates fake users for every role in `docs/ACCESS.md` and three fake companies (Watch only; Tracker + add-on; Tracker only), with fake tasks.
  - **Accept:** fresh clone → documented commands → can sign in as each role locally.
- **F1. App shell and navigation by product.**
  - Masthead and nav show Watch, Tracker and Admin according to `viewer.products` / `staffRole`.
  - Route guards for `/watch`, `/tracker/**`, `/admin/**`. Account page lists products.
  - A CGM admin screen to set a company's products (contract entitlements) and people's roles.
  - **Accept:** Playwright, one test per role: sees exactly the sections the matrix allows; direct URL access to anything else redirects.

### Standards Watch
- **W1. Parity with the pilot** (§4). Screenshots at 1280 / 900 / 390 px in light and dark. Filter tests: with GO selected, CIP-014-4 and TPL-008-1 are hidden; with TP selected, TPL-008-1 shows and EOP-004-5 is hidden.
- **W2. Accounts:** first-login onboarding (functions, Regional Entity); company admins invite colleagues (new `invites` table, migration and RLS tests); seats enforced.
- **W3. Review queue parity:** diffs, Approve all, structured Edit first per section, decision log page.
- **W4. Billing:** Stripe test mode end to end, with the webhook writing `entitlements`. **Ask Dan:** prices, monthly vs annual, seats, trial, invoicing.
- **W5. Delivery:**
  - digest unsubscribe link, plain-text part and corrections line;
  - alerts for FERC approvals, new effective dates and deadlines under 14 days, as an opt-in setting that's off by default; the digest is the main Watch email (OPEN-QUESTIONS 14);
  - an iCal import check.
- **W6. Monday task switch** (`docs/MONDAY-TASK.md`).

### Compliance Tracker
- **T1. Library and clients:**
  - Standards library screen: list, expand, edit, version and link, obligation templates, and recurrence settings with SUGGESTED / MIXED states and `basis_confirmed`.
  - Clients directory and drawer: companies fields, contacts, mapped entities and add-ons, which write entitlements and are admin only.
  - **Accept:** library matches the pilot's 48 standards / 72 templates; PM can edit, staff can't (RLS test exists).
- **T2. Tasks core:**
  - Tasks table with all pilot filters and CSV export; the task drawer and validation.
  - Create from template; "Create all recurring tasks for client"; "Assign all tracker tasks" and "Add missing tasks".
  - **Accept:** Playwright covers create → mark performed → next occurrence appears with the right date → PM approves; staff approve is refused with the database message shown.
- **T3. Dashboard and reminders:** stat tiles, reminders panel, by-client table, pending review, upcoming schedule, reminders button. Check the date logic against `TRACKER-SPEC.md §4` with unit tests.
- **T4. Task plans:** the side panel, matching by `standard|title`, edit, change plan (every task or this task), copy plan. A one-time import of the "CGM Master NERC Task Plans List" from the pilot store (Dan to run; it is CGM content, not client data).
- **T2a. Dry-run import with real volumes.** Dan exports the live tracker and runs `npm run import:tracker` + `psql` into the **local** Supabase only (`docs/IMPORT.md`). Check the Tasks and Clients screens against the live tracker side by side: counts per client, overdue counts, recurrence chains. Fix gaps in the importer, not by hand. Real data stays in `data/private/` and the local database.
- **T5. Client view:**
  - the trimmed tracker for client users (§4);
  - invite client users per company (company admin or CGM);
  - client "Mark performed" with date and evidence.
  - **Accept:** a client user of company A can't reach company B by any URL or API call (Playwright + RLS tests). They can mark performed; they can't edit due dates (error shown nicely).
- **T5b. Evidence: SharePoint and file upload** (`docs/EVIDENCE.md`):
  - the Microsoft Graph app registration (`Sites.Selected`), `lib/graph.ts` (server-only);
  - connecting each client's SharePoint folder from `sharepoint_url`;
  - an in-app folder browser and picker, and upload to the client's dated SharePoint evidence folder or to app storage (`evidence_destination`);
  - pasted links resolved to SharePoint items; open, download and remove.
  - The pilot's `tasks.evidence` links are shown as "Evidence (from pilot)", with an optional job to convert them to SharePoint items.
  - **Accept:**
    - a client user can upload, pick and see only their own client's folder;
    - the browse API refuses an item outside that folder;
    - a >4 MB upload uses an upload session;
    - RLS tests already cover the database side.
- **T6. Team tasks and messages:** Team Tasks screen; messages with channels, DMs, client channels, task chips and unread markers (`chat_reads`); realtime via Supabase Realtime. New-message email notifications are an **Ask Dan** item.
- **T7. Activity log:** filters, change rendering from `old_row` / `new_row`, CSV, Restore (re-insert from `old_row`) and Revert (write old values), each producing its own log row.
- **T8. Tracker digests and reminders:**
  - weekday digests to client contacts, plant managers and each PM across their clients (TRACKER-SPEC §6), sent server-side on a schedule (Vercel Cron or Supabase scheduled function);
  - the live tracker's per-person emails: a task's assignee (`assignee_email`) when it enters a reminder window, on the due date and every weekday while overdue; a team task's owner (`owner_email`) 7 days before the anticipated date, on it, and every weekday while late. **Ask Dan** what sends these today (it isn't in the page; probably a scheduled task) so it can be switched off at cutover;
  - per-user iCal feed of task due dates, replacing the pilot's Outlook event creation.
  - **Ask Dan:** whether Outlook events through Microsoft Graph are still wanted.
- **T9. Cutover from the live tracker** (`docs/IMPORT.md`; the importer is already built):
  - a CGM admin screen to link pilot people (`legacy_people`) to logins and set each client's PM;
  - restore support for `legacy_snapshots`.
  - On cutover day: pause edits, export, import to production, reconcile, then switch the team over.
  - Export the Sandbox Copy's task plans too (add the same button there).
  - Retire the Watch sync task and the tracker's email sender, then make both pilot trackers read-only.

### Production hardening (shared)
- **P1.**
  - Error monitoring, uptime check, Supabase Pro backups and point-in-time recovery.
  - Rate limits on auth and API routes, security headers.
  - Session timeout for staff, MFA for CGM staff (Supabase Auth MFA).
  - Accessibility pass; terms, privacy and disclaimer pages.
  - A data-retention policy for evidence links and messages.
  - **Ask Dan:** domain, legal review, whether any client contract requires specific security controls.

### Later
- Bring in the **Compliance Reporting portal** (client form submissions, already per-client in its pilot) and the **RSAW Workbench** (mock audits, with PNC/AOC findings turning into tasks).
- Free Watch tier; per-standard history pages; link Watch items to library standards (`library_standards.code`) so a Watch change can prompt "update these tasks" for affected Tracker clients.

## 6. Data notes

- **Watch:**
  - `pos` orders the pilot's lists; `ferc` and activity dates may be `YYYY-MM` (`sortDate` treats them as the 15th);
  - `fn: null` on a deadline = everyone; `todo` is for GO/GOP, `todoTx` for TO/TOP/TP/PC.
  - Some FERC dates in the seed were inferred during research (EOP-004-5 Aug 2026; MOD-026-2, MOD-032-2, TOP-003-8, IRO-010-6 Feb 2026; PRC-029-2 Oct 2026). Don't "fix" them in code.
- **Tracker library:**
  - Versions reflect October 2026 and some are old (for example CIP-002 is listed at 5.1a), so CGM must confirm each against NERC U.S. effective dates through the library screen.
  - Repeat-from bases are suggestions (`basis_confirmed = false`) until CGM confirms them.
- **Two function vocabularies:** Watch uses GO, GOP, TO, TOP, TP, PC; the tracker uses GO, GOP, GO-2, GOP-2, TO (the `-2` forms are Category 2 IBR registrations). **Ask Dan;** suggested answer: one list of GO, GOP, GO-2, GOP-2, TO, TOP, TP, PC, with Watch treating GO-2 as GO and GOP-2 as GOP when filtering.
- **Live tracker vs Sandbox Copy** (data comes from live, features from sandbox):
  - live has `assigneeEmail` on tasks and `ownerEmail` on team tasks (the sandbox doesn't);
  - live has no `review` status, task plans, Client Tasks or messages, so those start empty except what the sandbox export brings (task plans).
  - Live clients have no Client Tasks flag, so no client gets the add-on until CGM turns it on.
- **Two standards tables, on purpose:** Watch `standards` are *change items* keyed by version (`eop-004-5`); `library_standards` are *obligation sources* keyed by code without version (`PRC-005`). Link them later (see "Later") rather than merging them.

## 7. Open decisions for Dan

**The current list, with answers as they come in, is `docs/OPEN-QUESTIONS.md`. Ask Dan those questions before writing any code.** The summary below is for context.

**Decided by Dan (Nov 5, 2026):**

- Clients can mark their own tasks performed, post evidence and add notes.
- Only PMs and admins approve; all CGM staff see all clients.
- Evidence: SharePoint linked seamlessly **and** file upload (`docs/EVIDENCE.md`).
- Data: the live tracker's data is carried over in full (it is the most accurate). The Sandbox Copy's features are the ones to build. The two were never merged; the app is where they meet.

**Still open:**

1. **Evidence retention:** how long removed evidence and app-stored files are kept before purge. The default is to keep them forever until decided.
2. **Who sends the live tracker's assignee and owner emails today** (see T8)?
3. **Pricing and packaging:**
   - Watch prices, trial and seats;
   - is the Tracker always contract-billed;
   - is Client Tasks priced separately.
4. **Function vocabulary** (§6).
5. **Messages:** email notifications for new messages? Can client users start DMs with their PM, or only use their company channel?
6. **Outlook:** keep "Add reminders to Outlook" (Microsoft Graph), or replace it with calendar feeds?
7. Turnaround promise, second Watch reviewer, brand name and domain (from the Watch plan).

## 8. How to work

- First session: ask Dan the questions in `docs/OPEN-QUESTIONS.md` before writing any code.
- Start each session by reading `CLAUDE.md`, `docs/CHANGELOG.md`, this file, `docs/ACCESS.md` and the milestone's spec section.
- After each milestone, add an entry to `docs/CHANGELOG.md`.
- Before changing behavior the pilots have, check the reference pages.
- For any new table or column a client can see: write the RLS test first.
- After each milestone, summarize what changed and what you tested, and list anything waiting on Dan.
