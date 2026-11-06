-- SOLO base Locales / FlashFood. Ejecutar en SQL Editor DESPUES del SQL consolidado.
-- Mirror idempotente de negocios ERP; nunca reutiliza UUID ajenos como IDs locales.
begin;
create table if not exists public.flashfood_erp_catalog_businesses (
 erp_business_id uuid primary key,
 local_id uuid not null unique references public.locales(id) on delete restrict,
 last_synced_at timestamptz not null default now()
);
create table if not exists public.flashfood_erp_catalog_branches (
 erp_branch_id uuid primary key,
 erp_business_id uuid not null references public.flashfood_erp_catalog_businesses(erp_business_id),
 local_id uuid not null references public.locales(id),
 sucursal_id uuid not null unique references public.sucursales(id),
 published boolean not null default true,
 accepting_orders boolean not null default true,
 last_synced_at timestamptz not null default now()
);
create table if not exists public.flashfood_erp_catalog_products (
 erp_product_id uuid primary key,
 erp_business_id uuid not null references public.flashfood_erp_catalog_businesses(erp_business_id),
 producto_local_id uuid not null unique references public.productos_local(id),
 last_synced_at timestamptz not null default now()
);
create table if not exists public.flashfood_erp_catalog_presentations (
 erp_presentation_id uuid primary key,
 erp_product_id uuid not null references public.flashfood_erp_catalog_products(erp_product_id),
 presentation_local_id uuid not null unique references public.producto_presentaciones(id),
 last_synced_at timestamptz not null default now()
);
create index if not exists ff_erp_catalog_branches_business_idx on public.flashfood_erp_catalog_branches(erp_business_id,published);
create index if not exists ff_erp_catalog_products_business_idx on public.flashfood_erp_catalog_products(erp_business_id);

alter table public.flashfood_erp_catalog_businesses enable row level security;
alter table public.flashfood_erp_catalog_products enable row level security;
alter table public.flashfood_erp_catalog_presentations enable row level security;
alter table public.flashfood_erp_catalog_branches enable row level security;
revoke all on public.flashfood_erp_catalog_businesses, public.flashfood_erp_catalog_products,
 public.flashfood_erp_catalog_presentations,public.flashfood_erp_catalog_branches from anon,authenticated;
grant all on public.flashfood_erp_catalog_businesses,public.flashfood_erp_catalog_products,
 public.flashfood_erp_catalog_presentations,public.flashfood_erp_catalog_branches to service_role;

