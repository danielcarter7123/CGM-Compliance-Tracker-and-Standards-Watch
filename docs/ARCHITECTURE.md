# Architecture

One Next.js app and one Supabase database serve both products: Standards Watch (`/watch`) and the Compliance Tracker (`/tracker`, to be built). The flow below is Standards Watch content; the Tracker's data is entered by CGM staff and client users directly, under the access rules further down.

## Flow

```
NERC newsletter (Outlook) ─┐
NERC / FERC websites ──────┴─> Monday draft task ──POST /api/drafts──> drafts (pending)
                                                                          │
                                       CGM editor at /admin/review ───────┤ approve / edit / reject
                                                                          ▼
                                     standards · deadlines · actions · sources · weekly_summaries
                                                                          │
                     ┌────────────────────────┬───────────────────────────┼───────────────────────┐
                     ▼                        ▼                           ▼                       ▼
               /watch (web)        /admin/digest → Resend      /api/calendar/[token]      landing teaser
```

Nothing reaches subscribers without an editor approving it. The task can only write drafts.

## Data model

All tables are in `supabase/migrations/0001_init.sql`. Field names match the pilot's `watch/content` document so drafts work in both.

| Table | Holds | Pilot equivalent |
|---|---|---|
| `standards` | One row per standard version: dates, functions, topic, milestones, what/to-do text, news | `items` |
| `deadlines` | Dated compliance deadlines, optionally limited to functions | `deadlines` |
| `actions` | Recent FERC and NERC actions | `activity` |
| `sources` | Citation keys, titles, URLs | `sources` |
| `weekly_summaries` | The "this week" summary; one row per week, with digest sent time | `week` |
| `site_meta` | Last reviewed date | `reviewed` |
| `drafts` | Proposed changes with status and who decided | `watch_drafts` + `watch_log` |
| `companies` | Customer and tracker client: Stripe customer ID, NCR ID, region, functions, mapped entities, facilities, PM | Tracker `clients` |
| `profiles` | One per user: staff role, company and company role, functions, digest opt-in, calendar token | n/a |
| `entitlements` | Products per company (`watch`, `tracker`, `client_tasks`), status, source (stripe / contract) | n/a |
| `contacts` | Client people who get digests without logging in (compliance contact, plant manager) | fields on tracker `clients` |

Compliance Tracker tables (`0003_tracker.sql`; pilot shapes in [tracker/DATA-SHAPES.md](tracker/DATA-SHAPES.md)):

| Table | Holds |
|---|---|
| `library_standards`, `obligation_templates` | CGM's standards library and recurring obligations (seed: `data/tracker-standards-library.json`) |
| `task_plans` | CGM step-by-step procedures matched to tasks |
| `tasks` | NERC compliance tasks per client, with recurrence, review and evidence; next occurrence created by trigger |
| `client_tasks` | Client Tasks add-on (non-NERC work) |
| `team_tasks` | CGM internal work |
| `chats`, `chat_messages`, `chat_reads` | Channels, DMs, one channel per client; unread markers |
| `activity_log` | Append-only audit log written by triggers on every tracked table; imported pilot history has `source = 'legacy'` |
| `evidence` | Per-task evidence: SharePoint items, uploaded files (Storage bucket `evidence`, one folder per client), links; soft remove ([EVIDENCE.md](EVIDENCE.md)) |
| `legacy_people`, `legacy_snapshots` | Pilot user ids to link to logins; saved copies of records deleted in the pilot ([IMPORT.md](IMPORT.md)) |

Renamed fields from the pilot: `fn` → `functions`, `todoTx` → `todo_tx`, `order_no` and `pos` unchanged. `lib/mapping.ts` converts both ways.

## Access rules

One database serves both products. Who sees what depends on staff role, company role and the company's `entitlements`; the full matrix is in [ACCESS.md](ACCESS.md). It's enforced by row level security and triggers in `0002_platform.sql` and `0003_tracker.sql`, and tested in `tests/rls.test.mjs` against an in-memory Postgres.

Key helpers: `is_staff()`, `can_approve()`, `is_editor()` (Watch review), `my_company()`, `company_has(company, product)` (Tracker includes Watch; Client Tasks needs a live Tracker), `has_product(product)`, `client_can(company, product)`, `has_access()` (Watch content).

Server code that must bypass the rules (Stripe webhook, drafts API, digest send, calendar feed, scheduled jobs) uses `lib/supabase/admin.ts`, which is marked `server-only` so it can't be bundled into the browser. Check the caller before using it.

## Billing

1. The landing page posts to `/api/stripe/checkout`. Signed-out visitors go to sign-in first.
2. Checkout creates a Stripe customer and a placeholder company named `(pending) <email domain>`.
3. The webhook upserts the company's `entitlements` row for the plan's product (status, period end, subscription id) and renames the company from the billing name. The first buyer becomes the company admin.
4. `/api/stripe/portal` sends a company admin to Stripe's portal to change plan, card or cancel. Cancellation flips the entitlement to `canceled` and access ends.
5. The Compliance Tracker and Client Tasks add-on are contract products: a CGM admin sets them on the company (`source = 'contract'`).

Seats are stored but not yet enforced. To add colleagues today, set their `company_id` by hand (SETUP.md step 5). Self-serve team invites are on the roadmap.

## Code map

```
app/                 pages and API routes (see README route table)
components/          WatchView (the Watch UI, also renders the teaser), ReviewQueue, LoginForm, SendDigestButton
lib/types.ts         content types, function and topic lists
lib/watch.ts         date maths, status classification, function filters (ported from the pilot)
lib/mapping.ts       database row <-> content object
lib/content.ts       loads all published content in one call
lib/apply-draft.ts   applies an approved draft to the right table
lib/digest.ts        weekly email HTML, filtered per subscriber
lib/auth.ts          getViewer(): who is signed in and what they can see
middleware.ts        refreshes the sign-in session on each request
supabase/migrations  schema and access rules
scripts/             one-time pilot import
```

## Not built yet

All Compliance Tracker screens, tracker digests, client invitations and seat limits, and the admin screen for products and roles. See the build plan in [HANDOFF.md](HANDOFF.md) §5.
