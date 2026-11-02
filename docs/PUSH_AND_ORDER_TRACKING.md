# FlashFood — push Android/iOS y seguimiento en pantalla bloqueada

## Aplicado al código
- Android: permiso `POST_NOTIFICATIONS` declarado explícitamente; el permiso se solicita en `src/App.tsx` y la app registra un token FCM.
- iOS: `AppDelegate.swift` reenvía los callbacks APNs al plugin Capacitor. `NSSupportsLiveActivities` está habilitado en `Info.plist`.
- Los tokens push todavía NO se persisten en Supabase. No almacenar tokens completos en logs.

## Configuración obligatoria fuera del repositorio
1. En Firebase Console, registrar la aplicación iOS con el Bundle ID real de Xcode y agregar `GoogleService-Info.plist` al target `App`.
2. Configurar APNs Authentication Key (.p8) en Firebase Cloud Messaging para iOS (Apple Developer Team ID, Key ID).
3. En Xcode > target App > Signing & Capabilities, activar `Push Notifications`; asegurar provisioning y dispositivo físico para ensayar APNs.
4. Para Live Activities, crear un target **Widget Extension** con la opción **Include Live Activity**, deployment target iOS 16.1 o posterior. Incluir los tres archivos Swift de `ios/FlashFoodOrderWidgetSources/` en el target de extensión. Compartir `FlashFoodOrderAttributes.swift` con el target App si se usará ActivityKit en la app.
5. Si se usa una actividad en curso, iniciar, actualizar y finalizar con ActivityKit al recibir datos AUTÉNTICOS del pedido, y configurar las actualizaciones remotas a través de APNs (tokens ActivityKit).
6. Android: para seguimiento continuo en pantalla bloqueada, crear la notificación nativa actualizable ligada a eventos reales del pedido. La push convencional de Capacitor no constituye seguimiento en vivo.

## Pendiente para funcionamiento integral
- Crear registro de dispositivos y consentimientos asociados a usuarios en Supabase.
- Conectar el ciclo de vida de órdenes reales del marketplace a un servicio seguro de envío y a las notificaciones.
- Construir bridge nativo Capacitor para ActivityKit (inicio, actualización y cierre).
- Implementar notificación Android actualizable (canal, pending intent y seguridad).
- Agregar creación y despacho de campañas autorizado para superadmin, preferencias y auditoría.
- Configurar claves FCM HTTP v1/APNs en el backend, sin incluir credenciales privadas en cliente.
- Verificar compilación iOS mediante Xcode. GitHub CI de Linux solo valida el build web.