-- La publicación y los estados se consultan a través de vistas/RPCs que filtran en servidor.
-- Solo service_role puede escribir y leer mapeos privados.
create or replace function public.flashfood_erp_import_catalog(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
 b jsonb := p_payload->'business';
 v_business_id uuid;
 v_local_id uuid;
 v_branch jsonb; v_branch_id uuid; v_local_branch uuid;
 v_product jsonb; v_product_id uuid; v_local_product uuid;
 v_pres jsonb; v_pres_id uuid; v_local_pres uuid;
 v_existing uuid; v_count integer:=0; v_branches integer:=0;
 v_logo text;
begin
 if jsonb_typeof(b)<>'object' or jsonb_typeof(p_payload->'branches')<>'array'
   or jsonb_typeof(p_payload->'products')<>'array' or jsonb_typeof(p_payload->'presentations')<>'array'
 then raise exception 'Catálogo ERP incompleto'; end if;
 if coalesce((b->>'flashfood_catalogo_habilitado')::boolean,false)<>true
 then raise exception 'Este negocio no autorizó publicar su catálogo'; end if;
 v_business_id := (b->>'id')::uuid;
 if v_business_id is null then raise exception 'Negocio sin ID'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_business_id::text,0));
 select local_id into v_local_id from public.flashfood_erp_catalog_businesses
 where erp_business_id=v_business_id;
 v_logo := case when b->>'logo_url' ~* '^https://' then b->>'logo_url' else null end;
 if v_local_id is null then
   insert into public.locales(nombre,direccion,telefono,ruc,razon_social,nombre_comercial,activo)
   values(left(coalesce(nullif(b->>'nombre',''),'Negocio ERP'),200),
     b->>'direccion',b->>'telefono',nullif(b->>'ruc',''),
     nullif(b->>'razon_social',''),nullif(b->>'nombre_comercial',''),true)
   returning id into v_local_id;
   insert into public.flashfood_erp_catalog_businesses(erp_business_id,local_id)
   values(v_business_id,v_local_id);
 else
   update public.locales set nombre=left(coalesce(nullif(b->>'nombre',''),'Negocio ERP'),200),
      direccion=b->>'direccion',telefono=b->>'telefono',
      nombre_comercial=b->>'nombre_comercial',activo=true,updated_at=now()
   where id=v_local_id;
   update public.flashfood_erp_catalog_businesses set last_synced_at=now()
   where erp_business_id=v_business_id;
 end if;
 insert into public.local_funcionalidades(local_id,flashfood_activo,flashfood_acepta_pedidos)
 values(v_local_id,true,true) on conflict(local_id) do nothing;

 -- Las sucursales ERP eliminadas/inactivas dejan de publicarse.
 update public.flashfood_erp_catalog_branches
 set published=false,accepting_orders=false,last_synced_at=now()
 where erp_business_id=v_business_id
 and erp_branch_id not in (
   select (x->>'id')::uuid from jsonb_array_elements(p_payload->'branches') x
 );
 for v_branch in select x from jsonb_array_elements(p_payload->'branches') x loop
   v_branch_id:=(v_branch->>'id')::uuid;
   select sucursal_id into v_local_branch from public.flashfood_erp_catalog_branches
    where erp_branch_id=v_branch_id;
   if v_local_branch is null then
     insert into public.sucursales(local_id,nombre,direccion,telefono,activo,abierto,acepta_pedidos_app)
     values(v_local_id,left(coalesce(nullif(v_branch->>'nombre',''),'Sucursal ERP'),200),
       v_branch->>'direccion',v_branch->>'telefono',true,true,true)
     returning id into v_local_branch;
     insert into public.flashfood_erp_catalog_branches(
       erp_branch_id,erp_business_id,local_id,sucursal_id,published,accepting_orders)
     values(v_branch_id,v_business_id,v_local_id,v_local_branch,true,true);
   else
     update public.sucursales set nombre=left(coalesce(nullif(v_branch->>'nombre',''),'Sucursal ERP'),200),
       direccion=v_branch->>'direccion',telefono=v_branch->>'telefono',
       activo=true,updated_at=now()
     where id=v_local_branch;
     update public.flashfood_erp_catalog_branches set last_synced_at=now()
     where erp_branch_id=v_branch_id;
   end if;
   insert into public.configuracion(sucursal_id,logo_url,hero_bg_url)
   values(v_local_branch,v_logo,v_logo)
   on conflict(sucursal_id) do update set
    logo_url=excluded.logo_url,hero_bg_url=excluded.hero_bg_url,updated_at=now();
   v_branches:=v_branches+1;
 end loop;

 -- Solo se desactivan disponibilidades pertenecientes al ERP vinculado.
 update public.productos_sucursal ps set disponible=false
 where ps.sucursal_id in (select eb.sucursal_id from public.flashfood_erp_catalog_branches eb
      where eb.erp_business_id=v_business_id)
   and ps.producto_id in (select ep.producto_local_id from public.flashfood_erp_catalog_products ep
      where ep.erp_business_id=v_business_id);
 for v_product in select x from jsonb_array_elements(p_payload->'products') x loop
   v_product_id:=(v_product->>'id')::uuid;
   v_branch_id:=(v_product->>'branch_id')::uuid;
   select sucursal_id into v_local_branch from public.flashfood_erp_catalog_branches
   where erp_branch_id=v_branch_id and erp_business_id=v_business_id;
   if v_local_branch is null then continue; end if;
   select producto_local_id into v_local_product from public.flashfood_erp_catalog_products
   where erp_product_id=v_product_id;
   if v_local_product is null then
     insert into public.productos_local(local_id,nombre,descripcion,categoria,tipo,precio,precio_para_llevar,image_url)
     values(v_local_id,left(v_product->>'name',250),v_product->>'description',
       v_product->>'category','producto',(v_product->>'price')::numeric,
       (v_product->>'price')::numeric,
       case when v_product->>'image_url' ~* '^https://' then v_product->>'image_url' else null end)
     returning id into v_local_product;
     insert into public.flashfood_erp_catalog_products(erp_product_id,erp_business_id,producto_local_id)
     values(v_product_id,v_business_id,v_local_product);
   else
     update public.productos_local set nombre=left(v_product->>'name',250),
       descripcion=v_product->>'description',categoria=v_product->>'category',
       precio=(v_product->>'price')::numeric,precio_para_llevar=(v_product->>'price')::numeric,
       image_url=case when v_product->>'image_url' ~* '^https://' then v_product->>'image_url' else null end
     where id=v_local_product;
     update public.flashfood_erp_catalog_products set last_synced_at=now()
     where erp_product_id=v_product_id;
   end if;
   select id into v_existing from public.productos_sucursal
   where sucursal_id=v_local_branch and producto_id=v_local_product limit 1;
   if v_existing is null then
     insert into public.productos_sucursal(sucursal_id,producto_id,disponible)
     values(v_local_branch,v_local_product,coalesce((v_product->>'active')::boolean,false));
   else
     update public.productos_sucursal set disponible=coalesce((v_product->>'active')::boolean,false)
     where id=v_existing;
   end if;
   v_count:=v_count+1;
 end loop;
 for v_pres in select x from jsonb_array_elements(p_payload->'presentations') x loop
   v_pres_id:=(v_pres->>'id')::uuid;v_product_id:=(v_pres->>'product_id')::uuid;
   select producto_local_id into v_local_product from public.flashfood_erp_catalog_products
   where erp_product_id=v_product_id and erp_business_id=v_business_id;
   if v_local_product is null then continue; end if;
   select presentation_local_id into v_local_pres from public.flashfood_erp_catalog_presentations
   where erp_presentation_id=v_pres_id;
   if v_local_pres is null then
     insert into public.producto_presentaciones(producto_id,nombre,precio,precio_para_llevar,activo)
     values(v_local_product,left(v_pres->>'name',200),(v_pres->>'price')::numeric,
       (v_pres->>'price')::numeric,coalesce((v_pres->>'active')::boolean,false))
     returning id into v_local_pres;
     insert into public.flashfood_erp_catalog_presentations(erp_presentation_id,erp_product_id,presentation_local_id)
     values(v_pres_id,v_product_id,v_local_pres);
   else
     update public.producto_presentaciones set nombre=left(v_pres->>'name',200),
       precio=(v_pres->>'price')::numeric,precio_para_llevar=(v_pres->>'price')::numeric,
       activo=coalesce((v_pres->>'active')::boolean,false),updated_at=now()
     where id=v_local_pres;
   end if;
 end loop;
 return jsonb_build_object('local_id',v_local_id,'branches',v_branches,'product_links',v_count);
