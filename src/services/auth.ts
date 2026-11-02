import { supabase } from '../lib/supabase'

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
  const { error } = await supabase.auth.signOut()

  if (error) throw error
}
