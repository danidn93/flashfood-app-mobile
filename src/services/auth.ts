import { supabase } from '../lib/supabase'
import { getCurrentPushToken, forgetPushToken } from './pushDevice'

export async function registrarConCorreo(
  nombre: string,
  correo: string,
  contrasena: string,
) {
  const { data, error } = await supabase.auth.signUp({
    email: correo.trim().toLowerCase(),
    password: contrasena,
    options: {
      data: {
        full_name: nombre.trim(),
      },
    },
  })

  if (error) throw error
  return data
}

export async function iniciarSesionConCorreo(
  correo: string,
  contrasena: string,
) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: correo.trim().toLowerCase(),
    password: contrasena,
  })

  if (error) throw error
  return data
}

export async function recuperarContrasena(correo: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(
    correo.trim().toLowerCase(),
    {
      redirectTo: `${window.location.origin}/restablecer-contrasena`,
    },
  )

  if (error) throw error
}

export async function obtenerSesion() {
  const { data, error } = await supabase.auth.getSession()

  if (error) throw error
  return data.session
}

export async function cerrarSesion() {
  // Explicit logout must stop future campaigns for this device, unlike passive session expiry.
  const { data: sessionData } = await supabase.auth.getSession()
  if (sessionData.session) {
    const platform = (await import('@capacitor/core')).Capacitor.getPlatform()
    const token = getCurrentPushToken()
    if ((platform === 'android' || platform === 'ios') && token) {
      const { error: revokeError } = await supabase.from('flashfood_push_devices')
        .delete().eq('user_id', sessionData.session.user.id).eq('platform', platform).eq('token', token)
      if (revokeError) throw new Error(`No se pudo desvincular el dispositivo push: ${revokeError.message}`)
    }
  }
  const { error } = await supabase.auth.signOut()

  if (error) throw error
  forgetPushToken()
}
