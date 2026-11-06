# Setup

The steps run in order. Allow about two hours the first time. Everything runs in test mode until step 8, so nothing is charged and no client sees anything.

## 1. Accounts you need

| Service | Used for | Cost to start |
|---|---|---|
| [GitHub](https://github.com) | Holds the code; Vercel deploys from it | Free |
| [Supabase](https://supabase.com) | Database, sign-in, access rules | Free tier; Pro ($25/mo) before launch for backups |
| [Stripe](https://stripe.com) | Subscriptions and invoices | Per transaction |
| [Resend](https://resend.com) | Weekly digest and sign-in emails | Free up to 3,000/mo |
| [Vercel](https://vercel.com) | Hosting | Free (Hobby) for the test; Pro ($20/mo) for commercial use |

Open these under a CGM company email, not a personal one.

## 2. Run it on your computer

Requires Node.js 20 or newer.

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` as you go through the next steps.

## 3. Supabase

1. Create a project (region: US West or US East). Save the database password somewhere safe.
2. **Project Settings > API**: copy the Project URL, `anon` key and `service_role` key into `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. The service role key bypasses all access rules, so it stays server-side and never goes in client code or a shared document.
3. **SQL Editor > New query**: paste the whole of `supabase/migrations/0001_init.sql` and run it.
4. **Authentication > URL Configuration**: set Site URL to `http://localhost:3000` for now, and add `http://localhost:3000/auth/callback` under Redirect URLs. You'll add the production URLs in step 7.
5. Run `0002_platform.sql` through `0005_evidence.sql` the same way, in order (or `supabase db push` with the CLI).
6. Load the content: `npm run import:pilot` (Standards Watch) and `npm run import:library` (the tracker's standards library). Each prints counts.

## 4. Make yourself an editor

1. `npm run dev`, open http://localhost:3000/login and sign in with dan@cgmconsultinggroup.com.
2. In the Supabase SQL editor run:

   ```sql
   update public.profiles set staff_role = 'admin' where email = 'dan@cgmconsultinggroup.com';
   ```

3. Reload. You'll see Review and Digest in the nav. CGM staff see everything without a subscription. Use `staff_role = 'pm'` or `'staff'` for colleagues (see docs/ACCESS.md).

Nobody can raise their own role from the app; the database blocks it.

## 5. Stripe (test mode)

1. In test mode, **Product catalog > Add product**: "Standards Watch", with two recurring prices (monthly and annual). Copy the price IDs into `STRIPE_PRICE_WATCH_MONTHLY` and `STRIPE_PRICE_WATCH_ANNUAL`.
2. **Developers > API keys**: copy the secret key into `STRIPE_SECRET_KEY`.
3. Webhook for local testing: install the [Stripe CLI](https://docs.stripe.com/stripe-cli) and run

   ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
   ```

   It prints a `whsec_...` secret. Put it in `STRIPE_WEBHOOK_SECRET` and restart `npm run dev`.
4. **Settings > Billing > Customer portal**: turn it on and allow cancel, plan switching and payment method updates.
5. Test: sign in as a different email, click a plan on the home page, pay with card `4242 4242 4242 4242`, any future date, any CVC. You should land on `/watch` with full access, and a company row should appear in Supabase with status `active`.

To give a client access without Stripe (a pilot client, or someone paying by invoice), set their company's status by hand:

```sql
insert into public.companies (name) values ('Example Power Co') returning id;
insert into public.entitlements (company_id, product, source) values ('<that id>', 'watch', 'contract');
-- Compliance Tracker client (includes Watch), optionally with the Client Tasks add-on:
-- insert into public.entitlements (company_id, product, source) values ('<id>', 'tracker', 'contract'), ('<id>', 'client_tasks', 'contract');
update public.profiles set company_id = '<that id>', company_role = 'admin' where email = 'person@example.com';
```

Milestone F1 adds an admin screen for this.

## 6. Resend (email)

1. Add and verify your sending domain (DNS records at whoever hosts cgmconsultinggroup.com). A subdomain such as `watch.cgmconsultinggroup.com` keeps digest mail separate from your normal email reputation.
2. Create an API key and put it in `RESEND_API_KEY`. Set `DIGEST_FROM`, for example `CGM Standards Watch <watch@cgmconsultinggroup.com>`.
3. Sign-in emails: in Supabase, **Authentication > Emails > SMTP Settings**, enable custom SMTP with host `smtp.resend.com`, port 465, user `resend`, password = the Resend API key. Supabase's built-in sender is rate-limited and only meant for testing.
4. Test: open `/watch/digest`, preview each function view, then send. While only your account exists it goes to you alone.

## 6b. Microsoft 365 (SharePoint evidence)

Do this before milestone T5b. In Entra ID, register an app with the **Sites.Selected** application permission and grant it write access to the SharePoint site(s) holding client evidence only. Put `MS_TENANT_ID`, `MS_CLIENT_ID` and `MS_CLIENT_SECRET` in `.env.local` and Vercel. The full steps are in [EVIDENCE.md](EVIDENCE.md). The `evidence` storage bucket for app uploads is created by migration `0005`.

## 6c. The live tracker's data

Follow [IMPORT.md](IMPORT.md): export from the live tracker, dry run into local Supabase, then production on cutover day. Install `psql` (PostgreSQL client) for this step.

## 7. Deploy to Vercel

1. Push the project to a private GitHub repo.
2. In Vercel, **Add New > Project**, import the repo. Framework is detected automatically.
3. Add every variable from `.env.local` under **Settings > Environment Variables**, with `NEXT_PUBLIC_SITE_URL` set to the real address (for example `https://watch.cgmconsultinggroup.com`). Generate `DRAFTS_API_TOKEN` fresh: `openssl rand -hex 32`.
4. Deploy, then add your domain under **Settings > Domains**.
5. Back in Supabase **URL Configuration**: set Site URL to the production address and add `https://<your domain>/auth/callback` to Redirect URLs.
6. In Stripe, **Developers > Webhooks > Add endpoint**: `https://<your domain>/api/stripe/webhook`, events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Put that endpoint's signing secret in Vercel's `STRIPE_WEBHOOK_SECRET` and redeploy.

## 8. Go live

- Switch Stripe to live mode: recreate the product and prices, and replace the key, price IDs and webhook secret in Vercel.
- Upgrade Supabase to Pro for daily backups.
- Have the disclaimer, terms and privacy policy reviewed (see the product plan's Legal section).
- Point the Monday task at the app (docs/MONDAY-TASK.md) and retire the pilot (docs/PILOT.md).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Sign-in link opens a "redirect not allowed" error | The callback URL isn't in Supabase Redirect URLs |
| Paid but `/watch` still shows the teaser | Webhook not reaching the app; check Stripe's webhook log and `STRIPE_WEBHOOK_SECRET` |
| `/watch` empty for an editor | `npm run import:pilot` hasn't been run against this project |
| Digest says "not sent" | `RESEND_API_KEY` or `DIGEST_FROM` missing, or the domain isn't verified |
| `/api/drafts` returns 401 | Token mismatch, or `DRAFTS_API_TOKEN` shorter than 24 characters |

## Microsoft sign-in (CGM Workspace's main sign-in)

Microsoft is the main way into CGM Workspace (decision 17, `docs/SUITE.md`); the emailed link is the fallback for people without Microsoft 365. Until these steps are done, the button on the sign-in page says it isn't connected yet.

1. **Microsoft Entra** (CGM's Microsoft 365 admin center → Entra ID → App registrations → New registration):
   - Name: `CGM Workspace`.
   - Supported account types: **Accounts in any organizational directory (multitenant)**, so client staff can sign in with their own company's Microsoft 365. Single-tenant would allow CGM staff only.
   - Redirect URI (Web): `https://<your-project>.supabase.co/auth/v1/callback`. Locally: `http://127.0.0.1:54321/auth/v1/callback`.
   - Certificates & secrets → New client secret. Copy the **value** and the **Application (client) ID**.
   - Use the **same Entra setup as CGM Powerworks** if possible, so someone signed in once passes straight into Powerworks.
2. **Supabase** (Dashboard → Authentication → Providers → Azure): turn it on and paste the client ID and secret. Leave the tenant URL as `https://login.microsoftonline.com/common` for multitenant.
3. **Vercel:** set `NEXT_PUBLIC_MICROSOFT_SIGNIN=on` and redeploy. The button becomes active.
4. **Locally (optional):** add to `supabase/config.toml`, then `npm run db:stop && npm run db:start`:

   ```toml
   [auth.external.azure]
   enabled = true
   client_id = "env(AZURE_CLIENT_ID)"
   secret = "env(AZURE_SECRET)"
   url = "https://login.microsoftonline.com/common"
   ```

A person who signs in with Microsoft gets the same account as their emailed-link sign-in when the email address matches.
