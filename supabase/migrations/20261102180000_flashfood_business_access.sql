-- FlashFood Mobile: acceso multirol por negocio (ejecutar una vez en Supabase SQL Editor).
-- No modifica las tablas POS existentes ni la tarifa global.
create table if not exists public.flashfood_business_access (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 business_id uuid not null,
 branch_id uuid,
 role text not null check (role in ('admin','empleado')),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique nulls not distinct (user_id,business_id,branch_id,role)
);
create index if not exists flashfood_business_access_user_idx on public.flashfood_business_access(user_id,active);
create index if not exists flashfood_business_access_business_idx on public.flashfood_business_access(business_id,role,active);
alter table public.flashfood_business_access enable row level security;
-- Sin políticas públicas: las operaciones se realizan solo desde Edge Functions con comprobación de roles.
revoke all on public.flashfood_business_access from anon, authenticated;

create table if not exists public.flashfood_business_settings (
 business_id uuid primary key,
 free_delivery boolean not null default false,
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.flashfood_business_settings enable row level security;
revoke all on public.flashfood_business_settings from anon, authenticated;

-- DELIVERY GRATIS: un registro de configuración por negocio. El costo real del envío
-- debe conservarse en el pedido y financiarse con cargo al negocio; propina y recargo
-- por tarjeta se mantienen a cargo del cliente. El checkout aún requiere integración.
