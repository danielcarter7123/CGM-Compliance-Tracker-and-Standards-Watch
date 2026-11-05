# Compliance Tracker: functional spec (from the pilot artifact)

Source: "NERC Compliance Tracker (Sandbox Copy)" artifact `DjexDTiLux4WG2xDNwpvLW`, version of Nov 5, 2026 (2,263 lines, all read). A sanitized copy of the page is at `docs/reference/pilot-tracker-page.html`; it contains code and placeholders only, no client data. Field-level shapes are in `DATA-SHAPES.md`.

**Live tracker vs this copy.** The live NERC Compliance Tracker (artifact `685Z4nk6RAxhHorCaBXnsc`, snapshot `docs/reference/live-tracker-page.html`) holds the current, accurate client data, and it is what gets imported (`docs/IMPORT.md`). This Sandbox Copy holds the newer features this spec describes. Live lacks the review step, task plans, Client Tasks, messages and the embedded Watch. It adds `assigneeEmail` on tasks and `ownerEmail` on team tasks, which drive weekday reminder emails to those people.

Where this spec says **not implemented in the artifact**, the page only implies the behavior (a checkbox, a sentence of copy) and has no code for it.

## 1. What it is and who uses it

An operator console for **CGM Consulting Group staff** to run NERC compliance programs for their clients: recurring and one-time compliance tasks per client, a standards library with obligation templates, internal team work, client conversations, and an audit trail. It is a single shared workspace: every person with access sees every client.

### Access model as implemented

The artifact has no roles of its own. Access comes from the claude.ai sharing level of the page:

| Platform level | In the tracker | Code |
|---|---|---|
| Owner (Dan) and anyone shared with edit ("Contributor") access | Full read and write of **everything**: all clients, tasks, team tasks, standards, plans, chats, activity log. Can approve tasks, delete clients, restore or revert. | `user.can("data.write") !== false` |
| Viewer | Read-only everything (banner: "You have view-only access. Ask the tracker owner for Contributor access…"). Forms disabled, no New buttons, can't send messages. | `S.readOnly = true` |
| No `db` (opened outside claude.ai) | "Offline" banner; nothing loads | `S.offline` |

Consequences to carry into the app:

- **No per-client isolation.** Anyone with access sees all clients' data. The chat panel says so: "Until per-user logins are set up, anyone with access to the tracker could technically read every conversation, direct messages included."
- **Client users do not use the tracker.** Clients are records, not users. Client people appear only as names and emails on the client record (compliance contact, plant manager) and as free-text `assignee` strings on tasks. Clients interact through the separate **CGM Compliance Reporting** portal (§3.8) and through digest emails (§6).
- **"Project Manager" is a CGM staff member** stored as name and email on each client (`pmName`, `pmEmail`), not as a user id. The "Approve & close" step is described as a project manager action, but **any writer can approve**: there is no role check.
- **The activity log is not tamper-proof.** The page says contributors can technically alter it.
- **People** are platform user ids. Names and avatars are resolved per viewer through the `user` capability (search, profiles). Team-task owners and collaborators and chat members are user ids; NERC-task assignees are free text.

### Product tiers implied

- **Client Tasks add-on:** a per-client "Premium add-on" flag (`clients.workspace`). It turns on a separate task list for the client's non-NERC work. CGM staff manage it, and it is visible to everyone with access.
- **Standards Watch:** shown first in every browser session (§3.1).

## 2. Layout

- A sticky header has the brand "NERC Compliance Tracker" (with a "SANDBOX COPY" chip in this copy), plus:
  - a **Messages** button with an unread count;
  - a **Reminders** button with a count of overdue tasks and tasks inside their reminder window;
  - a **New task** button.
- Tabs: **Standards Watch** · Dashboard · Tasks · Team Tasks · Standards · Clients · Reporting Forms · Audit Worksheets · Activity Log. Messages is reached from the header button.
- The last tab and the Clients sub-tab are remembered in localStorage (`nct_view`, `nct_csub`).
- Detail editing happens in a right-side drawer. Destructive actions use an inline confirm, or a click-twice "armed" button.
- Light and dark themes come from CSS tokens; the console palette differs from Watch (IBM Plex fonts, blue accent).
- Live updates: every collection is a realtime subscription. Due states re-evaluate when the day changes (checked every 60 s).

