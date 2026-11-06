-- FlashFood Locales only. Run after 20261106180000_flashfood_erp_import_trigger_search_path.sql.
-- Retire presentations deleted/filtered by the ERP without removing referenced IDs.
begin;
create or replace function public.flashfood_erp_import_catalog(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path=public, pg_temp
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
 -- Conexión fiscal opcional; la activación final sigue bajo control del Superadmin.
 insert into public.flashfood_merchant_fiscal_settings(local_id,origen,negocio_origen_id,facturacion_flashfood_habilitada)
 values(v_local_id,'multicomercios',v_business_id,false)
 on conflict(local_id) do nothing;

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
   insert into public.flashfood_erp_branch_links(
      flashfood_branch_id,flashfood_local_id,erp_business_id,erp_branch_id)
   values(v_local_branch,v_local_id,v_business_id,v_branch_id)
   on conflict(flashfood_branch_id) do update set
    erp_business_id=excluded.erp_business_id,erp_branch_id=excluded.erp_branch_id,
    flashfood_local_id=excluded.flashfood_local_id,updated_at=now();
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
 -- Synchronization is authoritative for presentations belonging to this ERP business.
 -- Hide older/default presentations that are no longer part of the export.
 update public.producto_presentaciones pp
 set activo=false, updated_at=now()
 from public.flashfood_erp_catalog_presentations mp
 join public.flashfood_erp_catalog_products prod
   on prod.erp_product_id=mp.erp_product_id
 where mp.presentation_local_id=pp.id
   and prod.erp_business_id=v_business_id
   and not exists (
     select 1 from jsonb_array_elements(p_payload->'presentations') incoming
     where (incoming->>'id')::uuid=mp.erp_presentation_id
   );
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
-- Existing base presentations already imported and duplicated in the marketplace.
update public.producto_presentaciones pp
set activo=false, updated_at=now()
from public.flashfood_erp_catalog_presentations mp
where pp.id=mp.presentation_local_id
  and (
    lower(btrim(pp.nombre)) in ('presentación base','presentacion base')
  );
commit;
