-- Locales: notificar al cliente UNA vez cuando su delivery llega a 500 m.
-- Es una alerta de proximidad basada en línea recta (GPS), no distancia vial.
begin;
create table if not exists public.flashfood_delivery_arrival_alerts (
 order_id uuid primary key references public.flashfood_orders(id) on delete cascade,
 driver_id uuid not null references public.flashfood_drivers(id),
 customer_id uuid not null references auth.users(id),
 first_detected_at timestamptz not null default now(),
 distance_m integer not null,
 status text not null default 'pending' check (status in ('pending','sending','sent')),
 lease_until timestamptz,
 next_attempt_at timestamptz not null default now(),
 attempts integer not null default 0,
 sent_at timestamptz
);
create index if not exists flashfood_arrival_retry_idx
 on public.flashfood_delivery_arrival_alerts(next_attempt_at)
 where status <> 'sent';
alter table public.flashfood_delivery_arrival_alerts enable row level security;
revoke all on public.flashfood_delivery_arrival_alerts from public,anon,authenticated;
grant all on public.flashfood_delivery_arrival_alerts to service_role;

-- Lock the order and atomically claim delivery, preventing duplicate pushes.
-- Only use during in_transit and with reliable GPS (<=100 m reported accuracy).
create or replace function public.flashfood_claim_arrival_alert(
 p_order_id uuid,p_driver_id uuid,p_lat double precision,p_lng double precision,
 p_accuracy_m double precision
) returns jsonb language plpgsql security definer set search_path='' as $arrival$
declare
 o record;
 v_dest_lat double precision; v_dest_lng double precision;
 v_distance double precision;
 a record;
 v_now timestamptz := now();
begin
 if p_lat is null or p_lng is null or p_lat not between -90 and 90
   or p_lng not between -180 and 180 or p_accuracy_m is null
   or p_accuracy_m < 0 or p_accuracy_m > 100 then
   return jsonb_build_object('result','unreliable_gps');
 end if;
 select id,customer_id,driver_id,status,fulfillment,delivery_address
 into o from public.flashfood_orders where id=p_order_id for update;
 if not found or o.driver_id is distinct from p_driver_id
   or o.fulfillment <> 'delivery' or o.status <> 'in_transit' then
   return jsonb_build_object('result','not_eligible');
 end if;
 -- Reject stale or missing destination coordinates, never fallback to a guessed address.
 if jsonb_typeof(o.delivery_address) <> 'object'
   or (o.delivery_address->>'latitude') !~ '^-?[0-9]+(\\.[0-9]+)?$'
   or (o.delivery_address->>'longitude') !~ '^-?[0-9]+(\\.[0-9]+)?$' then
   return jsonb_build_object('result','missing_destination');
 end if;
 v_dest_lat:=(o.delivery_address->>'latitude')::double precision;
 v_dest_lng:=(o.delivery_address->>'longitude')::double precision;
 if v_dest_lat not between -90 and 90 or v_dest_lng not between -180 and 180 then
   return jsonb_build_object('result','invalid_destination');
 end if;
 v_distance := 6371000 * 2 * asin(least(1,sqrt(
   power(sin(radians(v_dest_lat-p_lat)/2),2)
   + cos(radians(p_lat))*cos(radians(v_dest_lat))
     *power(sin(radians(v_dest_lng-p_lng)/2),2)
 )));
 if v_distance > 500 then return jsonb_build_object('result','not_near','distance_m',round(v_distance));end if;
 insert into public.flashfood_delivery_arrival_alerts(order_id,driver_id,customer_id,distance_m)
 values(p_order_id,p_driver_id,o.customer_id,round(v_distance)::integer)
 on conflict(order_id) do nothing;
 select * into a from public.flashfood_delivery_arrival_alerts where order_id=p_order_id for update;
 if a.status='sent' then return jsonb_build_object('result','already_sent');end if;
 if (a.status='sending' and a.lease_until > v_now) or a.next_attempt_at>v_now
 then return jsonb_build_object('result','pending');end if;
 update public.flashfood_delivery_arrival_alerts
 set status='sending',lease_until=v_now+interval '40 seconds',
     attempts=attempts+1
 where order_id=p_order_id;
 return jsonb_build_object('result','claimed','customer_id',o.customer_id,
   'order_id',p_order_id,'distance_m',round(v_distance));
end;
$arrival$;

create or replace function public.flashfood_finish_arrival_alert(
 p_order_id uuid,p_sent boolean
) returns void language plpgsql security definer set search_path='' as $finish$
begin
 update public.flashfood_delivery_arrival_alerts
 set status=case when p_sent then 'sent' else 'pending' end,
     sent_at=case when p_sent then now() else null end,
     lease_until=null,
     next_attempt_at=case when p_sent then now()
       else now()+interval '60 seconds' end
 where order_id=p_order_id and status='sending';
end;
$finish$;
revoke all on function public.flashfood_claim_arrival_alert(uuid,uuid,double precision,double precision,double precision),
 public.flashfood_finish_arrival_alert(uuid,boolean)
 from public,anon,authenticated;
grant execute on function public.flashfood_claim_arrival_alert(uuid,uuid,double precision,double precision,double precision),
 public.flashfood_finish_arrival_alert(uuid,boolean) to service_role;
commit;