## 3. Views

### 3.1 Standards Watch gate

- The Watch page is embedded in a shadow DOM (`#watchHost`, from `<template id="watchTpl">`).
- On each new browser session, `body.intro` shows only the Watch and hides the tracker. This is set unless `sessionStorage["nct_intro_done"]` exists.
- The sticky bar reads "Review the latest standards changes, then continue to your compliance tracker." Its button **Next: Compliance Tracker →** hides the Watch and sets the session flag.
- The **Standards Watch** tab brings it back.
- The embedded copy uses `MODE = "embedded"`:
  - it reads only `watch/content` in the tracker's own store, which the weekday sync task copies from the master;
  - it has no review queue;
  - the theme follows the page.
- Behavior is otherwise identical to the standalone Watch (docs/HANDOFF.md §4).

### 3.2 Dashboard

- **Stat strip** (each tile is clickable and jumps to Tasks with that filter):
  - Overdue;
  - Due ≤ 30 days (excludes Pending review);
  - Pending review, with a sub-count of "awaiting report";
  - Open tasks, "across N clients";
  - Closed this quarter (status `done` with `completedAt` ≥ the first day of the current calendar quarter).
- A warning banner appears when open tasks have no due date: "N tasks need a due date. Reminders and digest emails skip tasks without one."
- An empty state appears when there are no clients ("Start by adding a client").
- **Reminders panel:** tasks that are overdue or inside a reminder window, sorted by due date.
- **By client table:** Open, Reminders and Overdue counts, sorted by overdue then reminders. Clicking a row opens Tasks filtered to that client.
- **Pending review panel:** tasks in `review`, oldest performed first.
- **Upcoming schedule:** the next 40 open tasks outside their reminder windows, grouped by month.

### 3.3 Tasks (NERC compliance tasks)

- **Toolbar:**
  - search over title, standard, requirement, facility, assignee, notes and client name;
  - status filter: All open · Reminders active · Needs due date · Pending review · Report not posted · Overdue · Due ≤ 30 days · Completed · All tasks;
  - client, standard and function filters (function means the standard applies to that function);
  - **Export CSV** and **New task**.
- **Columns:** Due · Task · Standard (links to the standard document) + requirement · Client / facility · Assignee · Evidence (a link or text) · Repeats · Status pill.
- **Sort:** by due date, with no date last. Completed tasks sort by completion date, newest first.
- **Task drawer fields:**
  - Task; Client; Facility / unit; Standard (with an "Open <code-ver> on nerc.com" link); Requirement; Due date;
  - Assignee (free text);
  - "Remind me before the due date" checkboxes for 90/60/30/14/7/1 days, with the next reminder date shown;
  - "Repeats every" N calendar months / calendar years / days (0 = one-time);
  - "Repeat from": Previous due date (fixed schedule) or Completion date (rolling interval);
  - Status: Open / In progress / Pending review / Complete;
  - Evidence location: paste the SharePoint link to the dated evidence. An https link counts as the report.
  - Notes.
- **Drawer extras:**
  - a **Task plan** bar (§3.4);
  - **Discuss**, which opens the client's chat channel with the task attached;
  - **Outlook reminders** (§5);
  - a Review callout (performed date and by whom, approved date and by whom);
  - **Delete**, with confirmation.
- **Validation:**
  - title is required;
  - due date is required on save;
  - the performed date can't be in the future;
  - saving a next-due date on or before the completion date needs confirmation.

#### Lifecycle

| State (derived) | Rule |
|---|---|
| Complete | status `done` |
| Pending review | status `review`. Shown as "report pending" (red dashed, doc icon) until `evidence` is an https link, then "awaiting approval". |
| Needs due date | no `dueDate` |
| Overdue | due date passed |
| Reminder active | within the largest selected reminder offset |
| In progress / Scheduled | otherwise |

