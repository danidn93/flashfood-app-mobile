-- FlashFood Mobile: private delivery addresses owned by authenticated customers.
create table if not exists public.flashfood_customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Casa',
  address_line text not null,
  city text not null,
  reference text not null default '',
  latitude double precision,
  longitude double precision,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flashfood_addresses_label_length check (char_length(label) between 1 and 60),
  constraint flashfood_addresses_line_length check (char_length(address_line) between 5 and 250),
  constraint flashfood_addresses_city_length check (char_length(city) between 2 and 100),
  constraint flashfood_addresses_reference_length check (char_length(reference) <= 400),
  constraint flashfood_addresses_lat_range check (latitude is null or latitude between -90 and 90),
  constraint flashfood_addresses_lng_range check (longitude is null or longitude between -180 and 180),
  constraint flashfood_addresses_coordinates_pair check ((latitude is null) = (longitude is null))
);
create index if not exists flashfood_customer_addresses_user_idx
  on public.flashfood_customer_addresses(user_id, updated_at desc);
create unique index if not exists flashfood_customer_addresses_one_default
  on public.flashfood_customer_addresses(user_id) where is_default = true;
alter table public.flashfood_customer_addresses enable row level security;
revoke all on public.flashfood_customer_addresses from anon;
grant select, insert, update, delete on public.flashfood_customer_addresses to authenticated;
drop policy if exists "Customer reads own addresses" on public.flashfood_customer_addresses;
create policy "Customer reads own addresses" on public.flashfood_customer_addresses
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Customer adds own addresses" on public.flashfood_customer_addresses;
create policy "Customer adds own addresses" on public.flashfood_customer_addresses
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Customer edits own addresses" on public.flashfood_customer_addresses;
create policy "Customer edits own addresses" on public.flashfood_customer_addresses
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Customer deletes own addresses" on public.flashfood_customer_addresses;
create policy "Customer deletes own addresses" on public.flashfood_customer_addresses
  for delete to authenticated using ((select auth.uid()) = user_id);
