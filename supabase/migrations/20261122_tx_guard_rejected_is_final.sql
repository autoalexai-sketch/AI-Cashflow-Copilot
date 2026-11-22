-- 2026-11-22 — A rejected row stays rejected.
--
-- reject_transaction() (2026-10-18) sets status = 'rejected', but tx_update
-- lets the owner change any column, so the owner could open the row, pick
-- 'verified' in the edit form and silently undo the partner's rejection.
-- Fix: for client writes, status cannot change away from 'rejected'.
-- The row can still be deleted (tx_delete). Decision: chat 2026-11-22.
-- Builds on 20261121_tx_guard_immutable_owner_org.sql.
-- Rollback: 20261122_tx_guard_rejected_is_final.rollback.sql

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

  -- UPDATE by a client: a row the other partner rejected stays rejected.
  -- It can still be deleted; to undo a rejection, add a new entry.
  if old.status = 'rejected' and new.status is distinct from old.status then
    raise exception 'A rejected transaction cannot be restored' using errcode = '42501';
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
