-- Back-office views v2 (2026-11-22).
-- 1. Money columns match the app: income/expense/draw totals count VERIFIED
--    rows only (the app ignores pending and rejected). Pending sums are new
--    columns.
-- 2. New counters: tx_rejected, tx_awaiting_approval (not rejected, no
--    approved_at yet).
-- 3. Test organisations (admin_test_orgs) are flagged (is_test) and left out
--    of the summary, funnel and cohort metrics. Users/transactions lists stay
--    complete in v_admin_users and v_admin_org_health.
-- Only views and one admin-only table change; no app data is touched.

create table if not exists public.admin_test_orgs (
  org_id   uuid primary key references public.organizations(id) on delete cascade,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.admin_test_orgs enable row level security;
-- No policies: only service_role (admin-api) reads it.
revoke all on public.admin_test_orgs from anon, authenticated;

insert into public.admin_test_orgs (org_id, note) values
  ('5b6366f6-f448-4e5c-976c-c3c5621fd9a5', 'autoalexai@gmail.com test workspace'),
  ('6a3a5d0c-9405-41c4-a8c3-7b534232b6bb', 'luxeclean27@gmail.com test workspace')
on conflict (org_id) do nothing;

create or replace view public.v_admin_org_health as
 WITH tx AS (
         SELECT t_1.org_id,
            count(*) AS tx_total,
            count(*) FILTER (WHERE t_1.status = 'verified') AS tx_verified,
            count(*) FILTER (WHERE t_1.status = 'pending') AS tx_pending,
            count(*) FILTER (WHERE t_1.receipt_path IS NOT NULL) AS tx_with_receipt,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'income' AND t_1.status = 'verified'), 0::numeric) AS income_total,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'expense' AND t_1.status = 'verified'), 0::numeric) AS expense_total,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'draw' AND t_1.status = 'verified'), 0::numeric) AS draw_total,
            count(DISTINCT t_1.created_by_user_id) AS contributors_total,
            count(DISTINCT t_1.created_by_user_id) FILTER (WHERE t_1.created_at > (now() - '30 days'::interval)) AS contributors_30d,
            count(DISTINCT NULLIF(t_1.project, '')) AS projects_used,
            max(t_1.created_at) AS last_tx_at,
            count(*) FILTER (WHERE t_1.status = 'rejected') AS tx_rejected,
            count(*) FILTER (WHERE t_1.status <> 'rejected' AND t_1.approved_at IS NULL) AS tx_awaiting_approval,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'income' AND t_1.status = 'pending'), 0::numeric) AS income_pending,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'expense' AND t_1.status = 'pending'), 0::numeric) AS expense_pending,
            COALESCE(sum(t_1.amount) FILTER (WHERE t_1.type = 'draw' AND t_1.status = 'pending'), 0::numeric) AS draw_pending
           FROM transactions t_1
          GROUP BY t_1.org_id
        ), mem AS (
         SELECT m_1.org_id, count(*) AS members_total
           FROM memberships m_1
          GROUP BY m_1.org_id
        ), inv AS (
         SELECT i_1.org_id,
            count(*) AS invites_sent,
            count(*) FILTER (WHERE i_1.used_at IS NOT NULL) AS invites_accepted,
            count(*) FILTER (WHERE i_1.used_at IS NULL AND i_1.expires_at > now()) AS invites_pending,
            count(*) FILTER (WHERE i_1.used_at IS NULL AND i_1.expires_at <= now()) AS invites_expired
           FROM invites i_1
          GROUP BY i_1.org_id
        ), lock AS (
         SELECT l_1.org_id, count(*) AS months_closed, max(l_1.locked_at) AS last_close_at
           FROM locked_months l_1
          GROUP BY l_1.org_id
        )
 SELECT o.id AS org_id,
    o.name AS org_name,
    o.currency,
    o.tax_rate,
    o.created_at AS org_created_at,
    COALESCE(m.members_total, 0::bigint) AS members_total,
    COALESCE(t.contributors_total, 0::bigint) AS contributors_total,
    COALESCE(t.contributors_30d, 0::bigint) AS contributors_30d,
    COALESCE(t.tx_total, 0::bigint) AS tx_total,
    COALESCE(t.tx_verified, 0::bigint) AS tx_verified,
    COALESCE(t.tx_pending, 0::bigint) AS tx_pending,
    COALESCE(t.tx_with_receipt, 0::bigint) AS tx_with_receipt,
    COALESCE(l.months_closed, 0::bigint) AS months_closed,
    l.last_close_at,
    COALESCE(i.invites_sent, 0::bigint) AS invites_sent,
    COALESCE(i.invites_accepted, 0::bigint) AS invites_accepted,
    COALESCE(i.invites_pending, 0::bigint) AS invites_pending,
    COALESCE(i.invites_expired, 0::bigint) AS invites_expired,
    COALESCE(t.projects_used, 0::bigint) AS projects_used,
    COALESCE(t.income_total, 0::numeric) AS income_total,
    COALESCE(t.expense_total, 0::numeric) AS expense_total,
    COALESCE(t.draw_total, 0::numeric) AS draw_total,
    t.last_tx_at,
        CASE
            WHEN COALESCE(t.tx_total, 0::bigint) = 0 THEN 'empty'
            WHEN COALESCE(m.members_total, 0::bigint) < 2 THEN 'solo'
            WHEN COALESCE(t.contributors_30d, 0::bigint) >= 2 THEN 'paired_active'
            WHEN COALESCE(t.contributors_total, 0::bigint) >= 2 THEN 'paired_dormant'
            ELSE 'single_writer'
        END AS health_state,
    COALESCE(t.tx_rejected, 0::bigint) AS tx_rejected,
    COALESCE(t.tx_awaiting_approval, 0::bigint) AS tx_awaiting_approval,
    COALESCE(t.income_pending, 0::numeric) AS income_pending,
    COALESCE(t.expense_pending, 0::numeric) AS expense_pending,
    COALESCE(t.draw_pending, 0::numeric) AS draw_pending,
    (EXISTS (SELECT 1 FROM admin_test_orgs x WHERE x.org_id = o.id)) AS is_test
   FROM organizations o
     LEFT JOIN mem m ON m.org_id = o.id
     LEFT JOIN tx t ON t.org_id = o.id
     LEFT JOIN inv i ON i.org_id = o.id
     LEFT JOIN lock l ON l.org_id = o.id;

