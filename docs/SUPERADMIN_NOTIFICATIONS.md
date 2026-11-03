# FlashFood: Superadmin → Notificaciones

## Implementado
- Menú Notificaciones en `src/pages/SuperadminPage.tsx`: título, mensaje, audiencia, vista previa, borradores, confirmación de envío e historial.
- Acciones de `supabase/functions/flashfood-superadmin/index.ts`: `notifications`, `notification_create`, `notification_send`. Se ejecutan después de autenticar y validar el rol superadmin.
- Registro de tokens push por usuario autenticado desde `src/App.tsx`. Android usa el token FCM que entrega Capacitor; iOS usa token APNs, que enviamos directamente a APNs (no a Firebase).
- Al cerrar sesión expresamente, `cerrarSesion` elimina el token del dispositivo actual. No se desactiva por caducidad pasiva de sesión.
- Base de datos y RLS: `supabase/migrations/20261103030000_flashfood_push_campaigns.sql`.

## Pasos necesarios antes de usar el módulo
1. Ejecutar el SQL de la migración en Supabase (SQL Editor o migraciones locales). Hasta entonces la Edge indicará que las tablas no existen.
2. Desplegar **actualizada** la Edge Function: `supabase functions deploy flashfood-superadmin`.
3. Configurar secretos del proyecto Supabase (nunca almacenarlos en Git):
   - `FLASHFOOD_FIREBASE_SERVICE_ACCOUNT`: contenido JSON de una cuenta de servicio de Google con permiso para enviar mensajes FCM HTTP v1. Corresponde al mismo proyecto Firebase donde se registró la app Android.
   - `FLASHFOOD_APNS_PRIVATE_KEY`: contenido íntegro de la clave de autenticación APNs (.p8).
   - `FLASHFOOD_APNS_TEAM_ID`: Apple Developer Team ID.
   - `FLASHFOOD_APNS_KEY_ID`: APNs Key ID.
   - `FLASHFOOD_APNS_BUNDLE_ID`: `com.flashfood.mobile`.
   - `FLASHFOOD_APNS_ENVIRONMENT`: `sandbox` (compilación de desarrollo) o `production` (TestFlight/App Store).
4. Hacer `git pull --rebase origin main`, `npm install`, `npm run build`, `npx cap sync android`, `npx cap sync ios`. Reinstalar o volver a abrir la app y **tener sesión iniciada** en los dispositivos para registrar sus tokens.
5. En el panel, crear un borrador, seleccionar público y confirmar el envío. El estado `sent` significa aceptado por el proveedor (FCM/APNs), no que el usuario lo leyó.

## Límites actuales
- El envío es síncrono y se bloquea si una campaña supera 100 dispositivos seleccionados. No se envía parcialmente por superar el límite; hará falta cola de trabajos/worker para envíos masivos.
- Una campaña enviada o fallida no se reintenta desde el panel, para no duplicar avisos que ya pudieron entregarse.
- No hay programación por fecha ni segmentación geográfica; la audiencia son roles activos. Clientes son quienes no tienen roles de superadmin/admin/empleado/delivery.
- El contador de dispositivos incluye los activos globales, no solo los de la audiencia seleccionada.
- Tokens de iOS de desarrollo solo funcionan con el APNs `sandbox`; los de distribución requieren `production`. Si se mezclan ambos entornos en la misma tabla, se debe ampliar el esquema para almacenar el entorno por dispositivo antes de emitir campañas mixtas.
- La extensión Live Activities para seguimiento de pedidos es un flujo distinto y aún no actualiza estados reales.
- Al salir de la aplicación sin autenticarse no hay vínculo con auth.users y, por tanto, el dispositivo no se registra en esta fase. Las campañas envían a usuarios de la app autenticados, no a invitados anónimos.