end;
$$;
revoke all on function public.flashfood_erp_import_catalog(jsonb) from public,anon,authenticated;
grant execute on function public.flashfood_erp_import_catalog(jsonb) to service_role;

-- Public read-only projection; no private ERP identifiers or fiscal data.
create or replace function public.flashfood_erp_public_restaurants()
returns jsonb
language sql stable security definer set search_path=''
as $
 select coalesce(jsonb_agg(jsonb_build_object(
  'local_id',l.id,'restaurante',l.nombre,
  'nombre_comercial',l.nombre_comercial,
  'sucursal_id',s.id,'sucursal',s.nombre,'direccion',s.direccion,
  'telefono',s.telefono,'lat',s.lat,'lng',s.lng,
  'abierto',coalesce(s.abierto,true),
  'acepta_pedidos',bc.accepting_orders,
  'logo_url',c.logo_url,'hero_bg_url',c.hero_bg_url
 ) order by l.nombre,s.nombre),'[]'::jsonb)
 from public.flashfood_erp_catalog_branches bc
 join public.locales l on l.id=bc.local_id
 join public.sucursales s on s.id=bc.sucursal_id
 left join public.configuracion c on c.sucursal_id=s.id
 where bc.published=true and l.activo=true and s.activo=true
$;
revoke all on function public.flashfood_erp_public_restaurants() from public;
grant execute on function public.flashfood_erp_public_restaurants() to anon,authenticated,service_role;
commit;
