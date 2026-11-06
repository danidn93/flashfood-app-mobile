-- Operational order pipeline for the mobile application. Isolated from legacy POS rows.
-- Apply after customer addresses and delivery availability migrations.
create table if not exists public.flashfood_mobile_orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id),
  idempotency_key uuid not null,
  branch_id uuid not null,
  business_id uuid not null,
  address_id uuid references public.flashfood_customer_addresses(id) on delete set null,
  address_snapshot jsonb,
  modality text not null check (modality in ('domicilio','retirar','servir')),
  status text not null default 'pending_payment' check (status in
    ('pending_payment','placed','assigned','accepted','picked_up','delivered','cancelled')),
  payment_method text not null check (payment_method in ('tarjeta','efectivo','transferencia','local')),
  payment_status text not null default 'pending' check (payment_status in ('pending','awaiting_verification','paid','failed')),
  subtotal numeric(12,2) not null check (subtotal>=0),
  delivery_fee numeric(12,2) not null default 0 check (delivery_fee>=0),
  tip numeric(12,2) not null default 0 check (tip>=0),
  service_fee numeric(12,2) not null default 0 check (service_fee>=0),
  total numeric(12,2) not null check (total>=0),
  route_km numeric(10,3), route_duration_minutes integer,
  assigned_driver_id uuid references public.flashfood_drivers(id),
  payphone_client_tx_id text unique,
  payphone_link text,
  payphone_transaction_id text unique,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, idempotency_key)
);
create index if not exists ff_mobile_order_customer_idx on public.flashfood_mobile_orders(customer_id,created_at desc);
create index if not exists ff_mobile_order_driver_idx on public.flashfood_mobile_orders(assigned_driver_id,status);
create index if not exists ff_mobile_order_dispatch_idx on public.flashfood_mobile_orders(status,modality,created_at);
create table if not exists public.flashfood_mobile_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.flashfood_mobile_orders(id) on delete cascade,
  product_id uuid not null,
  presentation_id uuid,
  name text not null,
  presentation_name text,
  quantity integer not null check (quantity between 1 and 100),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  note text not null default ''
);
create table if not exists public.flashfood_mobile_driver_positions (
  driver_id uuid primary key references public.flashfood_drivers(id) on delete cascade,
  order_id uuid not null references public.flashfood_mobile_orders(id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision,
  recorded_at timestamptz not null default now()
);
-- Only read own order and items. Mutations exclusively via authenticated Edge Functions / service role.
alter table public.flashfood_mobile_orders enable row level security;
alter table public.flashfood_mobile_order_items enable row level security;
alter table public.flashfood_mobile_driver_positions enable row level security;
revoke all on public.flashfood_mobile_orders, public.flashfood_mobile_order_items,
  public.flashfood_mobile_driver_positions from anon,authenticated;
grant select on public.flashfood_mobile_orders,public.flashfood_mobile_order_items,
  public.flashfood_mobile_driver_positions to authenticated;
drop policy if exists ff_mobile_orders_view on public.flashfood_mobile_orders;
create policy ff_mobile_orders_view on public.flashfood_mobile_orders for select to authenticated
  using (customer_id = (select auth.uid())
    or exists(select 1 from public.flashfood_drivers d where d.id = assigned_driver_id
      and d.auth_user_id=(select auth.uid())));
drop policy if exists ff_mobile_items_view on public.flashfood_mobile_order_items;
create policy ff_mobile_items_view on public.flashfood_mobile_order_items for select to authenticated
  using (exists(select 1 from public.flashfood_mobile_orders o where o.id=order_id
    and (o.customer_id=(select auth.uid()) or exists(
      select 1 from public.flashfood_drivers d where d.id=o.assigned_driver_id
      and d.auth_user_id=(select auth.uid())))));
drop policy if exists ff_mobile_positions_view on public.flashfood_mobile_driver_positions;
create policy ff_mobile_positions_view on public.flashfood_mobile_driver_positions for select to authenticated
  using (exists(select 1 from public.flashfood_mobile_orders o where o.id=order_id
    and o.customer_id=(select auth.uid()) and o.status in ('accepted','picked_up'))
    or exists(select 1 from public.flashfood_drivers d where d.id=driver_id and d.auth_user_id=(select auth.uid())));

-- Dispatch an order to one available rider without racing other dispatchers.
create or replace function public.flashfood_mobile_assign_driver(p_order_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_driver_id uuid;
begin
  -- This function is only executable by service_role, never directly by a customer.
  perform 1 from public.flashfood_mobile_orders
    where id=p_order_id and modality='domicilio' and status='placed' for update;
  if not found then return null; end if;
  select d.id into v_driver_id
  from public.flashfood_drivers d
  join public.flashfood_user_roles r on r.user_id=d.auth_user_id and r.role='delivery' and r.active=true
  where d.active and d.verified and d.availability='available'
    and not exists(select 1 from public.flashfood_mobile_orders o
      where o.assigned_driver_id=d.id and o.status in ('assigned','accepted','picked_up'))
  order by d.updated_at asc, d.id
  for update of d skip locked limit 1;
  if v_driver_id is null then return null; end if;
  update public.flashfood_drivers set availability='busy',updated_at=now() where id=v_driver_id;
  update public.flashfood_mobile_orders set assigned_driver_id=v_driver_id,status='assigned',updated_at=now()
    where id=p_order_id;
  return v_driver_id;
end;
$$;
revoke all on function public.flashfood_mobile_assign_driver(uuid) from public,anon,authenticated;
grant execute on function public.flashfood_mobile_assign_driver(uuid) to service_role;
