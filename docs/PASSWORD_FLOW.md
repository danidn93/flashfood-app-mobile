# FlashFood Mobile — activación y contraseñas

Implementado directamente en `main`:
- `/establecer-contrasena`: activar una cuenta creada por invitación del Superadmin.
- `/restablecer-contrasena`: establecer una contraseña desde enlace de recuperación.
- `/cambiar-contrasena`: cambiar contraseña desde Mi perfil, validando la actual.
- La aplicación valida los tokens de Supabase Auth y nunca guarda contraseñas en tablas propias.

## Configuración de Supabase (obligatoria)
1. En **Edge Functions → Secrets**, define `FLASHFOOD_APP_URL` con la URL pública HTTPS real de FlashFood (solo origen, por ejemplo `https://tu-dominio.com`, sin rutas). La función `flashfood-superadmin` dirige las invitaciones a `/establecer-contrasena`.
2. Despliega la función actualizada: `supabase functions deploy flashfood-superadmin`.
3. En **Authentication → URL Configuration**, añade estas **Redirect URLs**:
   - `https://tu-dominio.com/establecer-contrasena`
   - `https://tu-dominio.com/restablecer-contrasena`
4. Asegúrate de que el alojamiento web devuelve el `index.html` de la SPA para estas rutas.
5. En **Authentication → Email Templates**, mantén el enlace `{{ .ConfirmationURL }}` en las plantillas de **Invite user** y **Reset password**. No cambies estas variables por URL estáticas.
6. Verifica que Supabase envíe correos (SMTP) y que el dominio esté registrado como redirect permitido.

## Pruebas
- Superadmin → Usuarios → Crear usuario → aceptar invitación → establecer contraseña → perfil.
- Login → ¿Olvidaste tu contraseña? → enlace recibido → establecer nueva contraseña.
- Perfil → Cambiar contraseña → contraseña actual y nueva → ingreso con nueva contraseña.

Nota: el enlace de invitación recibido **antes** de actualizar la función puede continuar apuntando al dominio/ruta anteriores; genera una invitación nueva para probar. El token de invitación o recuperación debe corresponder al flujo; no basta con abrir la URL directamente.
