# Migration history (Supabase project bgbcyncpdfnsrhvunzkv)

The base schema and RLS policies are in `supabase_001_schema_and_rls.sql`.
Everything after that was applied directly to the live database via Supabase
migrations (not re-exported to a local .sql file, to avoid drift between two
sources of truth). For reference, the migrations applied so far, in order:

1. `001_schema_and_rls` — base tables (organizations, memberships, transactions) + RLS
2. `002_harden_functions` / `003_harden_functions_explicit_roles` — function hardening
3. `fix_org_select_chicken_egg` — fixed first-login org creation being blocked by RLS
4. `add_partner_invites` — `invites` table, `accept_invite()` RPC, RLS
5. `fix_accept_invite_column_ambiguity_v2` — PL/pgSQL OUT-parameter fix
6. `harden_accept_invite_display_name_fallback`
7. `prevent_duplicate_pending_delete_requests` — unique index on `delete_requests`
8. `setup_receipts_storage` — private `receipts` Storage bucket + RLS policies
9. `add_locked_months` — `locked_months` table + `check_month_not_locked` trigger
10. `harden_check_month_not_locked` — locked down the trigger function (search_path, revoked direct EXECUTE)
11. `add_org_tax_rate` — `organizations.tax_rate` column (default 10), editable by the owner only (existing `org_update` RLS policy already covers it)

To pull the live schema into a fres