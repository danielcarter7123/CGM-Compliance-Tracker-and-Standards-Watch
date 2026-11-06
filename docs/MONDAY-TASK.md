# Moving the Monday task to the app

> **Now there are two drafters.** The app has its own weekly drafting job (`lib/watch-job.ts`). Vercel Cron runs it Mondays at 17:00 UTC (10 a.m. Mountain, 11 a.m. in summer), after the NERC newsletter, which sometimes arrives around 9 a.m., and after the Monday task's 9:47 AM Mountain run. An editor can also start it from `/admin/review` with "Run it now". Drafts the Monday task already queued show as pending, so the job skips them.
>
> - **What it reads:** NERC, FERC, Federal Register and Regional Entity sites (web search and fetch limited to those domains). It doesn't read Outlook, so the emailed newsletter remains the Monday task's job.
> - **No duplicates:** both write ids as `<date>-<section>-<key>`, and the API ignores a repeated id, so whichever runs second can't queue a duplicate. The Monday task's `GET /api/drafts` also shows the job's drafts as pending.
> - **Turning the Monday task off:** once the job has run well for a few weeks, Dan can turn it off or keep it for the email newsletter only.


Today the scheduled task "Standards Watch Monday drafts" (Mondays 9:47 AM Mountain) reads the NERC newsletter in Outlook, checks the NERC and FERC sites as backup, and writes drafts into the pilot artifact's `watch_drafts` collection. You approve them on the pilot page.

When the app is live, only the destination changes. The sources, the read-only Outlook rule and the draft shape stay the same.

## What changes

| | Pilot | App |
|---|---|---|
| Reads current state | Artifact store `watch/content` | `GET /api/drafts` |
| Writes drafts | Artifact store `watch_drafts` | `POST /api/drafts` |
| Where you review | Pilot page, editor panel | `/admin/review` |
| After approving | Daily sync copies to the tracker | Digest from `/admin/digest` |

## Draft shape (unchanged)

```json
{
  "drafts": [
    {
      "id": "2026-11-02-eop-004-5",
      "section": "items",
      "op": "upsert",
      "key": "eop-004-5",
      "label": "EOP-004-5 effective date confirmed",
      "reason": "NERC weekly update of Oct 30 lists the effective date.",
      "refs": ["https://www.nerc.com/..."],
      "value": { "std": "EOP-004-5", "title": "...", "fn": ["GO","GOP","TO","TOP"], "topic": "ops", "effective": "2027-04-01" },
      "createdBy": "Monday draft task"
    }
  ]
}
```

- `section`: `items`, `deadlines`, `activity`, `sources` or `week`
- `op`: `upsert` (needs `value`) or `remove`
- `id` must be unique; re-posting the same id is ignored, so a rerun can't create duplicates
- Up to 100 drafts per request

## Steps

1. Store the token where the task can use it. The token must not be pasted into the task's prompt in plain text if others can see the task. Use the hosting environment's secret storage or a connector with its own credentials. If neither is available, keep the token in the prompt and rotate it whenever the task is shared or edited by someone else.
2. Ask Claude to update the scheduled task's prompt: replace the "read the store / write `watch_drafts`" steps with

   ```
   curl -s https://<your domain>/api/drafts -H "Authorization: Bearer $DRAFTS_API_TOKEN"
   curl -s -X POST https://<your domain>/api/drafts -H "Authorization: Bearer $DRAFTS_API_TOKEN" \
        -H "Content-Type: application/json" -d @drafts.json
   ```

   Keep every other instruction, including: Outlook is search and read only; never send, draft, forward, move, label, flag, delete or reply to email, or create calendar events.
3. Run it once by hand and check that `/admin/review` shows the drafts.
4. Turn off the daily pilot-to-tracker sync task once the tracker reads from the app instead.

## Rotating the token

Generate a new one (`openssl rand -hex 32`), update it in Vercel and redeploy, then update the task. The old token stops working on the redeploy.
