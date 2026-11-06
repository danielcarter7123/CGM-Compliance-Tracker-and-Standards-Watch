# Access by subscription

One account, separate apps (CGM Workspace, decision 17). What a person can open depends on **who they are** (CGM staff or a client user) and **what their company has bought**. The database enforces all of this (row level security in `supabase/migrations/0002_platform.sql` and `0003_tracker.sql`), and `tests/rls.test.mjs` checks each rule.

## Products a client company can hold

| Product | What it is | How it's sold | Includes |
|---|---|---|---|
| `watch` | Standards Watch: reviewed standards changes, weekly digest, calendar feed | Self-serve through Stripe Checkout | n/a |
| `tracker` | Compliance Tracker: the client's NERC tasks, run by CGM, with client visibility | By agreement; a CGM admin switches it on (`source = 'contract'`) | Nothing else. Watch is separate |
| `client_tasks` | Client Tasks add-on: the client's non-NERC task list | By agreement, on top of `tracker` | Works only while `tracker` is live |
| `powerworks` | CGM Powerworks: asset management (separate app; this project only shows its launcher tile) | By agreement; a CGM admin switches it on | n/a |

These live in `entitlements(company_id, product, status, source, current_period_end)`. Only `active` and `trialing` grant access. Ending the Tracker also ends the Client Tasks add-on.

## People

| Who | Set by | Notes |
|---|---|---|
| CGM admin | `profiles.staff_role = 'admin'` | Everything, including Standards Watch review, products, roles |
| CGM project manager | `staff_role = 'pm'` | All clients; approves performed tasks; edits the library and clients |
| CGM staff | `staff_role = 'staff'` | All clients' tasks and internal work; can't approve or change products |
| Client company admin | `company_role = 'admin'` | Their company's users and billing (the first buyer becomes admin) |
| Client member | `company_role = 'member'` | Their company's data, per the company's products |

Nobody can raise their own role. Only CGM admins set staff roles and products. Company admins can change `company_role` for people in their own company, invite colleagues (within the company's seats), and remove them (`remove_member()`), but never themselves. Invitees join by signing in with the invited address (`accept_invite()`).

## The matrix

✓ = full use. Blank = no access (the rows don't exist for them).

| Area | No plan | Watch client | Tracker client | + Client Tasks | CGM staff | CGM PM | CGM admin |
|---|---|---|---|---|---|---|---|
| Standards Watch page | teaser | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Weekly digest, calendar feed | | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Watch review queue, publish, send digest | | | | | | | ✓ |
| Own company's NERC tasks: view | | | ✓ | ✓ | all clients | all clients | all clients |
| Tasks: mark performed, post evidence link, add notes | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| Tasks: create, edit, reschedule, delete | | | | | ✓ | ✓ | ✓ |
| Tasks: approve and close | | | | | | ✓ | ✓ |
| Client Tasks (non-NERC list) | | | | ✓ own | all | all | all |
| Evidence on own tasks: add (upload, pick from SharePoint, link), see, remove own | | | ✓ | ✓ | all clients | all clients | all clients |
| Standards library: read | | | ✓ | ✓ | ✓ | ✓ | ✓ |
| Standards library: edit, recurrence settings | | | | | | ✓ | ✓ |
| Task plans (CGM procedures) | | | | | ✓ | ✓ | ✓ |
| Team tasks (CGM internal) | | | | | ✓ | ✓ | ✓ |
| Messages: own company's channel | | | ✓ | ✓ | all client channels | all | all |
| Messages: CGM channels | | | | | ✓ | ✓ | ✓ |
| Messages: direct | | | | | members only | members only | members only |
| Activity log | | | own company's task and client-task history | same | ✓ | ✓ | ✓ |
| Activity log: restore and revert | | | | | ✓ | ✓ | ✓ |
| Client record (company details) | | read own | read own | read own | read all | edit | edit, delete |
| Contacts (digest recipients) | | | admin reads own | admin reads own | ✓ | ✓ | ✓ |
| Products and roles | | read own | read own | read own | read | read | ✓ |
| Billing (Stripe portal) | | company admin | company admin | company admin | | | |
| App switches (automated emails on/off) | | | | | read | read | ✓ |
| Team: invite, revoke, change role, remove (own company) | | company admin | company admin | company admin | read | ✓ any company (Clients › People) | ✓ any company (Clients › People) |
| Seats per company | | read own | read own | read own | read | read | ✓ |

## Rules worth knowing

- **The Clients directory** (`/tracker/clients`, CGM staff) lists Tracker clients: companies that have or had the Tracker, plus new clients with no products yet. Watch-only subscribers aren't listed. A PM can add a client, but it shows "TRACKER OFF" until a CGM admin turns the Tracker on under Add-ons.

- **Client isolation:** every tracker row carries `company_id`. A client user sees a row only when it's their company and the company holds the product. There's no way to query another company's rows.
- **Client task edits are narrow:** a trigger (`guard_task_update`) lets client users change only `status` (open → in progress → performed), `evidence` and `notes`. It sets who performed it and when. Anything else is refused with a clear message.
- **Approval needs a PM or admin**, also enforced by the trigger, including "mark complete" directly.
- **Recurrence happens in the database:** when a task becomes performed or done, `spawn_next_occurrence` creates the next one once, using the pilot's date rules. A client marking a task performed therefore schedules the next one without being able to create tasks themselves.
- **The audit log is append-only.** Triggers write it, and nobody can insert, edit or delete rows directly. Restore and revert (, ) are new changes that log themselves as "restored" / "reverted". They run as the person, so the record's own write rules apply: restoring a client needs a CGM admin, because products are admin-only.
- **Staff can open everything because their role grants it**, not because of an entitlement.

## Decisions

Confirmed by Dan (Nov 5, 2026):

1. Client users can see and update their own tasks (mark performed, evidence, notes).
2. Only PMs and admins approve.
3. CGM staff see all clients.

Defaults still to confirm (each is one policy or trigger to change):
- Task plans are CGM-only know-how; clients don't see them.
- Client members don't see colleagues; company admins do.
- The Tracker is sold by contract, not through Stripe.
- The Tracker includes Standards Watch.
- Evidence: anyone who can see a task can add evidence to it. Removal is soft and done by whoever added it or by staff; hard delete is CGM admins only. Uploaded files sit in a private bucket, one folder per client (see `docs/EVIDENCE.md`).
