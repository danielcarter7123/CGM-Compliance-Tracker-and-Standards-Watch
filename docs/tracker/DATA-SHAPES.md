# Compliance Tracker: data shapes in the pilot store

Source: the "NERC Compliance Tracker (Copy)" artifact (`DjexDTiLux4WG2xDNwpvLW`), read Nov 5, 2026. The store is a document database: `collection/docId`, with fields as JSON. Shapes come from the page code, checked against one or two stored documents per collection.

**The store holds real client data.** Despite the page's "Sandbox copy" banner, it contains real client names, NCR IDs, contact and plant-manager names and emails, CGM staff assignments, SharePoint evidence links and internal messages. No client data is copied into this repo; every example below is fake.

Counts were not pulled for the client collections, to avoid loading client data. "Paged" means there was more than one page of results.

| Collection | Doc id | Count | Notes |
|---|---|---|---|
| `standards` | standard code, e.g. `PRC-005` | 48 | CGM reference library; exported to `data/tracker-standards-library.json` |
| `taskPlans` | slug, e.g. `cip-002-annual-...` | paged (more than 2) | CGM step-by-step procedures; reference content, not client-specific |
| `clients` | random 12-char id | paged | Client-sensitive |
| `tasks` | random 12-char id | paged | NERC compliance tasks; client-sensitive |
| `teamTasks` | random id | paged | Internal CGM work; may mention clients and third parties |
| `clientTasks` | random id | 0 | "Client Tasks" add-on; empty today |
| `chats` | `team-general`, `ch-<id>`, `dm-<userA>-<userB>`, `client-<clientId>` | at least 1 | Conversation metadata |
| `chatMsgs` | `<chatId>__YYYY-MM-DD` | not sampled | One document per conversation per day |
| `activity` | `YYYY-MM-DD` | not sampled | One document per day; `entries` map |
| `activitySnapshots` | activity entry id | paged | Full copy of a deleted record, used for Restore |
| `data/users/<userId>/chatReads` | per user (private) | n/a | Read markers |
| `watch/content` | single document | 1 | Synced Standards Watch content (see docs/ARCHITECTURE.md) |

Types: `date` = `"YYYY-MM-DD"` string (or `""`/`null` when unset); `ts` = ISO 8601 timestamp; `userId` = opaque platform user id (`u_` + 22 chars); `clientId` = a `clients` doc id.

## standards/{code}

| Field | Type | Notes |
|---|---|---|
| code | string | `PRC-005`, `BAL-001-TRE`; also the doc id; can't be changed once tasks reference it |
| version | string | `6`, `5.1a`, `4.1` |
| title | string | |
| family | string | Prefix of the code, e.g. `PRC` |
| applies | string[] | Subset of `GO, GOP, GO-2, GOP-2, TO` |
| url | string? | Custom link; empty means `https://www.nerc.com/pa/Stand/Reliability%20Standards/<code>-<version>.pdf` |
| notes | string | |
| templates | Template[] | Recurring or event-driven obligations |
| custom | boolean? | `true` when added in the UI ("ADDED BY YOU") |

Template: `{ title: string, req: string, recur: { n: number, unit: "d"|"m"|"y", basis?: "due"|"done" } }`. `n = 0` means event-driven, with no repeat.

```json
{"code":"XYZ-001","version":"2","title":"Example Standard","family":"XYZ","applies":["GO","TO"],"url":"","notes":"",
 "templates":[{"req":"R1","title":"Example annual review","recur":{"n":12,"unit":"m","basis":"due"}}]}
```

## clients/{id}

| Field | Type | UI label |
|---|---|---|
| name | string | Registered entity name |
| ncr | string | NCR ID |
| region | `MRO`/`NPCC`/`RF`/`SERC`/`Texas RE`/`WECC`/`""` | Regional Entity |
| regDate | date | NERC Registration Date |
| functions | string[] | Registered functions (`GO, GOP, GO-2, GOP-2, TO`) |
| entities | `{rc,ba,top,tp,pc,to,tsp,go,gop: string}` | Functionally mapped NERC entities (free text "Entity name / NCR ID") |
| facilities | string | Facilities (free text) |
| contact, contactEmail | string | Primary compliance contact, Contact email |
| digest | boolean (default true) | Email the contact a weekday digest |
| pmName, pmEmail | string | Project Manager (a CGM person) |
| pmDigest | boolean (default true) | PM weekday digest across all of the PM's clients |
| plantMgrName, plantMgrEmail | string | Plant Manager |
| plantMgrDigest | boolean (default false) | Plant Manager weekday client digest |
| workspace | boolean | "Client Tasks" premium add-on enabled |
| sharepoint | https URL | SharePoint folder |
| notes | string | |
| sample | boolean? | Sample record |

```json
{"name":"Example Solar LLC","ncr":"NCR00000","region":"WECC","regDate":"2024-01-15","functions":["GO","GOP"],
 "entities":{"rc":"Example RC","ba":"","top":"","tp":"","pc":"","to":"","tsp":"","go":"","gop":""},
 "facilities":"Example Solar 1 (100 MW IBR)","contact":"Pat Example","contactEmail":"pat@example.com","digest":true,
 "pmName":"Alex Consultant","pmEmail":"alex@example.com","pmDigest":true,
 "plantMgrName":"","plantMgrEmail":"","plantMgrDigest":false,"workspace":false,"sharepoint":"https://example.sharepoint.com/x","notes":""}
```

