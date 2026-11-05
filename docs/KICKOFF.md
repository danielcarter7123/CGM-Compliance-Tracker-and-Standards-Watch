# First message to paste into Claude Code

Unzip the project, open a terminal in the `cgm-compliance-platform` folder, start Claude Code there, and paste:

---

This repo is the starter for the CGM Compliance Platform: one web app holding two products that began as claude.ai artifacts. Standards Watch is a paid NERC standards update service. The Compliance Tracker is CGM's console for running clients' NERC compliance tasks, with client logins. What each client can open depends on what their company subscribes to.

Read CLAUDE.md, docs/HANDOFF.md and docs/ACCESS.md. Then skim docs/tracker/TRACKER-SPEC.md, docs/ARCHITECTURE.md and the reference pages in docs/reference/.

Also read docs/CHANGELOG.md for the latest changes and docs/OPEN-QUESTIONS.md.

Then:
1. Run `npm install`, `npm run typecheck`, `npm test` and `npm run build`, and tell me the results.
2. Before writing any code, ask me every open question in docs/OPEN-QUESTIONS.md in one message, and wait for my answers. Record them in that file.
3. Summarize in a few lines what you understand the product to be, what's built, and anything in the handoff that looks wrong, risky or unclear. Pay particular attention to the access rules in the migrations.
4. Once the questions are answered, propose how you'll do milestones F0 and F1, then start on F0.

Follow the rules in CLAUDE.md, especially client isolation and never adding real client data. Stop and ask me at any "Ask Dan" item rather than assuming.

---

For later sessions: "Read CLAUDE.md, docs/HANDOFF.md and docs/ACCESS.md. We're on milestone __. Continue from where we left off."

Client data: when Claude Code reaches milestone T2a, export the live tracker with **Export all data** and put the file in `data/private/` (see docs/IMPORT.md). Don't paste client data into the chat; Claude Code reads the file from disk and only runs the importer against your local database.
