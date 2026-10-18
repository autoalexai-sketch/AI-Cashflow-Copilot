-- 2026-10-18 — the second partner can reject a row instead of only approving it.
--
-- Since 2026-10-12 every new or edited row in a two-member org lands
-- unapproved (tx_approval_guard) and waits in the other partner's
-- "To approve" list. The other partner could only approve it; changing
-- someone else's row was possible for the owner only (RLS tx_update).
-- reject_transaction() lets a member who did NOT create the row mark an
-- unapproved row as 'rejected', so it stops counting in any money figure
-- (calc.js counts verified/pending only). A locked month is still refused by
-- trg_check_month_locked. Runs as the function owner, so tx_approval_guard
-- leaves approved_by/approved_at untouched (both stay null).
-- Decision: 08-решения 2026-10-18 «вариант 3» + «да, reject».

create or replace function public.reject_transaction(p_tx uuid)
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
    raise exception 'You cannot reject your own transaction' using errcode = '42501';
  end if;

  update public.transactions
     set status = 'rejected'
   where id = p_tx and approved_at is null and status <> 'rejected';
end;
$$;

revoke all on function public.reject_transaction(uuid) from public, anon;
grant execute on function public.reject_transaction(uuid) to authenticated;
