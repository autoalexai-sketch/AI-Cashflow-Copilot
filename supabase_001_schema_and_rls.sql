-- AI Cashflow Copilot — Этап 1: схема данных + RLS
-- Вставить целиком в Supabase → SQL Editor → Run (на пустом проекте).
-- Хранилище чеков (Storage bucket + policies) сюда не входит — это Этап 6.

-- ============================================================
-- ТАБЛИЦЫ
-- ============================================================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My organization',
  currency text not null default 'PLN',
  tax_rate numeric not null default 10,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  role text not null check (role in ('owner','member')),
  display_name text not null default 'Partner',
  share_percent numeric not null default 50,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  created_by_user_id uuid not null references auth.users(id),
  date date not null default current_date,
  amount numeric not null check (amount > 0),
  type text not null check (type in ('income','expense','transfer','draw')),
  status text not null default 'pending' check (status in ('pending','verified','rejected')),
  project text,
  category text,
  account text,
  description text,
  receipt_path text,
  locked_at timestamptz,
  created_at timestamptz not null default now()
);

create table delete_requests (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions(id) on delete cascade,
  org_id uuid not null references organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now()
);

-- org_id в delete_requests заполняется автоматически из transactions,
-- чтобы его нельзя было подделать с клиента.
create or replace function public.set_delete_request_org_id()
returns trigger
language plpgsql
security definer
as $$
begin
  select org_id into new.org_id from transactions where id = new.transaction_id;
  return new;
end;
$$;

create trigger trg_set_delete_request_org_id
before insert on delete_requests
for each row execute function public.set_delete_request_org_id();

create index idx_memberships_user on memberships(user_id);
create index idx_transactions_org on transactions(org_id);
create index idx_transactions_creator on transactions(created_by_user_id);
create index idx_delete_requests_org on delete_requests(org_id);

-- ============================================================
-- ХЕЛПЕРЫ ДЛЯ RLS (security definer — чтобы политики не зацикливались
-- сами на себя при проверке "состою ли я в этой организации")
-- ============================================================

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(target_org uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from memberships m
    where m.org_id = target_org and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- ============================================================
-- RLS
-- ============================================================

alter table organizations enable row level security;
alter table memberships enable row level security;
alter table transactions enable row level security;
alter table delete_requests enable row level security;

-- organizations
create policy "org_select" on organizations for select
  using (is_org_member(id));

create policy "org_insert" on organizations for insert
  with check (auth.uid() is not null and created_by = auth.uid());

create policy "org_update" on organizations for update
  using (is_org_owner(id));

-- memberships
create policy "membership_select" on memberships for select
  using (is_org_member(org_id));

-- Вставка своей membership разрешена в двух случаях:
--  а) владелец приглашает нового участника;
--  б) пользователь только что создал организацию и добавляет себя как owner.
create policy "membership_insert" on memberships for insert
  with check (
    is_org_owner(org_id)
    or (user_id = auth.uid() and exists (
          select 1 from organizations o where o.id = org_id and o.created_by = auth.uid()
        ))
  );

create policy "membership_update" on memberships for update
  using (is_org_owner(org_id));

create policy "membership_delete" on memberships for delete
  using (is_org_owner(org_id));

-- transactions
create policy "tx_select" on transactions for select
  using (is_org_member(org_id));

create policy "tx_insert" on transactions for insert
  with check (is_org_member(org_id) and created_by_user_id = auth.uid());

-- Правка: владелец — всегда (пока месяц не закрыт); участник — только свою
-- ещё не подтверждённую и не заблокированную запись.
create policy "tx_update" on transactions for update
  using (
    locked_at is null
    and (
      is_org_owner(org_id)
      or (created_by_user_id = auth.uid() and status = 'pending')
    )
  );

-- Прямое удаление: владелец — всегда; участник — только свою запись,
-- которая ещё pending. Удаление чужой/verified записи участником должно идти
-- через delete_requests (Этап 5) — здесь оно физически запрещено базой.
create policy "tx_delete" on transactions for delete
  using (
    locked_at is null
    and (
      is_org_owner(org_id)
      or (created_by_user_id = auth.uid() and status = 'pending')
    )
  );

-- delete_requests
create policy "delreq_select" on delete_requests for select
  using (is_org_member(org_id));

create policy "delreq_insert" on delete_requests for insert
  with check (is_org_member(org_id) and requested_by = auth.uid());

create policy "delreq_update" on delete_requests for update
  using (is_org_owner(org_id));

-- ============================================================
-- КАК ПРОВЕРИТЬ, ЧТО ЭТО РЕАЛЬНО РАБОТАЕТ (не просто "выглядит настроенным")
-- ============================================================
-- 1. Создать двух пользователей в Supabase Auth (test-a@example.com, test-b@example.com).
-- 2. Под test-a: insert в organizations (created_by = свой uid), затем
--    insert в memberships (org_id, user_id = свой uid, role='owner').
-- 3. Под test-b: НЕ состоящим ни в одной организации test-a — попробовать
--    select * from transactions. Должен вернуться пустой результат, а не ошибка
--    и не чужие данные.
-- 4. Под test-b попробовать insert в transactions с чужим org_id — должен
--    быть отклонён политикой (insert 0 rows / permission error).
-- 5. Добавить test-b в организацию test-a как member. Test-b должен увидеть
--    транзакции test-a, но НЕ должен суметь update/delete verified-транзакцию
--    test-a напрямую.
