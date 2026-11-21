# Plantillas de correo de FlashFood para Supabase Auth

En Supabase Dashboard → Authentication → Email Templates, pega cada HTML en su tipo de mensaje:
- **Invite user:** invite.html — asunto: Invitación a FlashFood — Activa tu cuenta
- **Confirm sign up:** confirmation.html — asunto: Confirma tu correo electrónico | FlashFood
- **Reset password:** recovery.html — asunto: Restablece tu contraseña | FlashFood
- **Magic link:** magic_link.html — asunto: Tu enlace de acceso | FlashFood
- **Change email address:** email_change.html — asunto: Confirma el cambio de correo | FlashFood
- **Reauthentication:** reauthentication.html — asunto: Tu código de verificación | FlashFood

Se debe mantener intacto `{{ .ConfirmationURL }}`, o `{{ .Token }}` para reautenticación.

## Requisitos antes de usar las invitaciones
Configura Authentication → URL Configuration con el dominio HTTPS real y las Redirect URLs admitidas. El enlace de invitación debe acabar en una ruta funcional que permita establecer contraseña con una sesión válida; esta implementación de UI aún debe completarse. El correo HTML por sí solo no crea esa ruta. Configura SMTP propio verificado para uso en producción. Prueba los flujos de invitación, confirmación, recuperación y cambio de correo.

El HTML es plantilla para pegar manualmente en Supabase; subirlo a GitHub no modifica automáticamente el dashboard de Authentication.
