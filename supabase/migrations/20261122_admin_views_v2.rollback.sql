-- Rollback of 20261122_admin_views_v2.sql: original view definitions
-- (as of 2026-11-22, before v2). Views are dropped and recreated because
-- CREATE OR REPLACE VIEW cannot remove the added columns.
drop view if exists public.v_admin_summary;
drop view if exists public.v_admin_activation_funnel;
drop view if exists public.v_admin_cohorts;
drop view if exists public.v_admin_org_health;

create view public.v_admin_org_health as
 WITH tx AS (
         SELECT t_1.org_id, count(*) AS tx_total,
            count(*) FILTER (WHERE t_1.status = 'verified') AS tx_verified,
            count(*) FILTER (WHERE t_1.status = 'pending') AS tx_pending,
            count(*) FILTER (WHERE t_1.receipt_path IS NOT NULL) AS tx_with_receipt,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'income'), 0::numeric) AS income_total,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'expense'), 0::numeric) AS expense_total,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'draw'), 0::numeric) AS draw_total,
            count(DISTINCT t_1.created_by_user_id) AS contributors_total,
            count(DISTINCT t_1.created_by_user_id) FILTER (WHERE t_1.created_at > (now() - '30 days'::interval)) AS contributors_30d,
            count(DISTINCT NULLIF(t_1.project, '')) AS projects_used,
            max(t_1.created_at) AS last_tx_at
           FROM transactions t_1 GROUP BY t_1.org_id
        ), mem AS (SELECT m_1.org_id, count(*) AS members_total FROM memberships m_1 GROUP BY m_1.org_id
        ), inv AS (
         SELECT i_1.org_id, count(*) AS invites_sent,
            count(*) FILTER (WHERE i_1.used_at IS NOT NULL) AS invites_accepted,
            count(*) FILTER (WHERE i_1.used_at IS NULL AND i_1.expires_at > now()) AS invites_pending,
            count(*) FILTER (WHERE i_1.used_at IS NULL AND i_1.expires_at <= now()) AS invites_expired
           FROM invites i_1 GROUP BY i_1.org_id
        ), lock AS (SELECT l_1.org_id, count(*) AS months_closed, max(l_1.locked_at) AS last_close_at FROM locked_months l_1 GROUP BY l_1.org_id)
 SELECT o.id AS org_id, o.name AS org_name, o.currency, o.tax_rate, o.created_at AS org_created_at,
    COALESCE(m.members_total, 0::bigint) AS members_total,
    COALESCE(t.contributors_total, 0::bigint) AS contributors_total,
    COALESCE(t.contributors_30d, 0::bigint) AS contributors_30d,
    COALESCE(t.tx_total, 0::bigint) AS tx_total, COALESCE(t.tx_verified, 0::bigint) AS tx_verified,
    COALESCE(t.tx_pending, 0::bigint) AS tx_pending, COALESCE(t.tx_with_receipt, 0::bigint) AS tx_with_receipt,
    COALESCE(l.months_closed, 0::bigint) AS months_closed, l.last_close_at,
    COALESCE(i.invites_sent, 0::bigint) AS invites_sent, COALESCE(i.invites_accepted, 0::bigint) AS invites_accepted,
    COALESCE(i.invites_pending, 0::bigint) AS invites_pending, COALESCE(i.invites_expired, 0::bigint) AS invites_expired,
    COALESCE(t.projects_used, 0::bigint) AS projects_used,
    COALESCE(t.income_total, 0::numeric) AS income_total, COALESCE(t.expense_total, 0::numeric) AS expense_total,
    COALESCE(t.draw_total, 0::numeric) AS draw_total, t.last_tx_at,
    CASE WHEN COALESCE(t.tx_total, 0::bigint) = 0 THEN 'empty'
         WHEN COALESCE(m.members_total, 0::bigint) < 2 THEN 'solo'
         WHEN COALESCE(t.contributors_30d, 0::bigint) >= 2 THEN 'paired_active'
         WHEN COALESCE(t.contributors_total, 0::bigint) >= 2 THEN 'paired_dormant'
         ELSE 'single_writer' END AS health_state
   FROM organizations o LEFT JOIN mem m ON m.org_id = o.id LEFT JOIN tx t ON t.org_id = o.id
     LEFT JOIN inv i ON i.org_id = o.id LEFT JOIN lock l ON l.org_id = o.id;

