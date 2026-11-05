# Changelog

What changed in the handoff, newest first. Claude Code: read this after `CLAUDE.md` so you know what is new and what was decided. Add an entry here whenever you finish a milestone.

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
