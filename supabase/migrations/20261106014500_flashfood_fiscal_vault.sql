-- Execute ONLY in the FlashFood Mobile Supabase project (NOT xzngpapmyqkssdzbclpc).
-- Sensitive fiscal credentials must never be available to anon/authenticated SQL clients.
create table if not exists public.flashfood_platform_fiscal_profile (
  singleton boolean primary key default true check (singleton),
  ruc text not null check (ruc ~ '^[0-9]{13}$'),
  razon_social text not null check (length(trim(razon_social)) between 3 and 200),
  nombre_comercial text,
  direccion_matriz text not null,
  establecimiento text not null default '001' check (establecimiento ~ '^[0-9]{3}$'),
  punto_emision text not null default '001' check (punto_emision ~ '^[0-9]{3}$'),
  ambiente text not null default 'pruebas' check (ambiente in ('pruebas','produccion')),
  obligado_contabilidad boolean not null default false,
  contribuyente_especial text,
  activo boolean not null default false,
  certificate_storage_path text,
  certificate_sha256 text,
  certificate_password_ciphertext text,
  certificate_password_iv text,
  certificate_uploaded_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
create table if not exists public.flashfood_merchant_fiscal_settings (
  local_id uuid primary key references public.locales(id) on delete cascade,
  facturacion_flashfood_habilitada boolean not null default false,
  origen text not null default 'local' check (origen in ('local','multicomercios')),
  negocio_origen_id uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
-- Privileged server-only: policies intentionally omitted.
alter table public.flashfood_platform_fiscal_profile enable row level security;
alter table public.flashfood_merchant_fiscal_settings enable row level security;
revoke all on public.flashfood_platform_fiscal_profile from anon,authenticated;
revoke all on public.flashfood_merchant_fiscal_settings from anon,authenticated;
grant all on public.flashfood_platform_fiscal_profile to service_role;
grant all on public.flashfood_merchant_fiscal_settings to service_role;
-- Storage bucket for electronic signature material. Never public.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('flashfood-fiscal-private','flashfood-fiscal-private',false,3145728,
 array['application/octet-stream','application/x-pkcs12'])
on conflict (id) do update set public=false,file_size_limit=3145728,
 allowed_mime_types=array['application/octet-stream','application/x-pkcs12'];
-- No storage.objects policy is added: only the service role can upload/download.
