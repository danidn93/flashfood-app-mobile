-- Server-created order notifications for merchant admins and assigned employees.
create table if not exists public.flashfood_mobile_merchant_alerts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.flashfood_mobile_orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  business_id uuid not null references public.locales(id),
  branch_id uuid not null references public.sucursales(id),
  title text not null default 'Nuevo pedido FlashFood',
  message text not null default 'Hay un nuevo pedido para preparar.',
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique(order_id,user_id)
);
create index if not exists ff_merchant_alerts_user_idx on public.flashfood_mobile_merchant_alerts(user_id,created_at desc);
alter table public.flashfood_mobile_merchant_alerts enable row level security;
revoke all on public.flashfood_mobile_merchant_alerts from anon,authenticated;
grant select on public.flashfood_mobile_merchant_alerts to authenticated;
grant update(read_at) on public.flashfood_mobile_merchant_alerts to authenticated;
grant all on public.flashfood_mobile_merchant_alerts to service_role;
drop policy if exists ff_alerts_own_select on public.flashfood_mobile_merchant_alerts;
create policy ff_alerts_own_select on public.flashfood_mobile_merchant_alerts
  for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists ff_alerts_own_update on public.flashfood_mobile_merchant_alerts;
create policy ff_alerts_own_update on public.flashfood_mobile_merchant_alerts
  for update to authenticated using(user_id=(select auth.uid()))
  with check(user_id=(select auth.uid()));
