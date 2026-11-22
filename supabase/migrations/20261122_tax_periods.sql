-- Tax reserve rate "from a date" (2026-11-22). Same idea as share_periods.
--
-- Problem: organizations.tax_rate was one number applied to the whole
-- history: changing 10 % to 19 % re-counted the reserve of every past
-- month, locked months included.
--
-- Fix: tax_periods keeps each change with its start date. The app counts
-- each period with the rate in force then. The only way to change the rate
-- is set_tax_rate(): it refuses a start date inside a locked month and keeps
-- organizations.tax_rate equal to the rate in force today.
-- Orgs that never change the rate have no rows: old behaviour, same numbers.

create table if not exists public.tax_periods (
  org_id         uuid        not null references public.organizations(id) on delete cascade,
  effective_from date        not null,
  tax_rate       numeric     not null check (tax_rate >= 0 and tax_rate <= 100),
  created_by     uuid        not null,
  created_at     timestamptz not null default now(),
  primary key (org_id, effective_from)
);

alter table public.tax_periods enable row level security;

drop policy if exists tax_periods_select on public.tax_periods;
create policy tax_periods_select on public.tax_periods
  for select using (public.is_org_member(org_id));

revoke all on public.tax_periods from anon, authenticated;
grant select on public.tax_periods to authenticated;

create or replace function public.set_tax_rate(p_org uuid, p_rate numeric, p_from date)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_locked text;
  v_now numeric;
begin
  if auth.uid() is null or not public.is_org_owner(p_org) then
    raise exception 'Only the workspace owner can change the tax rate' using errcode = '42501';
  end if;
  if p_rate is null or p_rate < 0 or p_rate > 100 then
    raise exception 'Tax rate must be between 0 and 100' using errcode = '22023';
  end if;
  if p_from is null then
    raise exception 'Start date is required' using errcode = '22023';
  end if;

  select max(year_month) into v_locked from public.locked_months where org_id = p_org;
  if v_locked is not null
     and p_from < (to_date(v_locked || '-01', 'YYYY-MM-DD') + interval '1 month')::date then
    raise exception 'TAX_LOCKED_MONTH: the tax rate cannot change inside a locked month (last locked: %)', v_locked
      using errcode = '42501';
  end if;

  -- First change: keep the rate in force so far as the base period.
  if not exists (select 1 from public.tax_periods where org_id = p_org) then
    insert into public.tax_periods (org_id, effective_from, tax_rate, created_by)
    select p_org, date '1900-01-01', o.tax_rate, auth.uid()
    from public.organizations o where o.id = p_org;
  end if;

  delete from public.tax_periods where org_id = p_org and effective_from >= p_from;
  insert into public.tax_periods (org_id, effective_from, tax_rate, created_by)
  values (p_org, p_from, p_rate, auth.uid());

  select tp.tax_rate into v_now
  from public.tax_periods tp
  where tp.org_id = p_org and tp.effective_from <= current_date
  order by tp.effective_from desc
  limit 1;

  if v_now is not null then
    perform set_config('sb.tax_rpc', 'on', true);
    update public.organizations set tax_rate = v_now where id = p_org;
    perform set_config('sb.tax_rpc', '', true);
  end if;
end;
$$;

revoke all on function public.set_tax_rate(uuid, numeric, date) from public, anon;
grant execute on function public.set_tax_rate(uuid, numeric, date) to authenticated;

-- A direct UPDATE of tax_rate would bypass the history: refused.
create or replace function public.org_tax_via_rpc_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.tax_rate is distinct from old.tax_rate
     and coalesce(current_setting('sb.tax_rpc', true), '') <> 'on' then
    raise exception 'The tax rate changes only through set_tax_rate()' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists org_tax_via_rpc_only on public.organizations;
create trigger org_tax_via_rpc_only
  before update on public.organizations
  for each row execute function public.org_tax_via_rpc_only();
