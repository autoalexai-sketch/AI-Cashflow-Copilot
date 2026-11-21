-- 2026-11-21 — Security audit (claude/security-audit-2026-11-21.md, findings 2a + 2b).
--
-- tx_approval_guard protected approved_by/approved_at but not the row's
-- identity columns. Two holes followed:
--   2a. The owner (tx_update allows any column) could set created_by_user_id
--       to the partner and then approve the row himself via
--       approve_transaction() — bypassing second-partner approval.
--   2b. The creator of a pending row could set org_id to another org: the
--       creator branch of tx_update does not check membership of the new org.
--
-- Fix: for client writes, org_id and created_by_user_id are immutable on
-- UPDATE. The app never changes them (saveEdit sends date/amount/project/
-- type/category/status only), so no UI path is affected.
-- Rollback: 20261121_tx_guard_immutable_owner_org.rollback.sql

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

  -- UPDATE by a client: who owns the row and which org it lives in are fixed.
  if new.org_id is distinct from old.org_id
     or new.created_by_user_id is distinct from old.created_by_user_id then
    raise exception 'org_id and created_by_user_id cannot be changed' using errcode = '42501';
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
