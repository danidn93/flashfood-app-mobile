# Roles y permisos — FlashFood Mobile

## Archivos
- `src/services/roles.ts`: acceso autenticado a permisos.
- `src/components/RoleGuard.tsx`: protección de rutas.
- `src/pages/BusinessAdminWorkspace.tsx`: negocio asignado, delivery gratis, empleados.
- `src/pages/EmployeePage.tsx`: acceso inicial de empleado.
- `src/pages/DriverPage.tsx`: acceso inicial de repartidor.
- `supabase/functions/flashfood-role-access/index.ts`: backend protegido para usuarios y negocio.
- `supabase/functions/flashfood-superadmin/index.ts`: asignación global por correo.
- `supabase/migrations/20261102180000_flashfood_business_access.sql`: tablas de asignaciones y delivery gratis.

## Despliegue obligatorio
1. Respaldar el proyecto y ejecutar la migración SQL en el proyecto Supabase correcto. Revisar el esquema de `locales` y `sucursales`; se asume `sucursales.local_id`.
2. Desplegar:
   ```bash
   supabase functions deploy flashfood-role-access
   supabase functions deploy flashfood-superadmin
   ```
3. Ejecutar `npm install`, `npm run build` y `npm run lint` antes de publicar.
4. Iniciar sesión como Superadmin → Roles → indicar **correo**. Para admin/empleado, seleccionar negocio. Para delivery, elegir delivery. La invitación crea la cuenta sin contraseña predeterminada, usando el correo de Supabase.
5. Iniciar sesión con cada cuenta y verificar la aparición de sus paneles en Mi perfil.

## Reglas
- Todos los roles conservan permisos de cliente y pueden pedir.
- El rol global por sí solo **no autoriza** leer otros negocios: se requiere `flashfood_business_access` activo.
- El administrador de negocio solo puede invitar/asignar empleados de su negocio, nunca administradores ni superadministradores.
- El Superadmin asigna roles por correo. El rol delivery requiere también el alta operativa en `flashfood_drivers`.
- La configuración `flashfood_business_settings.free_delivery` no cambia la tarifa global. El checkout todavía debe consumirla desde una operación segura y persistir `shipping_real`, `shipping_paid_by_customer=0`, `shipping_paid_by_business` y `tip` separados.
- Paneles de delivery y empleados son la **base de acceso**: no se deben confundir con despacho/GPS, aceptación de pedidos o liquidaciones operativas terminadas.

## Seguridad y limitaciones
- Las claves de administrador de Supabase se usan exclusivamente en Edge Functions.
- Este cambio no ejecuta migraciones ni despliega funciones en Supabase automáticamente.
- Las pruebas de build requieren ejecutar los comandos en la rama o CI.
- La búsqueda de usuarios por correo utiliza la API de administración con paginación; para una escala alta se recomienda una función de lookup indexada.
- La asociación a sucursales específicas y asignación detallada de permisos operativos requiere validar las relaciones reales de la base.
