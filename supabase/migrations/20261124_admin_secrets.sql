-- Временное хранилище секретов для admin-api, пока нет доступа к панели Supabase
-- (Edge Function Secrets). Значения сюда пишутся вручную через SQL, в git их нет.
-- Доступ только у service_role: RLS включён без политик, права у anon/authenticated сняты.
-- План: вернуть доступ к панели → перенести токен в CF_ANALYTICS_TOKEN → откатить эту миграцию.

create table if not exists public.admin_secrets (
  name       text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_secrets enable row level security;
revoke all on public.admin_secrets from public, anon, authenticated;
grant select on public.admin_secrets to service_role;

comment on table public.admin_secrets is
  'ВРЕМЕННО: секреты admin-api до восстановления доступа к Supabase Dashboard. Только service_role.';