Actions:

1. **Mark performed.**
   - This is a two-step button: it first reveals "Date performed", then "Confirm performed".
   - The status becomes `review`, and the page records `completedAt` = date performed and `performedBy` = the current user.
   - Performed counts for compliance. If the task repeats and has no `nextId` yet, the **next occurrence is created right away**:
     - its due date is the previous due date + interval (basis `due`), or the performed date + interval (basis `done`);
     - calendar-year units fall due Dec 31 of the year N years later;
     - the calculated date can be overridden in the drawer ("Use calculated date" resets it).
   - The new task copies title, client, facility, standard, requirement, assignee, reminders and recur, with status `open`, `prevId` set and the evidence cleared. The current task gets `nextId`.
2. **Approve & close** (when `review`):
   - sets `done`, `reviewedAt` and `reviewedBy`;
   - warns, with a confirm, if no report link is posted.
3. **Send back** (when `review`): status returns to `open` and the review fields are cleared.
4. **Changing the completion date** of a performed task with a completion-based interval offers to move the next occurrence's due date to match.
5. **Marking complete directly** from Open (skipping review) is possible through the Status select. It sets `reviewedAt` and `reviewedBy`, and the log calls it "completed".

### 3.4 Task plans (side panel in the task drawer)

- Step-by-step work instructions shown beside a task. Plans are stored in `taskPlans`.
- **Matching:** a task uses its own `planId` when set (`"none"` = no plan). Otherwise it uses the first plan whose `matches` contains `"<standard>|<title>"` (lowercased), so new tasks with the same name pick the plan up automatically.
- **Plan format:** one step per line, auto-numbered; `## ` section, `### ` subsection, `- ` reference bullet; https links become clickable.
- **Actions:**
  - View, which shows "Used by N tasks";
  - **Copy plan**, as plain text for a work order or email;
  - **Edit plan**: changes apply to every task using it;
  - **Change plan**: a picker grouped by standard, with scope "Every '<title>' task" or "This task only";
  - **Write a new plan**: optionally "Use for every '<title>' task".
- Stored plans came from a "CGM Master NERC Task Plans List". This is CGM reference content and worth migrating as seed data, but it was not exported here.

### 3.5 Team Tasks (internal CGM work)

- **Stat strip:**
  - My open tasks, with summed estimated hours;
  - Past anticipated date;
  - Team open tasks, with hours;
  - Completed this month.
- **Filters:**
  - scope: Assigned to me or collaborating / Assigned to me / Everyone / Unassigned;
  - status: All open / Past anticipated date / each status / All statuses;
  - client: all, Internal (no client), or a specific client;
  - search.
- **Columns:** Task (up to 3 links, 2-line description) · Client ("Internal" or "(removed client)") · Assigned to (avatar) · Collaborators · Est. hrs · Anticipated · Actual · Status ("· late" when past the anticipated date). A footer sums the hours.
- **Drawer:**
  - Task; Description; Links (label + https URL; "SharePoint folder, Teams channel, OneDrive document or meeting notes"); Client;
  - Assigned to: a person picker that searches platform users, plus "Assign to me";
  - Collaborators: multi-select. Adding someone doesn't notify them.
  - Anticipated completion; Actual completion (not in the future; auto-set when marked done); Estimated hours (0.25 steps); Status;
  - Created on/by;
  - Mark complete, Delete. Export CSV.

### 3.6 Standards library

- **Table:** Standard (code-version link) · Title · Applies to · Recurring obligations (template count) · Open tasks. Filtered by search, family and function.
- A footer note says versions reflect the library as loaded in October 2026 and should be confirmed against NERC's U.S. effective dates.
- Clicking a row **expands** it:
  - notes;
  - "Edit standard details";
  - open link; inline **Version** edit; inline **Standard link** edit with "Reset to nerc.com default". The custom link is used by every task, the digests and the Outlook reminders.
  - the template list with **Create task**, which prefills a task:
    - due date = today + interval;
    - reminders [30,7], or [7,1] for day-based templates.
  - **Create all recurring tasks for client**: a bulk action over templates with n>0, with due dates one interval from today. The note reads "adjust to the last completed date".
