-- Locales/FlashFood only. Some existing row triggers invoked from this importer
-- refer to productos_sucursal without schema qualification. PostgreSQL resolves
-- their unqualified names using the caller's search_path if they do not set one.
-- Keep pg_temp last for security-definer function name resolution.
-- The actual long-term fix is to qualify those trigger references with public.
alter function public.flashfood_erp_import_catalog(jsonb)
  set search_path = public, pg_temp;

-- Inspect affected triggers before further synchronization:
-- select tgrelid::regclass, tgname, tgfoid::regprocedure
-- from pg_trigger
-- where not tgisinternal and tgrelid in
-- ('public.productos_local'::regclass,'public.productos_sucursal'::regclass);
