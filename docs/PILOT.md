# Pilot and app side by side

For the test weeks the pilot keeps running exactly as it does now. The app is built and tested in parallel and takes over only when it's ready.

## What keeps running

- **Standards Watch page** (artifact): the editor panel where you approve Monday drafts.
- **Monday drafts task**: Mondays 9:47 AM Mountain; Outlook newsletter first, web as backup.
- **Daily sync task**: weekdays 5:43 PM Mountain; copies approved content into the Compliance Tracker copy's Watch tab.

## Keeping the app current during the test

After you approve each Monday's drafts in the pilot, refresh the app's data from the pilot:

1. Ask Claude to export the Watch page's `watch/content` document to `data/pilot-content.json`.
2. Run `npm run import:pilot`. Rows are upserted, so it's safe to repeat.

This keeps both showing the same thing while you compare them.

## Suggested test plan

| Week | Focus |
|---|---|
| 1 | Set up accounts, run locally, import, sign in as editor |
| 2 | Deploy to Vercel on a test subdomain; Stripe test checkout with a dummy client account |
| 3 | Send the digest to yourself and one or two friendly clients (access granted by hand) |
| 4 | Switch the Monday task to `/api/drafts`; review in the app only; collect client feedback |

## Cutover checklist

- [ ] Stripe live mode, Supabase Pro, legal pages reviewed
- [ ] Monday task posting to the app (MONDAY-TASK.md)
- [ ] Final `import:pilot` from the pilot
- [ ] Daily sync task turned off once the tracker no longer needs it
- [ ] Pilot page kept read-only as a fallback for a few weeks, then archived
