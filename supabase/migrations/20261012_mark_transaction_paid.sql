-- 2026-10-12 — "Mark as paid" for both partners.
--
-- The button is shown to every member, but RLS tx_update lets a member update
-- only their own pending rows, so a member marking the owner's row as paid was
-- a silent no-op (0 rows updated, no error). This RPC changes ONLY the status,
-- pending -> verified, for a row of the caller's own org; content edits stay
-- under tx_update as before. A locked month is still refused by
-- trg_check_month_locked. Runs as the function owner, so tx_approval_guard
-- leaves the partner approval untouched (a status change never clears it).

create or replace function public.mark_transaction_paid(p_tx uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select org_id into v_org from public.transactions where id = p_tx;
  if not found or not public.is_org_member(v_org) then
    raise exception 'Transaction not found' using errcode = 'P0002';
  end if;

  update public.transactions
     set status = 'verified'
   where id = p_tx and status = 'pending';
end;
$$;

revoke all on function public.mark_transaction_paid(uuid) from public, anon;
grant execute on function public.mark_transaction_paid(uuid) to authenticated;