create or replace view public.v_admin_summary as
 SELECT ( SELECT count(*) FROM auth.users) AS users_total,
    ( SELECT count(*) FROM auth.users WHERE users.created_at > (now() - '7 days'::interval)) AS users_new_7d,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test) AS orgs_total,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.health_state = 'paired_active') AS orgs_paired_active,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.health_state = ANY (ARRAY['solo','single_writer'])) AS orgs_solo,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.health_state = 'empty') AS orgs_empty,
    ( SELECT count(*) FROM transactions t WHERE NOT EXISTS (SELECT 1 FROM admin_test_orgs x WHERE x.org_id = t.org_id)) AS tx_total,
    ( SELECT count(*) FROM transactions t WHERE t.created_at > (now() - '7 days'::interval)
        AND NOT EXISTS (SELECT 1 FROM admin_test_orgs x WHERE x.org_id = t.org_id)) AS tx_7d,
    ( SELECT COALESCE(sum(h.income_total), 0::numeric) FROM v_admin_org_health h WHERE NOT h.is_test) AS turnover_income,
    ( SELECT count(*) FROM delete_requests WHERE delete_requests.status = 'pending') AS delete_requests_pending,
    ( SELECT COALESCE(sum(v_admin_storage.mb), 0::numeric) FROM v_admin_storage) AS storage_mb,
    ( SELECT count(*) FROM admin_test_orgs) AS orgs_test,
    ( SELECT COALESCE(sum(h.income_pending), 0::numeric) FROM v_admin_org_health h WHERE NOT h.is_test) AS turnover_income_pending,
    ( SELECT COALESCE(sum(h.tx_awaiting_approval), 0::numeric) FROM v_admin_org_health h WHERE NOT h.is_test) AS tx_awaiting_approval,
    ( SELECT COALESCE(sum(h.tx_rejected), 0::numeric) FROM v_admin_org_health h WHERE NOT h.is_test) AS tx_rejected;

create or replace view public.v_admin_activation_funnel as
 SELECT ( SELECT count(*) FROM auth.users) AS signed_up,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test) AS orgs_created,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.tx_total > 0) AS first_transaction,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.invites_sent > 0) AS invite_sent,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.members_total >= 2) AS partner_joined,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.contributors_total >= 2) AS both_wrote,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.contributors_30d >= 2) AS both_wrote_30d,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.tx_with_receipt > 0) AS used_receipts,
    ( SELECT count(*) FROM v_admin_org_health h WHERE NOT h.is_test AND h.months_closed > 0) AS closed_month;

create or replace view public.v_admin_cohorts as
 WITH cohort AS (
         SELECT o.id AS org_id, date_trunc('week', o.created_at)::date AS cohort_week
           FROM organizations o
          WHERE o.created_at > (now() - '112 days'::interval)
            AND NOT EXISTS (SELECT 1 FROM admin_test_orgs x WHERE x.org_id = o.id)
        ), activity AS (
         SELECT DISTINCT c_1.org_id, c_1.cohort_week,
            floor(EXTRACT(epoch FROM date_trunc('week', t.created_at) - c_1.cohort_week::timestamp with time zone) / 604800::numeric)::integer AS week_offset
           FROM cohort c_1
             JOIN transactions t ON t.org_id = c_1.org_id
          WHERE t.created_at >= c_1.cohort_week
        )
 SELECT c.cohort_week,
    count(DISTINCT c.org_id) AS cohort_size,
    a.week_offset,
    count(DISTINCT a.org_id) AS retained,
    round(count(DISTINCT a.org_id)::numeric / NULLIF(count(DISTINCT c.org_id), 0)::numeric * 100::numeric, 1) AS retained_pct
   FROM cohort c
     LEFT JOIN activity a ON a.cohort_week = c.cohort_week AND a.week_offset >= 0 AND a.week_offset <= 5
  GROUP BY c.cohort_week, a.week_offset
  ORDER BY c.cohort_week DESC, a.week_offset;

-- Views stay unreachable for client roles (only admin-api with service_role).
revoke all on public.v_admin_org_health, public.v_admin_summary, public.v_admin_activation_funnel, public.v_admin_cohorts from anon, authenticated;
