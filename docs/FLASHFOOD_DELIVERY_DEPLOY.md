# FlashFood Mobile: activación del checkout, despacho y seguimiento

**Estado:** código implementado en `main`; NO se considera producción validada hasta completar las pruebas de sandbox y conciliación.

## 1. Aplicar migraciones en orden
En Supabase SQL Editor o Supabase CLI:
- `supabase/migrations/20261105160000_flashfood_delivery_disponible.sql` (si aún no está)
- `supabase/migrations/20261105170000_flashfood_customer_addresses.sql` (si aún no está)
- `supabase/migrations/20261105203000_flashfood_mobile_dispatch.sql`

La migración nueva crea tablas **flashfood_mobile_orders**, **flashfood_mobile_order_items**, **flashfood_mobile_driver_positions** y la RPC `flashfood_mobile_assign_driver`. NO inserta ni modifica pedidos de POS existentes.
**No repitas SQL migratorio parcialmente aplicado sin revisar el estado del esquema.**

## 2. Secrets de Supabase
Obligatorio para rutas y pedidos:
- `OPENROUTESERVICE_API_KEY`: API Key de OpenRouteService (directions/driving-car).
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`: configuración habitual de las funciones.

Tarjetas, **solo después de verificar pruebas e impuestos**:
- `PAYPHONE_TOKEN`: Token PayPhone correspondiente al ambiente elegido.
- `PAYPHONE_STORE_ID`: Store ID del comercio que efectuará el cobro.
- `PAYPHONE_RESPONSE_URL`: URL pública del callback **flashfood-payphone-return** registrada/permitida en PayPhone Developer.
- `PAYPHONE_ENABLE_LIVE_CHARGES`: por defecto deshabilitado. **No establecer `true` sin validar ambiente, desglose IVA, SRI, return URL y flujo de conciliación**.

El flujo PayPhone implementado usa Button/Prepare y Button/V2/Confirm. El callback comprueba estado Approved, monto, moneda, clientTransactionId y transactionId antes de actualizar el pedido. El proveedor debe poder acceder a su URL de retorno sin JWT de usuario.

## 3. Deploy de Edge Functions
```bash
npx supabase functions deploy flashfood-superadmin
npx supabase functions deploy flashfood-role-access
npx supabase functions deploy flashfood-delivery-quote
npx supabase functions deploy flashfood-mobile-orders
npx supabase functions deploy flashfood-payphone-return --no-verify-jwt
```
No dejar `--no-verify-jwt` habilitado en las demás funciones.

## 4. Compilación web y native
```bash
git status
git pull --rebase origin main
npm ci
npm run build
npm run lint
npx cap sync ios
npx cap sync android
```
Se requiere compilar/reinstalar en Xcode y Android Studio. Si `git pull` o `npm run build` falla, no continuar con sync.

## 5. Validación de negocio
1. En Superadmin, guardar la tarifa global; comprobar coordenadas de la sucursal y estados de disponibilidad.
2. Registrar repartidor, activar y verificar, y conectarse desde su panel.
3. Guardar dirección de cliente con GPS (sin coordenadas no se cotiza).
4. Verificar ruta vial y el precio estimado, comprobar contra trayecto de navegación.
5. Probar efectivo: crear pedido, despacho en Superadmin si es necesario, aceptar, recoger, entregar con confirmación de efectivo, conciliar en Superadmin.
6. Probar transferencia: crear pedido pendiente, verificar ingreso bancario fuera de la app, aprobar en Superadmin y despachar.
7. Verificar que el cliente solo ve su propio historial/posición; que el GPS se detiene al ocultar la app o finalizar entrega.
8. Probar pedidos simultáneos con un solo repartidor; nunca asignar ambos al mismo tiempo.
9. PayPhone: únicamente **sandbox** y con conciliación real verificada. No habilitar cobros de producción sin definir el tratamiento del IVA y las facturas de negocio/plataforma.

## Limitaciones explícitas
- El GPS se transmite **solo con la app en primer plano** durante una entrega aceptada o recogida. No hay tracking en segundo plano.
- Los pedidos de la app usan tablas separadas: falta integración de movimientos ERP, descuentos POS, facturación electrónica SRI y liquidaciones comerciales.
- Efectivo y transferencias requieren conciliación, el cliente nunca puede marcar unilateralmente un pago como aprobado.
- El sistema de asignación es bajo demanda; si no hay repartidor, el pedido `placed` queda pendiente. Superadmin puede ejecutar «Despachar pendientes».
- Tarifa PayPhone del frontend (15 %) y desglose impositivo requieren validación antes de habilitar producción.
