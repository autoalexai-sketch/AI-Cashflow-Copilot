-- 2026-10-12 — Partner approval (option A, decision log 08-решения).
--
-- A partner confirms the other partner's entries. Approval is separate from
-- status ('pending' = not yet paid, 'verified' = paid) and does NOT change any
-- balance or profit — it only records who checked what.
--
-- Rules enforced here, not in the UI:
--   * nobody can approve their own transaction;
--   * clients cannot write approved_by / approved_at directly — only through
--     approve_transaction();
--   * editing the content of an approved row (amount, date, type, category,
--     account, project, description, receipt) clears the approval;
--     marking as paid (status) or locking a month does not;
--   * in a workspace with a single member there is nobody to approve, so new
--     rows are approved automatically (approved_by NULL = automatic);
--   * rows that existed before this migration count as approved.

alter table public.transactions
  add column approved_by uuid references auth.users(id) on delete set null,
  add column approved_at timestamptz;

-- Existing rows: approved as of their creation. The month-lock trigger would
-- reject updates to locked months, so it is paused for this backfill only.
alter table public.transactions disable trigger trg_check_month_locked;
update public.transactions set approved_at = created_at where approved_at is null;
alter table public.transactions enable trigger trg_check_month_locked;

-- Number of members of an org, for the caller's own orgs only (0 otherwise).
-- SECURITY DEFINER so the count does not depend on memberships RLS.
create or replace function public.org_member_count(target_org uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_org_member(target_org)
              then (select count(*)::int from public.memberships m where m.org_id = target_org)
              else 0 end;
$$;

revoke all on function public.org_member_count(uuid) from public, anon;
grant execute on function public.org_member_count(uuid) to authenticated;

-- SECURITY INVOKER on purpose: current_user is then the client role
-- ('authenticated') for app writes, and the function owner for writes made
-- inside approve_transaction() (SECURITY DEFINER) — that is how the trigger
-- tells the approval path apart from a client trying to set the columns.
create or replace function public.tx_approval_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  members int;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  members := public.org_member_count(new.org_id);

  if tg_op = 'INSERT' then
    new.approved_by := null;
    new.approved_at := case when members <= 1 then now() else null end;
    return new;
  end if;

  -- UPDATE by a client: approval columns are read-only for it.
  new.approved_by := old.approved_by;
  new.approved_at := old.approved_at;

  if (new.amount, new.date, new.type, new.category, new.account, new.project, new.description, new.receipt_path)
     is distinct from
     (old.amount, old.date, old.type, old.category, old.account, old.project, old.description, old.receipt_path) then
    if members > 1 then
      new.approved_by := null;
      new.approved_at := null;
    else
      new.approved_at := now();
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.tx_approval_guard() from public, anon, authenticated;

create trigger trg_tx_approval_guard
  before insert or update on public.transactions
  for each row execute function public.tx_approval_guard();

create or replace function public.approve_transaction(p_tx uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_creator uuid;
begin
  select org_id, created_by_user_id into v_org, v_creator
  from public.transactions where id = p_tx;

  if not found or not public.is_org_member(v_org) then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;
  if v_creator = auth.uid() then
    raise exception 'You cannot approve your own transaction' using errcode = '42501';
  end if;

  update public.transactions
     set approved_by = auth.uid(), approved_at = now()
   where id = p_tx and approved_at is null;
end;
$$;

revoke all on function public.approve_transaction(uuid) from public, anon;
grant execute on function public.approve_transaction(uuid) to authenticated;
