-- CGM Workspace: three separate apps (decision 17, docs/SUITE.md).
-- - The Compliance Tracker no longer includes Standards Watch: each app is its own entitlement.
-- - New product: powerworks (CGM Powerworks, a separate app; this project only shows its launcher tile).
-- - Nobody loses access in the switch: companies that got Watch through the Tracker get their own Watch
--   entitlement, which a CGM admin can switch off.

alter table public.entitlements drop constraint entitlements_product_check;
alter table public.entitlements add constraint entitlements_product_check
  check (product in ('watch','tracker','client_tasks','powerworks'));

create or replace function public.company_has(cid uuid, p text) returns boolean
language sql stable security definer set search_path = public as $$
  select cid is not null and case p
    when 'client_tasks' then
      exists (select 1 from entitlements e where e.company_id = cid and e.product = 'client_tasks' and e.status in ('active','trialing'))
      and exists (select 1 from entitlements e where e.company_id = cid and e.product = 'tracker' and e.status in ('active','trialing'))
    else exists (select 1 from entitlements e where e.company_id = cid and e.product = p and e.status in ('active','trialing'))
  end
$$;

insert into public.entitlements (company_id, product, status, source, notes)
select e.company_id, 'watch', 'active', 'contract', 'Kept Standards Watch when the apps were separated (0012).'
from public.entitlements e
where e.product = 'tracker' and e.status in ('active','trialing')
  and not exists (select 1 from public.entitlements w where w.company_id = e.company_id and w.product = 'watch')
on conflict (company_id, product) do nothing;
