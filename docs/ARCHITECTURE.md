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

**Team and seats** (`0007_accounts.sql`):
- A company admin invites colleagues from the account page. The invitee signs in with that address, and the sign-in callback calls `accept_invite()`, which puts them in the company.
- `companies.seats` (default 5; CGM admins change it on the Admin page) caps members plus open invites. The database refuses an invite past the cap.
- Invites expire after 14 days. `revoke_invite()` and `remove_member()` are the only ways to revoke an invite or take someone off a company.
- New client users see `/welcome` once (name, functions, Regional Entity, digest) before Watch or the Tracker.
- Invite emails go through `lib/mail.ts`: Resend when configured, the local mail catcher in development. If neither is available, the account page tells the admin to ask the person to sign in.

## Email

All Watch email goes through `lib/mail.ts`: Resend when `RESEND_API_KEY` and `DIGEST_FROM` are real values, otherwise (development only) the local Mailpit catcher.

| Email | Sent by | Gated by the Admin email switch | Unsubscribe |
|---|---|---|---|
| Weekly digest | An editor, from `/admin/digest` | No (sent by hand) | `digest_opt_in`, signed link + one-click header |
| Alerts, **opt-in, off by default** (new FERC approvals, effective dates set or moved, deadlines within 14 days) | Vercel Cron → `/api/jobs/alerts` daily at 13:00 UTC (`vercel.json`, `CRON_SECRET`) | Yes | `alerts_opt_in` (default false), signed link + one-click header |
| Team invites | A company admin's action | No (a person's direct action) | n/a |

- **Unsubscribe links** are HMAC-signed with `EMAIL_LINK_SECRET` (`lib/email-links.ts`). The page asks before acting, so link scanners can't unsubscribe anyone. The `List-Unsubscribe` header does one-click unsubscribe (RFC 8058).
- **What changed:** approving a draft stores the value it replaced in `drafts.previous`. `lib/changes.ts` turns these into the digest's suggested corrections and into alerts. `alert_log` makes sure each alert goes out once.
- **Digest first:** NERC sends its own alerts, and Watch's job is one reviewed weekly digest. Alerts exist only for people who turn them on (OPEN-QUESTIONS 14).
- **Calendar feed:** `lib/ical.ts` builds it. UIDs depend only on the entry, label and date, lines are folded at 75 octets, and the tests parse it with ical.js.

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