- **New standard / edit:**
  - number validated as `^[A-Z]{2,4}-[A-Z0-9.\-]+$` and unique;
  - version and title required;
  - family auto-filled from the number;
  - Applies to: GO, GOP, GO-2, GOP-2, TO;
  - optional https link; notes.
  - The number is locked after creation. Delete is disabled while tasks reference the standard.
- **Recurrence settings:** a modal listing every recurring template, with "Repeat from" (Due date or Completion).
  - Rows with no saved basis are pre-filled from a built-in suggestion table and marked SUGGESTED, with a banner asking CGM to confirm each one.
  - An option also updates open repeating tasks created from each template; matching is by title+standard+requirement.
  - It shows a MIXED chip when matching tasks differ.
  - Current due dates never change.

### 3.7 Clients

There are two sub-tabs: **Client directory** and **Client Tasks** (marked ADD-ON).

**Directory table columns:**

- Entity, with chips (SAMPLE, CLIENT TASKS), a SharePoint link, and the contact with a DIGEST chip;
- NCR ID · Registered (date) · Region · Registered as (functions, plus mapped entities);
- Project Manager (+ email, DIGEST) · Plant Manager (+ email, DIGEST) · Facilities.

"Remove sample client and tasks" appears when sample data exists.

**Client drawer:**

- Registered entity name; NCR ID; Regional Entity (MRO, NPCC, RF, SERC, Texas RE, WECC); NERC Registration Date;
- Registered functions (GO, GOP, GO-2, GOP-2, TO);
- **Functionally mapped NERC entities**: free-text entity name / NCR ID for RC, BA, TOP, TP, PC, interconnecting TO, TSP, interconnected GO(s) and GOP(s). The rows shown depend on the checked functions, and each row shows which standards drive the relationship.
- Facilities;
- Primary compliance contact + email + "weekday digest" checkbox;
- Project Manager + email + "weekday digest (one email covering every client they manage)";
- Plant Manager + email + "weekday client digest";
- Add-ons: Client Tasks;
- SharePoint folder; Notes.

**Task set logic** (a tracker-wide "template by example"):

- A **new client** gets the option "Assign all N tracker tasks to this client". This copies one representative of every distinct open task in the tracker (keyed by title|standard|requirement; non-sample) with no due date. The assignee is the contact name, `copiedFrom` is set, and the view then jumps to Tasks › Needs due date.
- An **existing client** shows "Missing tasks: N tasks are assigned to other clients but not to this one" with an **Add N missing tasks** button.

**Delete client** deletes all of its tasks and client tasks too. A snapshot is kept so it can be restored.

**Client Tasks (add-on)**

- Only clients with `workspace: true` appear. "Turn on Client Tasks" offers a picker of the other clients.
- **Stat strip:** Overdue, Due ≤ 30 days, Open, Completed this month.
- **Filters:** client, status, category, responsible party, search.
- **Columns:** Due · Task · Client · Category · Assigned to (+ party) · Priority (high in red) · Repeats · Status.
- **Drawer fields:** Task; Client; Category (pick or type); Description; Assigned to (free text); Responsible party (Client staff / Contractor / vendor / CGM / Agency / regulator / Other); Due date; Priority; Status; Date completed; Repeats every N months/years/days; Links; Notes. The drawer also has Discuss, Mark complete and Delete.
- **Completing** a repeating task creates the next one from the **due date**. There is no basis option and no review step.
- Client tasks **don't appear on the Dashboard, in reminders or in digest emails**. They can be exported to CSV.

### 3.8 Reporting Forms

- An information page with a button to the separate **CGM Compliance Reporting** portal (another claude.ai artifact). In this copy, a warning says the button opens the live portal.
- It lists 12 ready forms with their standards:
  - Protection System Misoperation Report (PRC-004-6 / MIDAS)
  - Event Report (EOP-004-4)
  - Equipment Change Notice
  - Cold Weather Data
  - Transient Cyber Assets and Removable Media Log
  - Weekly Compliance Checklist
  - Vendor Electronic Access Authorization
  - Cyber Security Incident Report
  - OT Support Request
  - CIP Senior Manager Designation and Delegates Identification
  - BES Cyber System Identification and Classification
  - Protection System Settings Development
