-- KÉMOLUX database update (run this in Supabase SQL Editor)
-- Adds multi-image support, Cosmetics and Aesthetics category,
-- case-insensitive unique product names, and admin order deletion.

alter table public.products
  add column if not exists image_urls jsonb not null default '[]'::jsonb;

update public.products
set image_urls = jsonb_build_array(image_url)
where image_url is not null and image_urls = '[]'::jsonb;

alter table public.products drop constraint if exists products_category_check;
alter table public.products
  add constraint products_category_check
  check (category in ('wig','clothing','shoes','jewelry','glasses','cosmetics','bags'));

create or replace function public.prevent_duplicate_kemolux_product_name()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext(lower(trim(new.name))));
  if exists (
    select 1 from public.products p
    where lower(trim(p.name)) = lower(trim(new.name))
      and p.id is distinct from new.id
  ) then
    raise exception 'A product with this name already exists.';
  end if;
  return new;
end;
$$;
drop trigger if exists products_prevent_duplicate_name on public.products;
create trigger products_prevent_duplicate_name
before insert or update of name on public.products
for each row execute function public.prevent_duplicate_kemolux_product_name();

drop policy if exists "orders admin delete" on public.orders;
create policy "orders admin delete"
  on public.orders for delete to authenticated
  using (public.is_kemolux_admin());
