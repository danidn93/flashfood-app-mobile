# Facturación electrónica de FlashFood — configuración multiproyecto

## Arquitectura

Se utilizan **dos Supabase independientes**. Nunca ejecutar migraciones de un proyecto en el otro.

1. **FlashFood App Mobile** (proyecto donde ya funciona la app)
   - Perfil de emisor propio en `flashfood_platform_fiscal_profile`.
   - Certificado PKCS#12 de FlashFood en bucket privado `flashfood-fiscal-private`.
   - Contraseña de la firma cifrada AES-256-GCM usando la variable de entorno `FLASHFOOD_FISCAL_ENCRYPTION_KEY`.
   - Adhesión por negocio en `flashfood_merchant_fiscal_settings`, enlazada mediante `negocio_origen_id` al UUID de Multicomercios.
   - Datos fiscales privados del comprador en `flashfood_mobile_order_billing`.
   - Trabajos pendientes en `flashfood_invoice_jobs`; sin emisión automática hasta integración fiscal verificada.
   - El cliente y el repartidor no pueden leer claves, certificados ni datos de facturación internos.

2. **Multicomercios** — project id `xzngpapmyqkssdzbclpc`
   - Campo `public.negocios.flashfood_facturacion_habilitada` y toggle en Superadmin, **false por defecto**.
   - Se exige también `public.negocios.fe_habilitada = true`.
   - Se conserva el flujo fiscal de `procesar-comprobante-venta` y su uso de `certificados`, `configuracion_facturacion`, `puntos_emision`, etc.
   - `procesar-comprobante-venta` recibe **un `venta_id` válido en `pos_ventas` de Multicomercios**. Un UUID de FlashFood no es una venta del ERP.
   - Nunca pasar tokens Service Role del ERP al frontend de FlashFood.

## Migraciones

### En el Supabase de FlashFood

Ejecutar en orden:
1. `supabase/migrations/20261106014500_flashfood_fiscal_vault.sql`
2. `supabase/migrations/20261106022500_flashfood_invoice_queue.sql`

Este último asume que `flashfood_mobile_orders` ya existe (migración de checkout anterior).

### En Multicomercios (`xzngpapmyqkssdzbclpc`)

Ejecutar **solo**:
- `supabase/migrations/20261106015000_negocios_flashfood_facturacion.sql`

Ninguno de estos cambios habilita automáticamente facturación en producción.

## Configurar cifrado de contraseña

En un entorno local seguro:
```bash
openssl rand -hex 32
```

Registrar ese valor como **secret de Supabase del proyecto FlashFood**, con el nombre:
`FLASHFOOD_FISCAL_ENCRYPTION_KEY`.

**No pegar esta clave en el chat, no colocarla en el repositorio, no crear variables `VITE_*` con ella.**
Resguardar una copia fuera de línea en un gestor de secretos y planificar la rotación; sin la clave no podrá recuperarse una contraseña cifrada ya guardada.

Desplegar:
```bash
npx supabase functions deploy flashfood-fiscal-admin
```

## Configuración desde la app

Superadmin → Facturación SRI:
1. Registrar RUC, razón social, dirección matriz, establecimiento y punto de emisión.
2. Seleccionar ambiente **Pruebas**.
3. Guardar.
4. Adjuntar firma `.p12` o `.pfx` y contraseña; solo Superadmin puede realizarlo. El navegador envía el archivo por HTTPS a la Edge; el servidor almacena el PKCS#12 en bucket privado y cifra la contraseña.
5. Configurar adhesión de comercios y, para negocios Multicomercios, el UUID real en el ERP.
6. En Superadmin de Multicomercios, habilitar `Facturación electrónica` y luego `Facturación de pedidos FlashFood` en los negocios elegidos.

La app **no muestra el certificado ni su contraseña**, ni el frontend tiene permisos de lectura del vault.

## Lo que falta para emitir comprobantes reales (bloqueado deliberadamente)

1. Una pasarela servidor-a-servidor autenticada entre FlashFood y Multicomercios, con autenticación independiente, autorización por negocio y registro de auditoría.
2. Convertir el pedido FlashFood a **`pos_ventas`/ `pos_venta_items` y `pos_venta_pagos` fiscales válidos** en el ERP, sin duplicar ventas ni movimientos de inventario. Reconciliar ID negocio y sucursal, productos/IVA/precios, consumidor final o cliente identificado, pago y estado.
3. Invocar `procesar-comprobante-venta` con el `venta_id` del ERP, nunca con el `order_id` de FlashFood.
4. Endurecer permisos de `procesar-comprobante-venta`: actualmente la función recibida revisa la presencia de un Bearer, pero utiliza Service Role para acceder a cualquier venta. El puente debe autenticar y autorizar de forma estricta cada emisión.
5. Emisor FlashFood: adaptar la rutina SRI a comprobantes propios de cargos de plataforma, con secuencial independiente y RUC del emisor FlashFood.
6. Revisar tratamiento tributario y comprobantes correspondientes a productos, cargo de plataforma, delivery y propinas, y cuándo se factura cada uno.
7. Probar SRI PRUEBAS: generación XML, certificado, firma, recepción, autorización, RIDE, reintentos, errores e idempotencia. Solo entonces permitir PROD.

**Nota de seguridad sobre firmador de Render:** el código del ERP que compartiste envía el PKCS#12 y la contraseña al servicio `firmador-facturas.onrender.com` para firmar. Esto permite al servicio firmador acceder al material sensible mientras procesa la firma. Antes de reutilizarlo para FlashFood hay que verificar su autenticación, aislamiento, logging, retención de secretos y propiedad del servicio. El certificado NO se envía a Render solo por cargarlo en Superadmin de FlashFood; el sistema actual lo conserva privado e inactivo.

## Validaciones de despliegue

- Revisa que las tablas y storage existan en **el proyecto correcto**.
- En la app, guarda perfil fiscal en PRUEBAS, sube firma y comprueba que no puede verse ni descargarse desde el frontend ni desde APIs anónimas.
- Verifica que un usuario sin rol Superadmin recibe 403 en `flashfood-fiscal-admin`.
- Verifica opt-in ERP y la correspondencia de IDs de negocios entre los dos proyectos.
- Prueba la creación de pedido con consumidor final y con comprador identificado. La creación debe guardar `flashfood_mobile_order_billing` y, donde aplique, `flashfood_invoice_jobs` sin emitir facturas.
- **Nunca habilites el envío al SRI antes de aprobar los pasos de seguridad y fiscalidad precedentes**.
