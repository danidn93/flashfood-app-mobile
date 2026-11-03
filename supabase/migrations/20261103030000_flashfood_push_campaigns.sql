-- FlashFood marketplace push: authenticated device registry and superadmin campaigns.
create table if not exists public.flashfood_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null unique,
  platform text not null check (platform in ('android','ios')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flashfood_push_device_token_valid check (length(token) between 20 and 4096)
);
create index if not exists flashfood_push_devices_user_idx on public.flashfood_push_devices(user_id);
create index if not exists flashfood_push_devices_active_platform_idx on public.flashfood_push_devices(active,platform);

alter table public.flashfood_push_devices enable row level security;
drop policy if exists "flashfood_push_devices_select_own" on public.flashfood_push_devices;
create policy "flashfood_push_devices_select_own" on public.flashfood_push_devices
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "flashfood_push_devices_insert_own" on public.flashfood_push_devices;
create policy "flashfood_push_devices_insert_own" on public.flashfood_push_devices
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "flashfood_push_devices_update_own" on public.flashfood_push_devices;
create policy "flashfood_push_devices_update_own" on public.flashfood_push_devices
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "flashfood_push_devices_delete_own" on public.flashfood_push_devices;
create policy "flashfood_push_devices_delete_own" on public.flashfood_push_devices
  for delete to authenticated using (auth.uid() = user_id);
revoke all on public.flashfood_push_devices from anon;
grant select,insert,update,delete on public.flashfood_push_devices to authenticated;

create table if not exists public.flashfood_push_campaigns (
  id uuid primary key default gen_random_uuid(),
  title varchar(100) not null check (length(btrim(title)) >= 3),
  message varchar(500) not null check (length(btrim(message)) >= 3),
  audience text not null default 'all' check (audience in ('all','customer','merchant','driver')),
  status text not null default 'draft' check (status in ('draft','sending','sent','partial','failed')),
  created_by uuid references auth.users(id) on delete set null,
  sent_count integer not null default 0 check (sent_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists flashfood_push_campaigns_created_at_idx
  on public.flashfood_push_campaigns(created_at desc);
alter table public.flashfood_push_campaigns enable row level security;
-- No client policy: only the service-role Edge Function may operate campaigns.
revoke all on public.flashfood_push_campaigns from anon, authenticated;