create view public.v_admin_summary as
 SELECT ( SELECT count(*) FROM auth.users) AS users_total,
    ( SELECT count(*) FROM auth.users WHERE users.created_at > (now() - '7 days'::interval)) AS users_new_7d,
    ( SELECT count(*) FROM organizations) AS orgs_total,
    ( SELECT count(*) FROM v_admin_org_health WHERE health_state = 'paired_active') AS orgs_paired_active,
    ( SELECT count(*) FROM v_admin_org_health WHERE health_state = ANY (ARRAY['solo','single_writer'])) AS orgs_solo,
    ( SELECT count(*) FROM v_admin_org_health WHERE health_state = 'empty') AS orgs_empty,
    ( SELECT count(*) FROM transactions) AS tx_total,
    ( SELECT count(*) FROM transactions WHERE created_at > (now() - '7 days'::interval)) AS tx_7d,
    ( SELECT COALESCE(sum(income_total), 0::numeric) FROM v_admin_org_health) AS turnover_income,
    ( SELECT count(*) FROM delete_requests WHERE status = 'pending') AS delete_requests_pending,
    ( SELECT COALESCE(sum(mb), 0::numeric) FROM v_admin_storage) AS storage_mb;

create view public.v_admin_activation_funnel as
 SELECT ( SELECT count(*) FROM auth.users) AS signed_up,
    ( SELECT count(*) FROM organizations) AS orgs_created,
    ( SELECT count(*) FROM v_admin_org_health WHERE tx_total > 0) AS first_transaction,
    ( SELECT count(*) FROM v_admin_org_health WHERE invites_sent > 0) AS invite_sent,
    ( SELECT count(*) FROM v_admin_org_health WHERE members_total >= 2) AS partner_joined,
    ( SELECT count(*) FROM v_admin_org_health WHERE contributors_total >= 2) AS both_wrote,
    ( SELECT count(*) FROM v_admin_org_health WHERE contributors_30d >= 2) AS both_wrote_30d,
    ( SELECT count(*) FROM v_admin_org_health WHERE tx_with_receipt > 0) AS used_receipts,
    ( SELECT count(*) FROM v_admin_org_health WHERE months_closed > 0) AS closed_month;

create view public.v_admin_cohorts as
 WITH cohort AS (SELECT o.id AS org_id, date_trunc('week', o.created_at)::date AS cohort_week FROM organizations o WHERE o.created_at > (now() - '112 days'::interval)),
 activity AS (SELECT DISTINCT c_1.org_id, c_1.cohort_week,
     floor(EXTRACT(epoch FROM date_trunc('week', t.created_at) - c_1.cohort_week::timestamp with time zone) / 604800::numeric)::integer AS week_offset
   FROM cohort c_1 JOIN transactions t ON t.org_id = c_1.org_id WHERE t.created_at >= c_1.cohort_week)
 SELECT c.cohort_week, count(DISTINCT c.org_id) AS cohort_size, a.week_offset, count(DISTINCT a.org_id) AS retained,
    round(count(DISTINCT a.org_id)::numeric / NULLIF(count(DISTINCT c.org_id), 0)::numeric * 100::numeric, 1) AS retained_pct
   FROM cohort c LEFT JOIN activity a ON a.cohort_week = c.cohort_week AND a.week_offset >= 0 AND a.week_offset <= 5
  GROUP BY c.cohort_week, a.week_offset ORDER BY c.cohort_week DESC, a.week_offset;

revoke all on public.v_admin_org_health, public.v_admin_summary, public.v_admin_activation_funnel, public.v_admin_cohorts from anon, authenticated;
drop table if exists public.admin_test_orgs;
