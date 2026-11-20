-- KÉMOLUX admin/customer account separation
-- Run this once in Supabase SQL Editor.
-- Existing profiles marked role='admin' are copied into the new allow-list.
-- Customer accounts remain in Supabase Auth + public.profiles.

create table if not exists public.admin_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.admin_accounts (user_id, email, is_active)
select p.id, lower(coalesce(p.email, u.email)), true
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin' and coalesce(p.email, u.email) is not null
on conflict (user_id) do update
set email = excluded.email;

alter table public.admin_accounts enable row level security;
grant select on public.admin_accounts to authenticated;
drop policy if exists "admin can view own admin account" on public.admin_accounts;
create policy "admin can view own admin account"
  on public.admin_accounts for select to authenticated
  using (user_id = auth.uid());

-- Admin checks now use the separate admin_accounts allow-list, not profiles.role.
create or replace function public.is_kemolux_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admin_accounts
    where user_id = auth.uid() and is_active = true
  );
$$;

-- Existing admin data is migrated automatically above. To add a new admin:
-- 1. Create the staff user in Supabase Authentication > Users.
-- 2. Copy that user's UUID and email, then run:
-- insert into public.admin_accounts (user_id, email)
-- values ('AUTH-USER-UUID-HERE', 'staff@example.com');
-- To suspend admin access without deleting the auth user:
-- update public.admin_accounts set is_active = false where email = 'staff@example.com';
