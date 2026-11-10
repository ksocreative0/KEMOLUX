-- KÉMOLUX Supabase schema
-- Run this whole file in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text unique,
  phone text,
  address text,
  city text,
  state text,
  role text not null default 'customer' check (role in ('customer','admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (category in ('wig','clothing','shoes','jewelry','glasses','bags')),
  description text not null default '',
  image_url text,
  price numeric(12,2) not null default 0,
  stock integer not null default 0,
  variations jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.customer_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  cart jsonb not null default '[]'::jsonb,
  wishlist jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  customer_name text not null,
  email text not null,
  phone text not null,
  address text not null,
  city text not null,
  state text not null,
  delivery_notes text,
  items jsonb not null,
  total numeric(12,2) not null,
  payment_status text not null default 'Unpaid' check(payment_status in ('Unpaid','Paid')),
  order_status text not null default 'Pending' check(order_status in ('Pending','Processing','Shipped','Completed','Cancelled')),
  created_at timestamptz not null default now()
);
create table if not exists public.login_history (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  email text not null,
  activity text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null, email text not null, phone text not null,
  location text, address text, date date, budget numeric(12,2),
  service_type text, service text not null,
  status text not null default 'New',
  created_at timestamptz not null default now()
);
create table if not exists public.hairstylist_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  name text not null, email text not null, phone text not null,
  skills text not null, experience text not null,
  status text not null default 'New',
  created_at timestamptz not null default now()
);

create or replace function public.is_kemolux_admin()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin'); $$;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.customer_state enable row level security;
alter table public.orders enable row level security;
alter table public.login_history enable row level security;
alter table public.appointments enable row level security;
alter table public.hairstylist_applications enable row level security;

create policy "profiles read own or admin" on public.profiles for select to authenticated using (id=auth.uid() or public.is_kemolux_admin());
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id=auth.uid() and role='customer');
create policy "profiles update own or admin" on public.profiles for update to authenticated using (id=auth.uid() or public.is_kemolux_admin()) with check (id=auth.uid() or public.is_kemolux_admin());
create policy "products public read active" on public.products for select to anon,authenticated using (active=true or public.is_kemolux_admin());
create policy "products admin insert" on public.products for insert to authenticated with check (public.is_kemolux_admin());
create policy "products admin update" on public.products for update to authenticated using (public.is_kemolux_admin()) with check (public.is_kemolux_admin());
create policy "products admin delete" on public.products for delete to authenticated using (public.is_kemolux_admin());
create policy "state own read" on public.customer_state for select to authenticated using (user_id=auth.uid() or public.is_kemolux_admin());
create policy "state own insert" on public.customer_state for insert to authenticated with check (user_id=auth.uid() or public.is_kemolux_admin());
create policy "state own update" on public.customer_state for update to authenticated using (user_id=auth.uid() or public.is_kemolux_admin()) with check (user_id=auth.uid() or public.is_kemolux_admin());
create policy "orders own read" on public.orders for select to authenticated using (user_id=auth.uid() or public.is_kemolux_admin());
create policy "orders customer create" on public.orders for insert to authenticated with check (user_id=auth.uid());
create policy "orders admin update" on public.orders for update to authenticated using (public.is_kemolux_admin()) with check (public.is_kemolux_admin());
create policy "login own insert" on public.login_history for insert to authenticated with check (user_id=auth.uid());
create policy "login admin read" on public.login_history for select to authenticated using (public.is_kemolux_admin());
create policy "appointments customer create" on public.appointments for insert to authenticated with check (user_id=auth.uid());
create policy "appointments own read/admin read" on public.appointments for select to authenticated using (user_id=auth.uid() or public.is_kemolux_admin());
create policy "appointments admin update" on public.appointments for update to authenticated using (public.is_kemolux_admin()) with check (public.is_kemolux_admin());
create policy "applications create authenticated" on public.hairstylist_applications for insert to authenticated with check (user_id=auth.uid());
create policy "applications admin read" on public.hairstylist_applications for select to authenticated using (public.is_kemolux_admin());
create policy "applications admin update" on public.hairstylist_applications for update to authenticated using (public.is_kemolux_admin()) with check (public.is_kemolux_admin());

-- After creating your own account through Supabase Auth, promote only your account:
-- update public.profiles set role='admin' where id = 'YOUR_AUTH_USER_UUID';

-- Automatically create a customer profile for every confirmed Auth user.
create or replace function public.handle_new_kemolux_user()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  insert into public.profiles(id,full_name,email,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.email,'customer')
  on conflict(id) do nothing;
  return new;
end; $$;
drop trigger if exists on_kemolux_auth_user_created on auth.users;
create trigger on_kemolux_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_kemolux_user();

-- Product image bucket. Upload/delete policies allow admin accounts only.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "public can view product images" on storage.objects for select to anon,authenticated using (bucket_id='product-images');
create policy "admin uploads product images" on storage.objects for insert to authenticated with check (bucket_id='product-images' and public.is_kemolux_admin());
create policy "admin updates product images" on storage.objects for update to authenticated using (bucket_id='product-images' and public.is_kemolux_admin()) with check (bucket_id='product-images' and public.is_kemolux_admin());
create policy "admin deletes product images" on storage.objects for delete to authenticated using (bucket_id='product-images' and public.is_kemolux_admin());

-- Public service forms may be submitted without creating a store account.
-- These tables contain form submissions only; reading them remains admin-only.
create policy "public appointment requests" on public.appointments
for insert to anon with check (user_id is null);
create policy "public hairstylist applications" on public.hairstylist_applications
for insert to anon with check (user_id is null);
