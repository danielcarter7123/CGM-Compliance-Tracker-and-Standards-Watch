# CGM Compliance Platform

Standards Watch and the Compliance Tracker in one app, with access set per client by what they subscribe to (see [docs/ACCESS.md](docs/ACCESS.md)).

## Standards Watch

A subscription site that tells utilities which NERC standards FERC has approved, which ones are taking effect, and what each registered function (GO, GOP, TO, TOP, TP, PC) needs to do about them. Every update is reviewed by a CGM editor before subscribers see it.

This is the production version of the pilot Standards Watch artifact. It uses the same content model, so the pilot's data and the Monday draft task move over without changes.

## What's in it

| Area | Route | Who |
|---|---|---|
| Public landing page with a teaser and plans | `/` | Everyone |
| Sign in by email link | `/login` | Everyone |
| The Watch (filter by function, deadlines, history) | `/watch` | Paying subscribers, editors |
| Account: functions, digest opt-in, calendar feed, billing | `/account` | Signed-in users |
| Review queue: approve, edit or reject drafts | `/admin/review` | Editors |
| Weekly digest preview and send | `/admin/digest` | Editors |
| Stripe Checkout, customer portal, webhook | `/api/stripe/*` | System |
| Drafts intake for the Monday task | `/api/drafts` | Bearer token |
| Per-user iCal deadline feed | `/api/calendar/[token]` | Subscriber's calendar app |

**Stack:** Next.js 14 (App Router), Supabase (Postgres, auth, row level security), Stripe (billing), Resend (email). Vercel hosts it.

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in the keys (see docs/SETUP.md)
# run supabase/migrations/0001_init.sql in the Supabase SQL editor
npm run import:pilot              # loads the pilot's current content
npm run dev                       # http://localhost:3000
```

Then sign in once and make yourself an editor. The full walkthrough is in **[docs/SETUP.md](docs/SETUP.md)**.

## Docs

Building with Claude Code? Start with **[docs/KICKOFF.md](docs/KICKOFF.md)**. Open questions to settle before coding: **[docs/OPEN-QUESTIONS.md](docs/OPEN-QUESTIONS.md)**. Recent changes: [docs/CHANGELOG.md](docs/CHANGELOG.md). Claude Code reads [CLAUDE.md](CLAUDE.md) automatically; the brief and build plan are in [docs/HANDOFF.md](docs/HANDOFF.md).

- [docs/SETUP.md](docs/SETUP.md): accounts, keys, database, Stripe, email and deploy, step by step
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how the pieces fit, the data model and the access rules
- [docs/MONDAY-TASK.md](docs/MONDAY-TASK.md): moving the weekly draft task from the pilot to this app
- [docs/PILOT.md](docs/PILOT.md): running the pilot and the app side by side during the test weeks
- [docs/ACCESS.md](docs/ACCESS.md): who can do what, by role and subscription
- [docs/IMPORT.md](docs/IMPORT.md): carrying the live tracker's client data over, with no re-entry
- [docs/EVIDENCE.md](docs/EVIDENCE.md): SharePoint linking and file upload
- [docs/tracker/TRACKER-SPEC.md](docs/tracker/TRACKER-SPEC.md) and [DATA-SHAPES.md](docs/tracker/DATA-SHAPES.md): the Compliance Tracker spec

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run typecheck` | TypeScript check |
| `npm test` | Database access-rule tests and library tests on the pilot data |
| `npm run import:pilot [file]` | Upsert Standards Watch content JSON into Supabase (safe to re-run) |
| `npm run import:library [file]` | Load CGM's tracker standards library and obligation templates (development seed) |
| `npm run import:tracker -- <export.json>` | Turn the live tracker's export into one SQL transaction + report ([docs/IMPORT.md](docs/IMPORT.md)) |
