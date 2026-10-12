-- 2026-10-12 — "Object in 10 seconds": optional contract amount per project.
-- Additive and nullable: existing projects are untouched (NULL = no contract,
-- the card shows nothing extra). Covered by the existing projects_insert /
-- projects_select RLS policies; no UPDATE policy exists, so the amount is set
-- when the project is created.
-- MUST be applied to the live DB BEFORE the app change is deployed:
-- app.html selects this column, and without it the project list fails to load.
alter table public.projects
  add column contract_amount numeric(12,2)
  check (contract_amount is null or contract_amount > 0);