## tasks/{id} (NERC compliance tasks)

| Field | Type | Notes |
|---|---|---|
| title | string | Required |
| clientId | clientId | |
| facility | string | Facility / unit |
| standard | string | Standard code (no version) |
| requirement | string | e.g. `R2, Part 2.1` |
| dueDate | date | Required when saving from the form; copied tasks may be `""` ("Needs due date") |
| assignee | string | Free-text name or email; **not** a user id |
| remindDays | number[] | Subset of `[90,60,30,14,7,1]`; default `[30,7]` (`[7,1]` for day-based templates) |
| recur | `{n, unit: "d"|"m"|"y", basis?: "due"|"done"}` | `n=0` one-time |
| status | `open`/`inprogress`/`review`/`done` | `review` = performed, pending CGM approval |
| evidence | string | SharePoint link (https) or free text; a link counts as "report posted" |
| notes | string | |
| createdAt | date | |
| completedAt | date \| null | Date performed (set at `review` or `done`) |
| performedBy | userId \| null | Who marked it performed |
| reviewedAt, reviewedBy | date, userId \| null | Approval |
| prevId, nextId | task id | Recurrence chain |
| copiedFrom | task id | Created by "assign all tasks" from another client's task |
| planId | taskPlan id \| `"none"` \| `""` | Per-task plan override |
| outlook | `{date, count, due}` | Outlook reminders were added |
| sample | boolean? | |

```json
{"title":"Example battery inspection","clientId":"abc123def456","facility":"Unit 1","standard":"PRC-005","requirement":"Table 1-4",
 "dueDate":"2027-03-01","assignee":"Pat Example","remindDays":[30,7],"recur":{"n":4,"unit":"m","basis":"done"},
 "status":"open","evidence":"","notes":"","createdAt":"2026-11-01","completedAt":null,"prevId":"zzz999yyy888"}
```

## taskPlans/{id}

| Field | Type | Notes |
|---|---|---|
| title | string | |
| standard | string | Code, used for grouping |
| body | string | One step per line; `## ` section, `### ` subsection, `- ` reference bullet |
| matches | string[] | Lowercased `"<standard>|<task title>"` keys; tasks matching use this plan |
| group, order, source | string, number, string | Seen in stored plans (imported from a "CGM Master NERC Task Plans List"); `order` sorts the picker |
| createdAt/By, updatedAt/By | ts / userId | |

## teamTasks/{id} (internal CGM work)

| Field | Type |
|---|---|
| title, description | string |
| clientId | clientId or `""` (internal) |
| owner | userId or `""` |
| collaborators | userId[] |
| plannedDate | date ("Anticipated completion") |
| actualDate | date ("Actual completion") |
| estHours | number or `""` |
| status | `notstarted`/`inprogress`/`onhold`/`review`/`done` |
| links | `{label, url}[]` (https only) |
| createdAt, createdBy | date, userId |

## clientTasks/{id} (Client Tasks add-on)

| Field | Type |
|---|---|
| title, description, notes | string |
| clientId | clientId (client must have `workspace: true`) |
| category | string (suggested: Environmental, Health & safety, Operations, Maintenance, Internal, Regulatory (non-NERC), Training, Other) |
| assignedTo | free text |
| party | `client`/`contractor`/`cgm`/`agency`/`other` |
| dueDate, completedAt | date |
| priority | `low`/`normal`/`high` |
| status | `notstarted`/`inprogress`/`onhold`/`done` |
| recur | `{n, unit: "d"|"m"|"y"}` (always from the due date) |
| links | `{label, url}[]` |
| createdAt, createdBy, prevId, nextId | |

## chats/{id}

`{ type: "channel"|"dm"|"client", name?: string (channel), members?: [userId, userId] (dm), clientId?: clientId (client), createdAt: ts, createdBy: userId, lastAt: ts, lastBy: userId, lastText: string (≤140) }`

```json
{"type":"channel","name":"CIP program","createdAt":"2026-11-01T15:00:00Z","createdBy":"u_exampleexampleexample1","lastAt":"2026-11-02T16:00:00Z","lastBy":"u_exampleexampleexample1","lastText":"Example message"}
```

## chatMsgs/{chatId}__{day}

`{ chat: chatId, day: "YYYY-MM-DD", entries: { <msgId>: { by: userId, ts, text (≤4000), task?: {kind: "task"|"ctask", id, label}, deleted?: true } } }`

## activity/{day}

`{ day, entries: { <entryId>: Entry } }`

Entry: `{ ts, day, by: userId|null, action: "created"|"updated"|"completed"|"performed"|"approved"|"deleted"|"restored"|"exported"|"reminders added", kind: "task"|"team"|"ctask"|"client"|"standard"|"plan"|"export"|"outlook", target: id, label, client: clientId, clientName?, changes: [{f, from, to}] (≤40, values ≤300 chars), raw?: {field: {from, to}} (for Revert), note, hasSnap?: true, restoredAt?, restoredBy? }`

## activitySnapshots/{entryId}

`{ day, snap: { data: <the deleted record>, tasks?: Task[], ctasks?: ClientTask[] } }`. When a client is deleted, the snapshot includes all of its tasks.

## data/users/{userId}/chatReads

`{ r: { <chatId>: ts } }`: last-read marker per conversation. Private to that user.
