-- Partner shares "from a date" (2026-11-22).
--
-- Problem: shares were one number per membership (memberships.share_percent)
-- and the app applied it to the whole history. Changing 50/50 to 60/40
-- silently re-split every past month, locked months included.
--
-- Fix: share_periods keeps each change with the date it takes effect.
-- The app splits each period with the shares in force then and sums the
-- results. The only way to change shares is set_partner_shares(), which
-- refuses a start date inside a locked month and keeps
-- memberships.share_percent equal to the shares in force today (the app
-- still reads it for display and for invites).
--
-- Orgs that never change shares have no rows here; the app then uses
-- memberships.share_percent for the whole history, exactly as before.

create table if not exists public.share_periods (
  org_id         uuid        not null references public.organizations(id) on delete cascade,
  effective_from date        not null,
  share_a        numeric     not null check (share_a >= 0 and share_a <= 100),
  created_by     uuid        not null,
  created_at     timestamptz not null default now(),
  primary key (org_id, effective_from)
);

alter table public.share_periods enable row level security;

-- Members read the history. No insert/update/delete policy: writes go
-- through set_partner_shares() only.
drop policy if exists share_periods_select on public.share_periods;
create policy share_periods_select on public.share_periods
  for select using (public.is_org_member(org_id));

revoke all on public.share_periods from anon, authenticated;
grant select on public.share_periods to authenticated;

-- Owner sets the shares (owner = partner A) from p_from onward.
-- Periods starting on or after p_from are replaced by this one.
create or replace function public.set_partner_shares(p_org uuid, p_share_a numeric, p_from date)
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
    raise exception 'Only the workspace owner can change shares' using errcode = '42501';
  end if;
  if p_share_a is null or p_share_a < 0 or p_share_a > 100 then
    raise exception 'Share must be between 0 and 100' using errcode = '22023';
  end if;
  if p_from is null then
    raise exception 'Start date is required' using errcode = '22023';
  end if;

  select max(year_month) into v_locked from public.locked_months where org_id = p_org;
  if v_locked is not null
     and p_from < (to_date(v_locked || '-01', 'YYYY-MM-DD') + interval '1 month')::date then
    raise exception 'SHARES_LOCKED_MONTH: shares cannot change inside a locked month (last locked: %)', v_locked
      using errcode = '42501';
  end if;

  -- First change: keep the shares in force so far as the base period.
  if not exists (select 1 from public.share_periods where org_id = p_org) then
    insert into public.share_periods (org_id, effective_from, share_a, created_by)
    select p_org, date '1900-01-01', m.share_percent, auth.uid()
    from public.memberships m
    where m.org_id = p_org and m.role = 'owner';
  end if;

  delete from public.share_periods where org_id = p_org and effective_from >= p_from;
  insert into public.share_periods (org_id, effective_from, share_a, created_by)
  values (p_org, p_from, p_share_a, auth.uid());

  -- memberships.share_percent = shares in force today.
  select sp.share_a into v_now
  from public.share_periods sp
  where sp.org_id = p_org and sp.effective_from <= current_date
  order by sp.effective_from desc
  limit 1;

  if v_now is not null then
    perform set_config('sb.share_rpc', 'on', true);
    update public.memberships
       set share_percent = case when role = 'owner' then v_now else 100 - v_now end
     where org_id = p_org;
    perform set_config('sb.share_rpc', '', true);
  end if;
end;
$$;

revoke all on function public.set_partner_shares(uuid, numeric, date) from public, anon;
grant execute on function public.set_partner_shares(uuid, numeric, date) to authenticated;

-- A direct UPDATE of share_percent would bypass the history, so it is
-- refused; only set_partner_shares() may change it. INSERT is untouched
-- (new orgs and accept_invite set the starting share).
create or replace function public.membership_share_via_rpc_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.share_percent is distinct from old.share_percent
     and coalesce(current_setting('sb.share_rpc', true), '') <> 'on' then
    raise exception 'Shares change only through set_partner_shares()' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists membership_share_via_rpc_only on public.memberships;
create trigger membership_share_via_rpc_only
  before update on public.memberships
  for each row execute function public.membership_share_via_rpc_only();
