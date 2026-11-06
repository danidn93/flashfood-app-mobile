-- Ledger de obligaciones de la plataforma; SOLO EN SUPABASE FLASHFOOD.
-- La plataforma debe pagar negocios/repartidores únicamente cuando cobró con tarjeta.
-- Nunca incluir estas cuentas por pagar en la caja física de Multicomercios.
create table if not exists public.flashfood_settlement_obligations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.flashfood_mobile_orders(id) on delete restrict,
  beneficiary_type text not null check (beneficiary_type in ('merchant','driver')),
  merchant_local_id uuid references public.locales(id),
  driver_id uuid references public.flashfood_drivers(id),
  erp_business_id uuid,
  erp_branch_id uuid,
  erp_synced_at timestamptz,
  amount_due numeric(12,2) not null check (amount_due>0),
  amount_paid numeric(12,2) not null default 0 check(amount_paid>=0),
  status text not null default 'pending' check(status in ('pending','partial','paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id,beneficiary_type),
  constraint settlement_recipient check (
    (beneficiary_type='merchant' and merchant_local_id is not null and driver_id is null)
    or (beneficiary_type='driver' and driver_id is not null and merchant_local_id is null)
  ),
  constraint settlement_amount_limit check (amount_paid<=amount_due)
);
create table if not exists public.flashfood_settlement_transfers (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references public.flashfood_settlement_obligations(id) on delete restrict,
  amount numeric(12,2) not null check(amount>0),
  transfer_reference text not null check(length(trim(transfer_reference)) between 3 and 120),
  transfer_date date not null,
  recorded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(obligation_id,transfer_reference)
);
create index if not exists ff_settlement_status_idx on public.flashfood_settlement_obligations(status,created_at);
create index if not exists ff_settlement_erp_idx on public.flashfood_settlement_obligations(erp_business_id,erp_branch_id);
alter table public.flashfood_settlement_obligations enable row level security;
alter table public.flashfood_settlement_transfers enable row level security;
revoke all on public.flashfood_settlement_obligations,public.flashfood_settlement_transfers from anon,authenticated;
grant all on public.flashfood_settlement_obligations,public.flashfood_settlement_transfers to service_role;

-- Serializa pagos concurrentes y evita marcar más de lo adeudado.
create or replace function public.flashfood_record_settlement_transfer(
 p_obligation_id uuid,p_amount numeric,p_reference text,p_date date,p_actor uuid
) returns public.flashfood_settlement_obligations
language plpgsql security definer set search_path='' as $$
declare v public.flashfood_settlement_obligations%rowtype;
begin
 select * into v from public.flashfood_settlement_obligations
 where id=p_obligation_id for update;
 if not found then raise exception 'Obligación inexistente'; end if;
 if p_amount is null or p_amount<=0 or round(p_amount,2)<>p_amount
   or v.amount_paid+p_amount>v.amount_due then
   raise exception 'El pago supera el saldo pendiente o tiene importe inválido';
 end if;
 if p_reference is null or length(trim(p_reference))<3 then
   raise exception 'Se requiere una referencia bancaria verificable';
 end if;
 if p_date is null or p_date>current_date then
   raise exception 'Fecha de transferencia inválida';
 end if;
 insert into public.flashfood_settlement_transfers
 (obligation_id,amount,transfer_reference,transfer_date,recorded_by)
 values (p_obligation_id,p_amount,trim(p_reference),p_date,p_actor);
 update public.flashfood_settlement_obligations
 set amount_paid=amount_paid+p_amount,
     status=case when amount_paid+p_amount=amount_due then 'paid' else 'partial' end,
     updated_at=now()
 where id=p_obligation_id returning * into v;
 return v;
end;
$$;
revoke all on function public.flashfood_record_settlement_transfer(uuid,numeric,text,date,uuid)
 from public,anon,authenticated;
grant execute on function public.flashfood_record_settlement_transfer(uuid,numeric,text,date,uuid) to service_role;

-- Service-only; called exclusively AFTER provider payment is verified.
-- Merchant receives product subtotal. Rider receives delivery_fee + voluntary tip.
-- Platform fees are retained by platform, not included in merchant/rider payout.
create or replace function public.flashfood_stage_card_settlements(p_order_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare o public.flashfood_mobile_orders%rowtype;
declare v_erp uuid;v_branch uuid;v_n integer:=0;
begin
 select * into o from public.flashfood_mobile_orders where id=p_order_id for update;
 if not found or o.payment_method<>'tarjeta' or o.payment_status<>'paid'
   then raise exception 'El pedido no tiene tarjeta confirmada'; end if;
 select negocio_origen_id into v_erp from public.flashfood_merchant_fiscal_settings
 where local_id=o.business_id and origen='multicomercios';
 if o.subtotal>0 then
   insert into public.flashfood_settlement_obligations
   (order_id,beneficiary_type,merchant_local_id,erp_business_id,amount_due)
   values(p_order_id,'merchant',o.business_id,v_erp,o.subtotal)
   on conflict(order_id,beneficiary_type) do nothing;
   get diagnostics v_n = row_count;
 end if;
 if o.modality='domicilio' and o.assigned_driver_id is not null
   and o.delivery_fee+o.tip>0 then
   insert into public.flashfood_settlement_obligations
   (order_id,beneficiary_type,driver_id,amount_due)
   values(p_order_id,'driver',o.assigned_driver_id,o.delivery_fee+o.tip)
   on conflict(order_id,beneficiary_type) do nothing;
 end if;
 return v_n;
end;
$$;
revoke all on function public.flashfood_stage_card_settlements(uuid) from public,anon,authenticated;
grant execute on function public.flashfood_stage_card_settlements(uuid) to service_role;
