-- Откат: удалить временное хранилище (сначала перенести токен в Edge Function Secrets).
drop table if exists public.admin_secrets;