- Access model as described:
  - client contacts are invited to the portal as Editors;
  - each client sees only its own submissions; the owner sees all;
  - there is a form builder (short text, long text, number, date, time, date-time, choose one, choose many, yes/no, link; hide a form);
  - new submissions appear in the owner's weekday digest.
- **The portal is a separate artifact and is not part of this spec.** Its per-client submission isolation is the closest thing to client-facing access in the current system.

### 3.9 Audit Worksheets

- An information page with a button to the separate **RSAW Workbench** artifact (live). It describes 50 GO/GOP/TO standards and 187 requirements, including the Texas RE and WECC regionals.
- **Findings:** No Finding / Possible Non-Compliance / Area of Concern / Recommendation / Not Applicable.
- **Exports:** CSV, an RSAW-style Word report, and a JSON backup.
- A table of non-sample clients (name, NCR, region, functions) helps match engagements.
- Guidance: turn PNC and AOC findings into Tasks. **That conversion is manual and not implemented in the artifact.**

### 3.10 Messages

- **Conversation list:**
  - **CGM team**: "General" (always present) plus named channels;
  - **Direct messages**: platform users, found by people search;
  - **Clients**: one channel per non-sample client, created on first message.
- Unread state is computed from `lastAt`/`lastBy` and per-user read markers, which are private to each user. The badge count also appears in the page title.
- **Thread:**
  - grouped by day, consecutive messages collapsed;
  - "Load earlier messages" pages 30 day-documents at a time;
  - https links are clickable;
  - a user can delete their own messages (soft delete, "Message deleted").
- **Composer:** Enter sends, Shift+Enter adds a newline, 4000-character limit, drafts kept per conversation. **Link task** attaches a NERC task or client task as a clickable chip that opens its drawer.
- "Discuss" from a task opens the client's channel, or General if there is no client, with the task attached.
- **No notifications.** There are no emails or pushes for messages.

### 3.11 Activity Log

- **Filters:** date range (24 h, 7/30/90/365 days, all), person, record type (Tasks, Team tasks, Client tasks, Clients, Standards, Outlook reminders, Exports), client, search.
- Up to 200 rows are shown, with "Show more".
- **Row:** When · Who (avatar + name) · Action tag · Record type · Record label · Client · Details (note, then field changes with old values struck through), plus RESTORED/REVERTED tags.
- **Restore** (deleted task, client with its tasks and client tasks, team task, standard, client task) recreates the record from `activitySnapshots`.
- **Revert** (updated, completed, performed or approved, when `raw` is present) sets fields back to their old values. It warns "Revert anyway? Edited since" when the record has changed since. Both actions are logged.
- Export CSV puts one row per field change.
- **Coverage:** only changes made through the page. Bulk edits made outside it, for example by Claude on request, are not recorded.

### 3.12 Reminders button

Opens Tasks filtered to "Reminders active" (overdue plus inside the reminder window).

## 4. Business rules (summary)

- The function set in the tracker is **GO, GOP, GO-2, GOP-2, TO**. GO-2 and GOP-2 are Category 2 IBR registrations. Watch uses GO, GOP, TO, TOP, TP, PC. The unified app needs one function vocabulary that covers both.
- Reminder offsets: 90, 60, 30, 14, 7, 1 days. Defaults: [30,7], or [7,1] for day-interval templates.
- Recurrence units:
  - `m` = calendar months (same day of month, clamped to month end);
  - `y` = calendar years, due **Dec 31** of the year N years after the base year;
  - `d` = days.
- Recurrence basis:
  - `due` (fixed schedule from the previous due date);
  - `done` (rolling from the date performed).
  - The built-in suggestion table marks 29 CIP, MOD, PRC and CIP-014 obligations as `done`. These suggestions are unconfirmed.
