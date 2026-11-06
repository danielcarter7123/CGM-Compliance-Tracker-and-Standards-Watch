# CLAUDE.md

> **⚠ STOP: before writing any code, ask Dan the open questions.**
> Open `docs/OPEN-QUESTIONS.md` and ask him every question under "Ask first" and "Still open", in one message, then wait for his answers and record them there. Reading docs and running install, typecheck, tests and build are fine before he answers. Then read `docs/CHANGELOG.md` for what changed most recently.

Guidance for Claude Code working in this repository. Before starting any milestone, read `docs/HANDOFF.md` (brief, status, build plan) and `docs/ACCESS.md` (who can do what).

## What this is

**CGM Compliance Tracker** is the app. Its name is at the top of every screen and in every page title. **NERC Standards Watch is one scrollable page inside it** (`/watch`), reached from its own "NERC Standards Watch" button in the header, never one of the Tracker's section tabs (decision 16). That page is the only place the "NERC Standards Watch" name is used as a title. The Watch digest email and calendar feed keep the Watch name because they are that page's output. Dan's decision (OPEN-QUESTIONS 15); "build the Watch page first" was about launch order, never about branding.

Both are from CGM Consulting Group, for NERC-registered utilities:

- **Standards Watch**: a reviewed, function-filtered view of NERC standards that FERC has approved, versions taking effect, and requirements phasing in. It comes with a weekly digest and a calendar feed. Sold self-serve through Stripe.
- **Compliance Tracker**: CGM's operator console for running each client's NERC compliance program. It covers recurring tasks from a standards library, review and approval, internal team work, messages and an audit log. Clients on a Tracker agreement see and act on their own company's tasks. It includes Standards Watch. An optional **Client Tasks** add-on gives a client a non-NERC task list.

Both began as claude.ai artifacts (the "pilots"). `docs/reference/pilot-watch-page.html` and `docs/reference/pilot-tracker-page.html` (the Sandbox Copy: the features to build) are the references for look and behavior. `docs/reference/live-tracker-page.html` is the live tracker, whose data is imported; `docs/tracker/TRACKER-SPEC.md` describes the Tracker in full.

Owner and product decision-maker: Dan (dan@cgmconsultinggroup.com).

## Stack

Next.js 14 App Router + TypeScript, Supabase (Postgres, email-link auth, row level security), Stripe (subscriptions), Resend (email). Hosted on Vercel. Node 20+.

## Commands

```bash
npm install
npm run dev              # http://localhost:3000
npm run typecheck
npm test                 # access-rule tests (all migrations, in-memory Postgres) + lib tests on real data
npm run build
npm run import:pilot     # Standards Watch content -> Supabase (needs .env.local)
npm run import:library   # CGM standards library + obligation templates -> Supabase (dev; real cutover uses import:tracker)
npm run import:tracker -- data/private/<export>.json   # live tracker data -> one SQL transaction (docs/IMPORT.md)
```

Run `npm run typecheck && npm test && npm run build` before calling any milestone done.

## Rules that must not be broken

1. **Client isolation.** Every client-owned row carries `company_id`, and row level security lets a client user see only their own company's rows, and only for products their company holds. Never add a client-facing table without a `company_id` policy and a test proving another company can't read or write it.
2. **Access lives in the database.** The policies and triggers in `supabase/migrations` are the source of truth; UI checks (`lib/auth.ts`) only decide what to show. Don't weaken a policy to make a feature work. Schema or policy changes go in a new numbered migration (never edit an applied one), with matching cases in `tests/rls.test.mjs`.
3. **The service role key stays server-side.** Only `lib/supabase/admin.ts` (marked `server-only`) uses it, and only after the caller has been checked.
4. **Nothing reaches Watch subscribers without editor approval.** Automated sources only create `drafts`.
5. **Keep the Watch draft shape stable**: `{id, section, op, key, label, reason, refs, value, createdAt, createdBy}`. The live Monday task depends on it.
6. **The audit log is append-only.** Write it only through triggers; implement restore and revert as new changes that log themselves.
7. **Treat client data as confidential.**
   - The live tracker's real data reaches the app only through its export file in `data/private/` (git-ignored) and `npm run import:tracker` (`docs/IMPORT.md`).
   - Never commit that file or the generated SQL. Never copy real names, contacts, tasks or messages into seed data, fixtures, tests, logs, screenshots or commit messages; use obviously fake values.
   - Fix import problems in the importer, never by hand-editing data.
   - CIP evidence may include BES Cyber System Information: follow `docs/EVIDENCE.md`.
8. **Summarize and link; never republish NERC standard text.** Keep the "awareness only, not a compliance determination" disclaimer on Watch pages and emails.
9. **Never invent regulatory facts** (standards, versions, dates, docket or order numbers) in code, seed data or copy.

## Conventions

- Field names: the Watch content follows the pilot (`std`, `fn`, `todo`, `todoTx`); `lib/mapping.ts` converts it to columns. Tracker tables use snake_case versions of the pilot fields (see `docs/tracker/DATA-SHAPES.md` for the mapping).
- Dates are `YYYY-MM-DD`, or `YYYY-MM` for month-only Watch dates. Use the helpers in `lib/watch.ts`. Tracker recurrence math lives in SQL (`next_due`, `spawn_next_occurrence`); don't duplicate it in TypeScript except for previews, and test that the two agree.
- Registered functions: one vocabulary in `lib/functions.ts` (GO, GOP, GO-2, GOP-2, TO, TOP, TP, PC). Watch filters fold GO-2 into GO and GOP-2 into GOP (`toWatchFunctions`). Don't add another list.
- Entitlement logic exists twice: `public.company_has()` in SQL and `productsFrom()` in `lib/entitlements.ts`. Change both together; the tests cover both.
- Styling is plain CSS with tokens on `:root` and dark-mode overrides. Every screen shares one CGM white-and-blue palette defined on `:root` in `app/watch.css` (navy `--navy`, blue `--accent`); use those tokens, don't add new brand colors. Status colors keep their meaning (indigo new FERC approval, amber coming into effect, teal in effect, grey in development). Watch keeps the pilot's bulletin layout and fonts. The Tracker uses its console layout (IBM Plex; `app/tracker.css`) with the same blue accent. Editor-only screens use the dark navy `.console` styles.
- Pin exact dependency versions.
- UI writing: plain, specific sentences, real dates, no filler.

## Pointers

- `docs/OPEN-QUESTIONS.md`: **ask these before coding**; record answers there
- `docs/CHANGELOG.md`: what changed in the handoff, newest first
- `docs/HANDOFF.md`: brief, status, build plan with acceptance criteria, open decisions
- `docs/IMPORT.md`: carrying the live tracker's data over
- `docs/EVIDENCE.md`: SharePoint and file upload
- `docs/ACCESS.md`: access matrix by subscription and role
- `docs/tracker/`: Tracker spec and data shapes
- `docs/ARCHITECTURE.md`, `docs/SETUP.md`, `docs/MONDAY-TASK.md`, `docs/PILOT.md`
- `docs/reference/`: both pilot pages and the Monday task prompt
