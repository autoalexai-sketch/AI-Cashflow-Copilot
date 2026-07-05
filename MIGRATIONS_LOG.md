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
12. `add_projects_delete_policy` — `projects` table had INSERT/SELECT policies but no DELETE policy, so deletes silently no-op'd (HTTP 200, 0 rows affected). Added `projects_delete` policy: `FOR DELETE USING (is_org_owner(org_id))`.
13. `add_partner_names_to_organizations` — added `partner_a_name` / `partner_b_name` columns to `organizations`. **Superseded by #15 below** — reverted once the design changed from "owner-only names" to "each partner edits their own name".
14. `enable_realtime_on_transactions` — `ALTER PUBLICATION supabase_realtime ADD TABLE transactions;`. The publication was empty before this, so `postgres_changes` subscriptions on `transactions` silently received nothing; a transaction added by one partner only appeared for the other after a manual page refresh.
15. `revert_partner_names_on_organizations` — dropped `organizations.partner_a_name` / `partner_b_name` (see #13).
16. `allow_self_update_membership_display_name` — final partner-name design: each partner edits only their own name, stored in `memberships.display_name`. Adds a second, more permissive UPDATE policy (`membership_update_self`, `USING (user_id = auth.uid())`) alongside the existing owner-only policy — Postgres RLS policies are OR'd together, so this only *adds* permission. A `BEFORE UPDATE` trigger (`enforce_membership_self_update()` / `membership_self_update_guard`) compares `OLD` vs `NEW` and blocks non-owners from changing `role`, `share_percent`, `org_id`, or `user_id`, while still allowing them to change their own `display_name`. RLS `USING`/`WITH CHECK` clauses can't compare old-vs-new column values directly, hence the trigger.

## Deployment history

- Originally deployed on Netlify (Drop/manual upload flow).
- 2026-07-05: Netlify blocked new deploys ("Account credit usage exceeded"). Migrated hosting to **Cloudflare Pages** (project `ai-cashflow-copilot-v2`), Direct Upload flow (zip upload of `index.html`).
- Live URL: https://ai-cashflow-copilot-v2.pages.dev
- 2026-07-05: Fixed stale in-app "What's coming next" copy that still claimed cloud sync, partner invites, realtime sync, delete approval, and report export were unbuilt — all of these had already shipped. Updated the top status badge ("Local demo · offline" → "Live · synced"), the Settings → Security & sync section (replaced the non-functional sync toggle with a static "Active" badge), and the roadmap modal text, across all three languages (EN/PL/UK).
- 2026-07-05: Replaced the plain-text-only "Generate report" button with real **PDF export** (jsPDF + jsPDF-AutoTable, loaded via CDN) and **Excel export** (SheetJS/xlsx, loaded via CDN) on the Monthly Close view. The "Send to partners" mailto link keeps using a shared plain-text summary. All three formats are built from one `buildMonthlyReportData()` function to avoid duplicating DOM-read logic. Redeployed to Cloudflare Pages.
- 2026-07-06: Renamed the project from "AI Cashflow Copilot" to **SplitBooks** across the app (title, all i18n `appTitle` strings in EN/PL/UK, PDF/Excel report headers, export filenames `splitbooks-report-*`). Purchased and connected custom domains **splitbooks.pl** and **splitbooks.eu** (registered at home.pl, DNS delegated to Cloudflare, attached as Custom Domains on the `ai-cashflow-copilot-v2` Pages project).
- 2026-07-06: Added **Privacy Policy** (`privacy.html`) and **Terms of Use** (`terms.html`) pages, both bilingual (EN/PL), deployed alongside `index.html`. Added a footer to the main app (and a compact link row on the login screen) linking to both, plus an in-app disclaimer string (EN/PL/UK, `footerDisclaimer` i18n key) stating SplitBooks is a bookkeeping tool — not financial, tax, investment, or legal advice, and not a payment institution/processor. These are starting templates with bracketed placeholders (contact email, Supabase region, governing-law country) and should be reviewed by a lawyer before being relied on publicly. Redeployed to Cloudflare Pages.

To pull the live schema into a fresh environment, use the Supabase CLI
(`supabase db dump`) against project `bgbcyncpdfnsrhvunzkv`, or apply
`supabase_001_schema_and_rls.sql` followed by the migrations listed above in
order.