- Next occurrence is created **once per task** (guarded by `nextId`), at the moment the task becomes performed (`review`) or `done`.
- Evidence: an https link in `evidence` counts as "report posted". The link usually points to a dated SharePoint folder; files are not stored in the tracker.
- Standard links default to `https://www.nerc.com/pa/Stand/Reliability%20Standards/<CODE>-<VERSION>.pdf`, overridable per standard.
- Validation: emails match `x@y.z`; every link must be `https://`; future completion dates are refused.
- Storage-full error: "The tracker's storage is full. Remove completed or sample records…" (a platform limit).

## 5. Integrations

| Integration | What it does | Status in artifact |
|---|---|---|
| Microsoft 365 `outlook_create_event` (through the artifact `mcp` capability) | "Add reminders to Outlook". It creates a 15-minute event at 08:00 local time on each future reminder date and on the due date. The subject reads "Reminder (Nd): " or "DUE TODAY: " + standard + title + client. The body lists task, client, facility, standard and requirement, due date, assignee and the standard link. Importance is high when ≤7 days out. It records `tasks.outlook` and logs the action. Errors map to reconnect or policy messages. | Code present; **disabled in this copy** (`SANDBOX = true`) |
| Downloads (`downloads.save`) | CSV exports: tasks (`nerc-compliance-tasks-<date>.csv`), team tasks, client tasks, activity log | Implemented |
| User directory (`user` capability: `id`, `can`, `search`, `profiles`, `me`) | People search, names, avatars, write permission | Implemented |
| SharePoint | Links only: the client folder and per-task evidence links. No API use. | Links only |
| CGM Compliance Reporting portal | Separate claude.ai artifact (client form submissions) | External |
| RSAW Workbench | Separate claude.ai artifact (mock audits) | External |
| nerc.com | Standard PDF links | Links only |
| Standards Watch content | `watch/content`, written by an external weekday sync task | Read-only in tracker |

## 6. Emails and digests

The client record holds three digest opt-ins:

- the compliance contact's weekday digest of their overdue and coming-due tasks (default on);
- the Project Manager's weekday digest covering all of the PM's clients (default on);
- the Plant Manager's weekday client digest (default off).

The dashboard banner says digests skip tasks without due dates. The Reporting Forms page says new submissions appear in the owner's weekday digest.

**Sending is not implemented in the artifact.** The page only stores the flags; delivery presumably runs from a scheduled task outside it (not inspected). The app must build:

- digest generation and content (overdue, due ≤ N days, pending review and missing report, by client);
- schedule (weekdays);
- recipients (contact and plant manager per client; PM across clients);
- unsubscribe.

Client Tasks are excluded from digests.

## 7. Sample and sandbox-only behavior

- `SANDBOX = true`:
  - a warning banner;
  - "SANDBOX COPY" chip;
  - Outlook disabled;
  - Reporting Forms and Audit Worksheets warn that they open live portals.
- Records with `sample: true` show a SAMPLE chip and can be bulk-removed. They are excluded from task-set copying, the client chat list and the RSAW table.
- **The "sandbox" store nonetheless contains real client data**, apparently copied from the live tracker.

## 8. Gaps to design for in the app

1. **Per-client data isolation** (row level security by client), and an explicit **CGM staff vs client user** model. Today there are no client logins and no isolation.
2. **Real roles:** CGM admin, CGM project manager (approve), CGM staff, client admin, client user, read-only auditor. "Approve & close" should require the PM or admin role.
3. **Assignees** should become user references (with free-text fallback for people without accounts).
4. **Digests and reminders** must be sent server-side (§6). Outlook events could become per-user iCal feeds or Microsoft Graph calls.
5. **Evidence storage:** links only today. Decide between links only and file storage (with encryption and retention) before building. CIP evidence may include BES Cyber System Information.
6. **Tamper-evident audit log:** append-only table; restore and revert as new events.
7. **Chat privacy:** DMs and client channels must be visible only to their members and the client's users.
8. Unify the **function vocabulary** and the **standards library** with Watch's `standards` table, since the tracker library is keyed by code without a version and Watch items are keyed by versioned standard.
