-- FlashFood Mobile project only. Private billing details and durable invoice intents.
-- No automatic SRI issuance. Existing checkout continues even if no merchant is enrolled.
create table if not exists public.flashfood_mobile_order_billing (
  order_id uuid primary key references public.flashfood_mobile_orders(id) on delete cascade,
  consumer_final boolean not null default true,
  customer_name text,
  customer_identification text,
  customer_email text,
  customer_phone text,
  created_at timestamptz not null default now(),
  constraint billing_name_length check (customer_name is null or char_length(customer_name)<=250),
  constraint billing_identification_length check (customer_identification is null or char_length(customer_identification)<=32),
  constraint billing_email_length check (customer_email is null or char_length(customer_email)<=254),
  constraint billing_phone_length check (customer_phone is null or char_length(customer_phone)<=30)
);
create table if not exists public.flashfood_invoice_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.flashfood_mobile_orders(id) on delete cascade,
  issuer_type text not null check (issuer_type in ('merchant_products','platform_service')),
  source_local_id uuid references public.locales(id),
  remote_erp_business_id uuid,
  remote_erp_sale_id uuid,
  remote_erp_invoice_id uuid,
  sri_access_key text,
  status text not null default 'awaiting_configuration'
    check (status in ('awaiting_configuration','awaiting_payment','waiting_business_ready',
      'ready','processing','authorized','rejected','error')),
  attempt_count integer not null default 0 check (attempt_count>=0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id,issuer_type)
);
create index if not exists ff_invoice_jobs_status_idx on public.flashfood_invoice_jobs(status,created_at);
alter table public.flashfood_mobile_order_billing enable row level security;
alter table public.flashfood_invoice_jobs enable row level security;
revoke all on public.flashfood_mobile_order_billing,public.flashfood_invoice_jobs from anon,authenticated;
grant all on public.flashfood_mobile_order_billing,public.flashfood_invoice_jobs to service_role;
-- No authenticated/anon policies: billing and invoice work queues remain server-only.

-- Atomic invoice context for one newly-created mobile order.
-- Service role only, invoked after order line insert and before dispatch.
create or replace function public.flashfood_mobile_attach_billing(
  p_order_id uuid,
  p_billing jsonb
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_order public.flashfood_mobile_orders%rowtype;
  v_merchant public.flashfood_merchant_fiscal_settings%rowtype;
begin
  select * into v_order
  from public.flashfood_mobile_orders
  where id=p_order_id for update;
  if not found then
    raise exception 'Pedido FlashFood no encontrado';
  end if;

  insert into public.flashfood_mobile_order_billing(
    order_id,consumer_final,customer_name,customer_identification,
    customer_email,customer_phone
  ) values(
    p_order_id,
    coalesce((p_billing->>'consumer_final')::boolean,true),
    nullif(p_billing->>'nombre',''),
    nullif(p_billing->>'identificacion',''),
    nullif(p_billing->>'correo',''),
    nullif(p_billing->>'telefono','')
  ) on conflict(order_id) do nothing;

  select * into v_merchant from public.flashfood_merchant_fiscal_settings
    where local_id=v_order.business_id;
  if found and v_merchant.facturacion_flashfood_habilitada then
    insert into public.flashfood_invoice_jobs(
      order_id,issuer_type,source_local_id,remote_erp_business_id,status
    ) values(
      p_order_id,'merchant_products',v_order.business_id,
      case when v_merchant.origen='multicomercios'
        then v_merchant.negocio_origen_id else null end,
      'awaiting_configuration'
    ) on conflict(order_id,issuer_type) do nothing;
  end if;

  if v_order.service_fee > 0 then
    insert into public.flashfood_invoice_jobs(
      order_id,issuer_type,status
    ) values(p_order_id,'platform_service','awaiting_configuration')
    on conflict(order_id,issuer_type) do nothing;
  end if;
end;
$$;
revoke all on function public.flashfood_mobile_attach_billing(uuid,jsonb)
from public,anon,authenticated;
grant execute on function public.flashfood_mobile_attach_billing(uuid,jsonb)
to service_role;
