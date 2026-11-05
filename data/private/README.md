# data/private (never committed)

Put the live tracker's export here: `cgm-tracker-full-export-YYYY-MM-DD.json` (from **Export all data** in the live NERC Compliance Tracker; Editors only).

Then run `npm run import:tracker -- data/private/<that file>.json`. The generated `import-tracker.sql` and `import-tracker-report.json` also land here.

Everything in this folder except this README is git-ignored because it holds real client data. Don't copy it anywhere else. See `docs/IMPORT.md`.
