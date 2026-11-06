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
