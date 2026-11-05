import { supabase } from '../lib/supabase'

export type DireccionEntrega = {
  id: string
  user_id: string
  label: string
  address_line: string
  city: string
  reference: string
  latitude: number | null
  longitude: number | null
  is_default: boolean
}

const EVENTO = 'flashfood:direccion-actualizada'
const storageKey = (userId: string) => `flashfood:direccion-seleccionada:${userId}`
const notify = () => window.dispatchEvent(new Event(EVENTO))

export async function usuarioDirecciones(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser()
  if (error) return null
  return data.user?.id ?? null
}
export async function listarDirecciones(): Promise<DireccionEntrega[]> {
  const userId = await usuarioDirecciones()
  if (!userId) return []
  const { data, error } = await supabase.from('flashfood_customer_addresses')
    .select('id,user_id,label,address_line,city,reference,latitude,longitude,is_default')
    .eq('user_id', userId).order('updated_at', { ascending: false })
  if (error) throw error
  return data as DireccionEntrega[]
}
export async function direccionSeleccionada(): Promise<DireccionEntrega | null> {
  const userId = await usuarioDirecciones()
  if (!userId) return null
  const addresses = await listarDirecciones()
  const selected = localStorage.getItem(storageKey(userId))
  return addresses.find(x => x.id === selected) || addresses.find(x => x.is_default) || addresses[0] || null
}
export async function seleccionarDireccion(id: string): Promise<void> {
  const userId = await usuarioDirecciones()
  if (!userId) throw new Error('Inicia sesión para seleccionar una dirección.')
  const { data, error } = await supabase.from('flashfood_customer_addresses')
    .select('id').eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('La dirección seleccionada no existe.')
  localStorage.setItem(storageKey(userId), id)
  notify()
}
export async function guardarDireccion(input: Omit<DireccionEntrega,'id'|'user_id'|'is_default'>, id?: string): Promise<DireccionEntrega> {
  const userId = await usuarioDirecciones()
  if (!userId) throw new Error('Inicia sesión para guardar direcciones.')
  const payload = { ...input, user_id: userId, updated_at: new Date().toISOString() }
  const query = id
    ? supabase.from('flashfood_customer_addresses').update(payload).eq('id', id).eq('user_id', userId)
    : supabase.from('flashfood_customer_addresses').insert(payload)
  const { data, error } = await query.select('id,user_id,label,address_line,city,reference,latitude,longitude,is_default').single()
  if (error) throw error
  localStorage.setItem(storageKey(userId), data.id)
  notify()
  return data as DireccionEntrega
}
export async function eliminarDireccion(id: string): Promise<void> {
  const userId = await usuarioDirecciones()
  if (!userId) throw new Error('Inicia sesión.')
  const { error } = await supabase.from('flashfood_customer_addresses').delete().eq('id', id).eq('user_id', userId)
  if (error) throw error
  if (localStorage.getItem(storageKey(userId)) === id) localStorage.removeItem(storageKey(userId))
  notify()
}
export function observarDireccion(callback: () => void): () => void {
  window.addEventListener(EVENTO, callback)
  return () => window.removeEventListener(EVENTO, callback)
}
