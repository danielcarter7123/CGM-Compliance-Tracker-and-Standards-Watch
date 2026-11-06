# Evidence: SharePoint and file upload

Dan's requirement: SharePoint linked seamlessly, and the option to upload files.

**Status (Nov 6, 2026):** uploads to app storage, pasted links, open and remove are built (see CHANGELOG). Everything SharePoint (Graph, browse, pick, upload to SharePoint, resolving links) waits for the Entra app registration below. Until then uploads go to app storage.

The database side is built and tested: `supabase/migrations/0005_evidence.sql`, plus the evidence cases in `tests/rls.test.mjs`. The Microsoft Graph code and the screens are milestone **T5** in `HANDOFF.md`.

## What a user can do on a task

| Action | Result | Stored as |
|---|---|---|
| **Upload file** | The file goes to the client's SharePoint evidence folder, or to the app's private storage if the client has no SharePoint folder connected or CGM chose app storage for them | `evidence.kind = 'sharepoint'` (with drive and item ids) or `'file'` (with storage path) |
| **Pick from SharePoint** | Browse the client's SharePoint folder inside the app and attach existing files or folders, without downloading or re-uploading | `kind = 'sharepoint'` |
| **Paste a link** | Any https link: a SharePoint share link, OneDrive, or another system | `kind = 'link'`. SharePoint links are resolved to drive and item ids when possible, so they behave like picked items |
| **Open** | SharePoint items open in SharePoint; app files download through a short-lived signed URL | |
| **Remove** | Soft delete: the row stays, with who removed it and when; the file isn't deleted | `removed_at`, `removed_by` |

A task can carry any number of evidence items. "Report posted" (the pilot's rule) becomes: at least one evidence item that hasn't been removed, or a legacy `tasks.evidence` link.

The per-company setting is `companies.evidence_destination`. The default is `'sharepoint'` when the client has a connected folder; `'app'` keeps uploads in Supabase Storage.

## Rules (enforced in the database)

- Evidence belongs to one task (or one Client Task) and to that task's company. A mismatch is refused.
- Who can add and see evidence follows the task: CGM staff for every client; client users for their own company, while it holds the Tracker (or the Client Tasks add-on for client-task evidence).
- Evidence rows can't be edited, only soft-removed by the person who added them or by CGM staff. Only CGM admins can hard-delete, for retention purges.
- App storage: a private bucket called `evidence`. Object names must start with the company id (`<company_id>/<task_id>/<uuid>-<file name>`). Storage policies let each client read and write only inside its own folder. Files can't be overwritten; only CGM admins can delete them.
- Every add and remove is written to the audit log. Clients see their own company's evidence history.

## SharePoint connection (Microsoft Graph)

**Recommended setup: one app registration in CGM's Microsoft 365 tenant, used only from the server.**

1. In Entra ID, register an app named "CGM Compliance Platform". Create a client secret, or better, a certificate.
2. Grant the **application** permission `Sites.Selected` (admin consent). Then give the app `write` access to only the SharePoint site(s) holding client evidence. Use `POST /sites/{site-id}/permissions` with `{"roles":["write"],"grantedToIdentities":[{"application":{"id":"<app id>","displayName":"CGM Compliance Platform"}}]}`. The app can't see anything else in the tenant.
3. Put `MS_TENANT_ID`, `MS_CLIENT_ID` and `MS_CLIENT_SECRET` (or the certificate) in the server environment. They are never sent to the browser.

**Why app-only rather than each user signing in to Microsoft:**

- Client users don't need Microsoft accounts in CGM's tenant.
- Uploads land in CGM's folders with a consistent owner.
- CGM controls access in one place: the app's own rules decide who may browse which client's folder.

If CGM later wants staff to act as themselves in SharePoint, add Microsoft as a Supabase Auth provider for staff and use delegated `Files.ReadWrite.All` for staff only.

### Graph calls the server makes (`lib/graph.ts`, server-only)

| Purpose | Call |
|---|---|
| Token | `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (client credentials, scope `https://graph.microsoft.com/.default`), cached until expiry |
| Connect a client folder from its URL (`companies.sharepoint_url`) | `GET /shares/u!{base64url(url)}/driveItem` → store `parentReference.driveId` and `id` in `sharepoint_drive_id` / `sharepoint_item_id` |
| Browse | `GET /drives/{drive}/items/{item}/children?$select=id,name,size,folder,file,webUrl,lastModifiedDateTime,eTag` (paged with `@odata.nextLink`) |
| Dated evidence folder | `POST /drives/{drive}/items/{item}/children` with `{"name":"<standard> <requirement> <YYYY-MM-DD>","folder":{},"@microsoft.graph.conflictBehavior":"fail"}` (reuse the folder if it exists) |
| Upload ≤ 4 MB | `PUT /drives/{drive}/items/{folder}:/{fileName}:/content` |
| Upload > 4 MB | `POST /drives/{drive}/items/{folder}:/{fileName}:/createUploadSession`, then PUT chunks of 5–10 MiB (multiples of 320 KiB) |
| Resolve a pasted share link | `GET /shares/u!{base64url(link)}/driveItem` |
| Open | Use the item's `webUrl` |

### App routes to build (all check `getViewer()` and the task's company before calling Graph)

- `POST /api/evidence/link`: `{taskId | clientTaskId, url, title?}`. Resolves SharePoint links when possible.
- `GET /api/evidence/sharepoint/browse?companyId=&itemId=`: folder listing, limited to that client's connected folder and its subfolders. Check that the item is inside the client's folder before returning anything.
- `POST /api/evidence/upload`: multipart; up to 250 MB by default. Goes to SharePoint or app storage per `evidence_destination`. App-storage uploads can go straight from the browser to Supabase Storage with the user's session, since the storage policies enforce the client folder. Record the SHA-256.
- `GET /api/evidence/{id}/open`: a SharePoint `webUrl`, or a 60-second signed URL for app files.

### Large and sensitive files

- Before upload: an allow-list of types (PDF, Office, images, CSV, TXT, ZIP, and others) and a size cap per company.
- Never put file contents in logs, emails or error messages. Emails link to the task, not the file.
- CIP evidence may include BES Cyber System Information (BCSI). Keep BCSI in SharePoint (CGM's controlled store) by default; app storage is for clients without SharePoint. Get Dan's sign-off on the retention period before enabling purges.

## Pilot data

Imported tasks keep their single `tasks.evidence` link, and the task screen shows it as "Evidence (from pilot)". When the SharePoint connection is set up, a one-off job can turn those links into `evidence` rows with `kind = 'sharepoint'` by resolving each link through `/shares`. It is optional and safe to re-run.
