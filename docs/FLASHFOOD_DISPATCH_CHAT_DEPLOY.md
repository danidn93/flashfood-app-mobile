# FlashFood — despacho, chat y seguimiento móvil (Locales)

**Proyecto:** Supabase de Locales (NO el ERP Multicomercios). Los cambios de este documento requieren despliegue manual. No habilitar para pedidos reales sin validar el flujo completo.

## 1. Migraciones en SQL Editor, en este orden

1. Si no se aplicó aún: `supabase/migrations/20261106200000_flashfood_driver_identity.sql`.
2. Aplicar `supabase/migrations/20261106213000_flashfood_workflow_chat_dispatch.sql` **solo una vez**; incluye tablas de estados, historial del chat, ubicación de repartidores, ofertas con vencimiento de 60 segundos, RPCs de aceptación atómica y trabajo por minuto.
3. En Supabase, **Database → Extensions** habilitar `pg_cron` antes de ejecutar la segunda migración, si se desea el respaldo de rotación SQL. La función SQL registra la tarea `flashfood_delivery_offers_tick` solo cuando detecta la extensión.

La migración no reescribe facturas, totales ni métodos de pago.

## 2. Edge Functions

En el repositorio móvil y con el proyecto de Locales enlazado:
```bash
npx supabase functions deploy flashfood-role-access
npx supabase functions deploy flashfood-mobile-orders
npx supabase functions deploy flashfood-payphone-return
npx supabase functions deploy flashfood-delivery-worker --no-verify-jwt
```

`flashfood-delivery-worker` **no es un endpoint público utilizable libremente**: exige `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` y rechaza cualquier otra petición. No pongas esa clave en la app ni en el repositorio.

## 3. Notificación automática de ofertas

En **Supabase Cron**, crear una tarea **cada minuto** (`* * * * *`) que invoque por POST:

`https://<LOCAL_REF>.supabase.co/functions/v1/flashfood-delivery-worker`

Con cabecera privada `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`. Guarda la clave en **Supabase Vault** si se construye la tarea con SQL/pg_net, o usa el soporte de credenciales secretas del programador; **nunca insertar la clave literal en SQL público o commits**.

El worker llama `flashfood_tick_delivery_offers`, reintenta ofertas expiradas por proximidad y envía push al repartidor seleccionado. Configurar previamente los secrets APNs/FCM existentes. Si el worker no está programado, la app puede mostrar ofertas pendientes, pero las notificaciones y los relevos automáticos en segundo plano no están garantizados.

## 4. Compilar la app nativa

```bash
npm ci
npm run build
npx cap sync ios
npx cap open ios
```

Se añadió `@capacitor-community/background-geolocation@1.3.1` y los permisos iOS de ubicación siempre y en segundo plano. En Xcode verificar **Signing & Capabilities → Background Modes → Location updates**, permiso de ubicación del repartidor y funcionamiento con pantalla bloqueada en iPhone real. El watcher nativo se activa solo en entrega asignada y se detiene al salir de esa entrega. El navegador usa GPS solo en primer plano.

**Pendiente:** una Live Activity real requiere crear la extensión de WidgetKit/ActivityKit, registrar el token push-to-update y enviar los eventos APNs correspondientes. La clave `NSSupportsLiveActivities` existente NO equivale a esa integración.

## 5. Pruebas obligatorias antes de habilitar pedidos

- Repartidor verificado, con foto, vehículo, placa y ubicación reciente (menos de 3 minutos).
- Crear pedido de entrega; verificar pago cuando corresponda.
- Restaurante: **Recibido → Preparando → Listo**; al marcar listo se registra «En asignación».
- La oferta llega al repartidor más cercano. Rechazar: probar al segundo. Ignorar: esperar más de 60 segundos y observar la rotación por Cron.
- Dos repartidores aceptando a la vez: solo uno puede obtener asignación.
- Aceptar: etapa **Retirando**; entregar al repartidor historial del chat; restaurante conserva historial en modo lectura.
- Recogida: **En reparto**, GPS activo; finalizar: **Entregado**, GPS termina y chat de solo lectura.
- Bloquear la pantalla del iPhone durante una entrega y revisar envío real de posiciones; repetir con conexión intermitente.
- Verificar que un pedido con tarjeta/transferencia pendiente no pase a preparación ni despacho.
- Comprobar que las notificaciones push funcionan en el ambiente APNs/FCM correspondiente.

## 6. Integraciones posteriores

Los repositorios individuales de restaurantes se integrarán con `flashfood_orders` mediante un identificador idempotente por pedido/evento. Evitar crear una venta POS por cada reintento de mensaje. Verificar que un pedido FlashFood crea una sola venta y que el restaurante recibe novedades sin alterar su facturación original.
