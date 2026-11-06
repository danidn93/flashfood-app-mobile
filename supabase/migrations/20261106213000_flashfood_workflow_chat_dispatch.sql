-- FlashFood / Locales. Operational progress is separate from payment and fiscal status.
-- Apply after 20261106200000_flashfood_driver_identity.sql.
begin;
create table if not exists public.flashfood_order_progress (
 order_id uuid primary key references public.flashfood_orders(id) on delete cascade,
 stage text not null default 'recibido' check (stage in ('recibido','preparando','listo','asignando','retirando','reparto','entregado','cancelado')),
 updated_at timestamptz not null default now(),
 updated_by uuid
);
create table if not exists public.flashfood_order_stage_events (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.flashfood_orders(id) on delete cascade,
 stage text not null,
 actor_id uuid,
 created_at timestamptz not null default now()
);
create index if not exists ff_stage_events_order_idx on public.flashfood_order_stage_events(order_id,created_at);
create table if not exists public.flashfood_driver_live_locations (
 driver_id uuid primary key references public.flashfood_drivers(id) on delete cascade,
 latitude double precision not null check(latitude between -90 and 90),
 longitude double precision not null check(longitude between -180 and 180),
 recorded_at timestamptz not null default now()
);
create table if not exists public.flashfood_delivery_offers (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.flashfood_orders(id) on delete cascade,
 driver_id uuid not null references public.flashfood_drivers(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','accepted','rejected','expired')),
 offered_at timestamptz not null default now(),
 expires_at timestamptz not null default (now()+interval '60 seconds'),
 responded_at timestamptz,
 unique(order_id,driver_id)
);
create unique index if not exists ff_one_pending_offer_per_order on public.flashfood_delivery_offers(order_id) where status='pending';
create index if not exists ff_offers_expiration on public.flashfood_delivery_offers(status,expires_at);
create table if not exists public.flashfood_order_chat (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.flashfood_orders(id) on delete cascade,
 sender_id uuid,
 sender_role text not null check(sender_role in ('cliente','restaurante','delivery','sistema')),
 sender_name text not null,
 message text not null check(length(trim(message)) between 1 and 1500),
 created_at timestamptz not null default now()
);
create index if not exists ff_order_chat_order_idx on public.flashfood_order_chat(order_id,created_at,id);
alter table public.flashfood_order_progress enable row level security;
alter table public.flashfood_order_stage_events enable row level security;
alter table public.flashfood_driver_live_locations enable row level security;
alter table public.flashfood_delivery_offers enable row level security;
alter table public.flashfood_order_chat enable row level security;
revoke all on public.flashfood_order_progress,public.flashfood_order_stage_events,
 public.flashfood_driver_live_locations,public.flashfood_delivery_offers,public.flashfood_order_chat from anon,authenticated;
grant all on public.flashfood_order_progress,public.flashfood_order_stage_events,
 public.flashfood_driver_live_locations,public.flashfood_delivery_offers,public.flashfood_order_chat to service_role;
-- Only service role invokes the atomic matching operations.
create or replace function public.flashfood_offer_nearest(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o record; p record; v_driver uuid; v_offer uuid; v_now timestamptz:=now();
begin
 select id,fulfillment,mobile_branch_id,driver_id,payment_method,payment_status,status
 into o from public.flashfood_orders where id=p_order_id for update;
 if not found then return jsonb_build_object('result','not_found'); end if;
 select stage into p from public.flashfood_order_progress where order_id=p_order_id for update;
 if o.fulfillment<>'delivery' or p.stage<>'asignando' or o.driver_id is not null
    or o.status='cancelled' or (o.payment_method in ('payphone','transfer') and o.payment_status<>'paid')
 then return jsonb_build_object('result','not_eligible'); end if;
 update public.flashfood_delivery_offers set status='expired',responded_at=v_now
 where order_id=p_order_id and status='pending' and expires_at<=v_now;
 if exists(select 1 from public.flashfood_delivery_offers
           where order_id=p_order_id and status='pending' and expires_at>v_now)
 then return jsonb_build_object('result','pending');end if;
 -- Only riders with a recent position are eligible. The location is not publicly exposed.
 select d.id into v_driver
 from public.flashfood_drivers d
 join public.flashfood_user_roles r on r.user_id=d.auth_user_id and r.role='delivery' and r.active=true
 join public.flashfood_driver_live_locations gps on gps.driver_id=d.id
 join public.sucursales s on s.id=o.mobile_branch_id
 left join public.configuracion conf on conf.sucursal_id=s.id
 where d.active and d.verified and d.availability='available'
   and d.photo_storage_path is not null and nullif(d.vehicle_type,'') is not null
   and nullif(d.vehicle_plate,'') is not null
   and gps.recorded_at>v_now-interval '3 minutes'
   and coalesce(s.lat,conf.lat) is not null and coalesce(s.lng,conf.lng) is not null
   and not exists(select 1 from public.flashfood_delivery_offers attempted
     where attempted.order_id=p_order_id and attempted.driver_id=d.id)
   and not exists(select 1 from public.flashfood_orders busy
     where busy.driver_id=d.id and busy.status in ('assigned','accepted','in_transit'))
 order by (
  power((gps.latitude-coalesce(s.lat,conf.lat))*111.32,2)
  +power((gps.longitude-coalesce(s.lng,conf.lng))*111.32*cos(radians(coalesce(s.lat,conf.lat))),2)
 ) asc, d.id
 for update of d skip locked limit 1;
 if v_driver is null then return jsonb_build_object('result','no_driver');end if;
 insert into public.flashfood_delivery_offers(order_id,driver_id,expires_at)
 values(p_order_id,v_driver,v_now+interval '60 seconds') returning id into v_offer;
 return jsonb_build_object('result','offered','offer_id',v_offer,'driver_id',v_driver);
end;
$$;
create or replace function public.flashfood_reply_delivery_offer(p_offer_id uuid,p_driver_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare offer_row record; order_row record; v_now timestamptz:=now();
begin
 select * into offer_row from public.flashfood_delivery_offers where id=p_offer_id for update;
 if not found or offer_row.driver_id<>p_driver_id then return jsonb_build_object('result','not_found');end if;
 select id,driver_id,status into order_row from public.flashfood_orders where id=offer_row.order_id for update;
 if offer_row.status<>'pending' or offer_row.expires_at<=v_now or order_row.driver_id is not null then
   update public.flashfood_delivery_offers set status='expired',responded_at=v_now where id=p_offer_id and status='pending';
   return jsonb_build_object('result','expired');
 end if;
 if not p_accept then
  update public.flashfood_delivery_offers set status='rejected',responded_at=v_now where id=p_offer_id;
  return jsonb_build_object('result','rejected','order_id',offer_row.order_id);
 end if;
 if not exists(select 1 from public.flashfood_drivers where id=p_driver_id and active and verified and availability='available')
    or not exists(select 1 from public.flashfood_order_progress where order_id=offer_row.order_id and stage='asignando')
 then return jsonb_build_object('result','not_eligible');end if;
 update public.flashfood_delivery_offers set status='accepted',responded_at=v_now where id=p_offer_id;
 update public.flashfood_orders set driver_id=p_driver_id,status='assigned',updated_at=v_now
   where id=offer_row.order_id and driver_id is null;
 update public.flashfood_drivers set availability='busy',updated_at=v_now where id=p_driver_id;
 update public.flashfood_order_progress set stage='retirando',updated_at=v_now
   where order_id=offer_row.order_id;
 insert into public.flashfood_order_stage_events(order_id,stage)
 values(offer_row.order_id,'retirando');
 insert into public.flashfood_order_chat(order_id,sender_role,sender_name,message)
 values(offer_row.order_id,'sistema','FlashFood','La atención del chat pasó al repartidor asignado.');
 return jsonb_build_object('result','accepted','order_id',offer_row.order_id);
end;
$$;
revoke all on function public.flashfood_offer_nearest(uuid),public.flashfood_reply_delivery_offer(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.flashfood_offer_nearest(uuid),public.flashfood_reply_delivery_offer(uuid,uuid,boolean) to service_role;
-- Tick function is called by pg_cron each minute to expire ignored offers and
-- invite the next closest rider without relying on an open mobile application.
create or replace function public.flashfood_tick_delivery_offers()
returns integer language plpgsql security definer set search_path='' as $
declare v_order record; v_result jsonb; v_count integer:=0;
begin
 for v_order in
   select p.order_id from public.flashfood_order_progress p
   where p.stage='asignando' order by p.updated_at asc limit 200
 loop
   v_result:=public.flashfood_offer_nearest(v_order.order_id);
   if v_result->>'result'='offered' then v_count:=v_count+1;end if;
 end loop;
 return v_count;
end;
$;
revoke all on function public.flashfood_tick_delivery_offers() from public,anon,authenticated;
grant execute on function public.flashfood_tick_delivery_offers() to service_role;
-- Schedule only if pg_cron is already installed (Supabase Database > Extensions).
do $job$
begin
 if exists(select 1 from pg_extension where extname='pg_cron') then
   if not exists(select 1 from cron.job where jobname='flashfood_delivery_offers_tick') then
     perform cron.schedule('flashfood_delivery_offers_tick','* * * * *',
       'select public.flashfood_tick_delivery_offers()');
   end if;
 else
   raise notice 'pg_cron no instalado: habilitarlo para rotación automática de ofertas cada minuto';
 end if;
end
$job$;
-- Existing paid/eligible orders inherit progress lazily, without rewriting fiscal status.
commit;
