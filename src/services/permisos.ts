import { supabase } from '../lib/supabase'

/** Consulta una operación protegida; no confía en metadatos editables del cliente. */
export async function verificarSuperadmin(): Promise<boolean> {
  const { data: userData, error: authError } = await supabase.auth.getUser()
  if (authError || !userData.user) return false
  const { data, error } = await supabase.functions.invoke('flashfood-superadmin', {
    body: { action: 'dashboard' },
  })
  return !error && data?.ok === true
}
