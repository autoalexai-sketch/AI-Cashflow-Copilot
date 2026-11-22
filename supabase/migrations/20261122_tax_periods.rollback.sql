-- Rollback of 20261122_tax_periods.sql: the tax rate applies to the whole
-- history again. Deploy the previous app.html first (it updates
-- organizations.tax_rate directly, which the trigger below would refuse).
drop trigger if exists org_tax_via_rpc_only on public.organizations;
drop function if exists public.org_tax_via_rpc_only();
drop function if exists public.set_tax_rate(uuid, numeric, date);
drop table if exists public.tax_periods;
