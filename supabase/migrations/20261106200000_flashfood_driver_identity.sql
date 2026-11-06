-- FlashFood / Locales: identidad y vehículo del repartidor. Ejecutar una sola vez.
alter table public.flashfood_drivers
  add column if not exists photo_storage_path text,
  add column if not exists vehicle_plate text;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('flashfood-driver-photos','flashfood-driver-photos',false,3145728,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=3145728,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];
-- Sin políticas de lectura pública: las fotos se sirven con URL firmadas a
-- clientes con pedido asignado o a su propio repartidor.
