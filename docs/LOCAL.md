# Running everything on your PC

The local setup runs the whole database (Postgres, sign-in, file storage and a mail catcher) in Docker on your machine. Nothing leaves the PC, and the cloud accounts aren't needed until launch.

## One-time install

1. Install **Docker Desktop for Windows** from docker.com. Accept the WSL 2 option it offers, then restart if asked.
2. Open Docker Desktop once and wait until it says "Engine running". You can leave it running in the background.

## Every time

```bash
npm run db:start      # starts the local database (first run downloads images, a few minutes)
npm run db:env        # writes the local keys into .env.local
npm run seed:dev      # fake users, fake companies, the CGM standards library, fake tasks
npm run import:pilot  # Standards Watch content
npm run dev           # http://localhost:3000
```

`npm run db:start` applies every migration in `supabase/migrations`. To start over with an empty database, run `npm run db:reset`, then `npm run seed:dev` and `npm run import:pilot` again.

If a terminal says `docker: command not found` right after installing Docker Desktop, close and reopen the terminal (or restart the PC) so it picks up Docker's new PATH.

## Tests

```bash
npm run typecheck
npm test            # database access rules + library tests (no Docker needed)
npm run test:e2e    # browser tests: signs in as every role (needs db:start, seed:dev, import:pilot)
```

## Signing in locally

Go to http://localhost:3000/login and enter one of the fake addresses printed by `seed:dev`, for example `admin@cgm.example`. Then open the local mail catcher at http://127.0.0.1:54324 and click the sign-in link.

| Address | Role |
|---|---|
| admin@cgm.example | CGM admin (everything, including Watch review) |
| pm@cgm.example | CGM project manager |
| staff@cgm.example | CGM staff |
| admin@watch.example | Client admin, Standards Watch only |
| admin@peaker.example / member@peaker.example | Client admin / member, Tracker + Client Tasks |
| member@wind.example | Client member, Tracker only |
| noplan@nowhere.example | Signed in, no products |

## Other local addresses

- Database admin screen (Supabase Studio): http://127.0.0.1:54323
- API: http://127.0.0.1:54321
- Postgres: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`

## Real client data

The tracker import dry run (milestone T2a, `docs/IMPORT.md`) runs against this local database only. Real data stays in `data/private/` and in the local database, and the local database never syncs anywhere.
