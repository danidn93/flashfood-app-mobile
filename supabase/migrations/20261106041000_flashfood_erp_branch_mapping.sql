-- FlashFood project only. A local may own many branches, each with its own ERP ID.
create table if not exists public.flashfood_erp_branch_links (
  flashfood_branch_id uuid primary key references public.sucursales(id) on delete cascade,
  flashfood_local_id uuid not null references public.locales(id) on delete cascade,
  erp_business_id uuid not null,
  erp_branch_id uuid not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (erp_business_id,erp_branch_id)
);
alter table public.flashfood_erp_branch_links enable row level security;
revoke all on public.flashfood_erp_branch_links from anon,authenticated;
grant all on public.flashfood_erp_branch_links to service_role;
