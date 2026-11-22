-- Rollback of 20261122_share_periods.sql.
-- Restores the old behaviour: shares live only on memberships.share_percent
-- and apply to the whole history. Deploy the previous app.html first
-- (it updates memberships directly, which the trigger below would refuse).
drop trigger if exists membership_share_via_rpc_only on public.memberships;
drop function if exists public.membership_share_via_rpc_only();
drop function if exists public.set_partner_shares(uuid, numeric, date);
drop table if exists public.share_periods;
