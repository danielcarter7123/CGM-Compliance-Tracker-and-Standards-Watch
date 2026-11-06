# CGM Workspace: the suite contract

CGM sells three separate applications. A client uses them with **one CGM account**, and has exactly the apps their plan includes. This file is the shared contract between this project (CGM Workspace, CGM Standards Watch, CGM Compliance Tracker) and the separate CGM Powerworks project. Keep both sides in step with it.

Decided by Dan, Nov 6, 2026 (OPEN-QUESTIONS 17).

## The pieces

| Piece | What it is | Where it lives |
|---|---|---|
| **CGM Workspace** | The shared sign-in and the launcher ("Your applications") | This project: `/login`, `/workspace`, `/account`, `/admin` |
| **CGM Standards Watch** | The weekly reviewed newsletter of NERC standards changes (one scrollable page, digest, calendar feed) | This project: `/watch` (+ `/watch/review`, `/watch/digest` for CGM editors; public offer at `/standards-watch`) |
| **CGM Compliance Tracker** | CGM's NERC compliance task tracker, with client views | This project: `/tracker/*` |
| **CGM Powerworks** | Asset management (assets, work orders, rounds, inventory, purchasing) | **Its own app, server and database.** Opened by plain link from the launcher, never in a frame, never merged into this code |

Each app has its own header. Inside an app, "← CGM Workspace" on the left goes back to the launcher. The apps don't link to each other directly.

## Shared identifiers

- **Client ID:** `companies.id` in this project (a UUID) is the canonical CGM client ID. Powerworks should store it on its client record (for example as `cgm_client_id`) so both sides refer to the same client.
- **Client name:** `companies.name`, the registered entity name, used unchanged in all three apps.
- **Product keys:** `watch`, `tracker`, `client_tasks` (an add-on that needs `tracker`), `powerworks`. They're stored per client in `entitlements(company_id, product, status)`. Only `active` and `trialing` grant access.
- **Plan names** follow from how many of the three apps a client has: 1 is Essentials, 2 is Operations, 3 is Enterprise (CGM staff see all three).

## Sign-in

- **Microsoft (Entra ID) is the main sign-in.** The Workspace offers "Sign in with Microsoft" first. Powerworks signs in with Microsoft only, so if both use the same Entra setup, someone already signed in to Microsoft passes straight through Powerworks's sign-in.
- **Fallback for clients without Microsoft 365:** an emailed one-time sign-in link. There are no passwords anywhere.
- **Status:** the Microsoft button needs CGM's Entra app registration plus the Supabase Azure provider settings (`docs/SETUP.md`). Until they're set, the button shows as not yet available and the email link works.

## Powerworks plug-in

- Set `POWERWORKS_URL` (for example `https://powerworks.<cgm-domain>/`). The launcher tile then opens it as a full page.
- Until it's set, the tile opens `/powerworks`, a "coming soon" page in the Workspace.
- On the Powerworks side, set `VITE_WORKSPACE_URL` to this app's `/workspace` address so its "← CGM workspace" link comes back here.

## Decide later, together

- **One place where CGM sets a client up,** so the Workspace's app access and the Powerworks Control Center's site and people limits never disagree.
- **Mapping existing Powerworks clients** onto the Workspace client IDs.
