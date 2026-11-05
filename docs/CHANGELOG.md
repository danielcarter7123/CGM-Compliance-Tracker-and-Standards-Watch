# Changelog

What changed in the handoff, newest first. Claude Code: read this after `CLAUDE.md` so you know what is new and what was decided. Add an entry here whenever you finish a milestone.

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
