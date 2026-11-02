import { useEffect, useState, type ReactNode } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { verificarSuperadmin } from '../services/permisos'

export default function SuperadminGuard({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<'cargando' | 'sin-sesion' | 'permitido' | 'denegado'>('cargando')
  useEffect(() => {
    let activo = true
    void (async () => {
      const { data } = await supabase.auth.getUser()
      if (!activo) return
      if (!data.user) { setEstado('sin-sesion'); return }
      const permitido = await verificarSuperadmin()
      if (activo) setEstado(permitido ? 'permitido' : 'denegado')
    })()
    return () => { activo = false }
  }, [])
  if (estado === 'cargando') return <main className="p-8 text-center">Verificando permisos…</main>
  if (estado === 'sin-sesion') return <Navigate to="/login" replace />
  if (estado === 'denegado') return <main className="mx-auto max-w-lg p-8 text-center"><h1 className="text-xl font-bold">Acceso restringido</h1><p className="my-4 text-gray-500">No se pudo verificar el acceso al panel Superadmin.</p><Link className="text-orange-600" to="/perfil">Volver a mi perfil</Link></main>
  return <>{children}</>
}
