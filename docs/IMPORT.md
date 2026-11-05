# Bringing the live tracker's data across

All of the live tracker's data moves into the app as it is, with no re-entry: every client, task, team task, standard, history entry and saved copy of a deleted record. Nothing is retyped.

## What goes where

| Live tracker (claude.ai) | App table | Notes |
|---|---|---|
| `clients` | `companies` (+ `contacts`, `entitlements`) | Compliance contact, PM and plant manager become `contacts` with their digest settings. Every non-sample client gets an active **Tracker** entitlement; a client with the Client Tasks flag also gets the add-on. |
| `standards` (with templates) | `library_standards`, `obligation_templates` | The live library replaces the seed library. Repeat-from settings stay confirmed where the tracker had them. |
| `tasks` | `tasks` | Includes assignee email, Outlook record, recurrence chain (prev/next), "copied from" links. |
| `teamTasks` | `team_tasks` | Owners and collaborators are pilot user ids, kept in `owner_legacy` / `collaborators_legacy` until linked to logins. |
| `activity` (one document per day) | `activity_log` with `source = 'legacy'` | One row per entry; the full original entry is in `legacy`. |
| `activitySnapshots` | `legacy_snapshots` | Saved copies of deleted records, for "Restore". |
| `people` (names of CGM users, in the export) | `legacy_people` | Link each one to a real login with `link_legacy_person()`. |
| `clientTasks`, `taskPlans` (sandbox only) | `client_tasks`, `task_plans` | Imported if present in an export. |

**Nothing is dropped.** Every imported row keeps its original document in a `legacy` column. A value that can't be mapped (an unknown region, a malformed email, a future completion date, a task whose client was deleted) is left blank or put under "Unassigned (imported)". The original stays in `legacy`, and the import report lists each case.

## Steps

1. **Export.** Open the live NERC Compliance Tracker in claude.ai and click **Export all data** in the header. Only Editors see the button. It downloads `cgm-tracker-full-export-YYYY-MM-DD.json` and records the export in the tracker's Activity Log. The export also checks its counts against what the page shows and warns about any mismatch.
2. **Keep it private.** Put the file in `data/private/` in this project. That folder is git-ignored. Never commit the file, email it, or paste it into a chat or ticket.
3. **Build the import.**

   ```bash
   npm run import:tracker -- data/private/cgm-tracker-full-export-YYYY-MM-DD.json
   ```

   This writes `data/private/import-tracker.sql` and `import-tracker-report.json`, and prints in/out counts per collection plus any warnings. Read the warnings.
4. **Dry run locally.** With `supabase start` and all migrations applied:

   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f data/private/import-tracker.sql
   ```

   Sign in as a CGM admin and spot-check a few clients against the live tracker.
5. **Production.**
   - Take a Supabase backup first.
   - Then run the same file with `SUPABASE_DB_URL` (Project Settings → Database → connection string, session mode).
   - The SQL is one transaction: all of it lands, or none of it does. It refuses to run a second time into a database that already has imported clients.
6. **Link people.** As each CGM colleague signs in to the app, a CGM admin runs `select link_legacy_person('<pilot id>', '<profile id>')`. Milestone T9 adds a screen for this. This fills team-task owners and collaborators; history entries resolve names through `legacy_people`.
7. **Set the PM on each client.** Once PMs have logins, set `companies.pm_id`. Their name and email are already in `contacts` (`kind = 'pm'`).

## Timing

The live tracker keeps changing until cutover, so export **on the cutover day**:

1. Ask the team to pause edits for an hour.
2. Export, import and spot-check.
3. Switch the team to the app.

Earlier exports are fine for dry runs. Make each real run against a clean database.

## Sandbox copy

The Sandbox Copy has newer features but older data. Its task plans (the "CGM Master NERC Task Plans List") exist only there. To bring them across, add the same Export button to the sandbox, then run the importer on that file with only `taskPlans` kept. Plans don't conflict with live data.

## Tested

`tests/import.test.ts` runs the importer on a fake export shaped exactly like the real one, inside an in-memory Postgres with every migration. It checks:

- counts in and out;
- tricky text (quotes, `$$`);
- recurrence chains;
- unknown standards, deleted clients and bad emails being kept and reported;
- no audit-log noise or extra occurrences from the import itself;
- the refusal to import twice;
- normal rules applying to imported tasks afterwards.
