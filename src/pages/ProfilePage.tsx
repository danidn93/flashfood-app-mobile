import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { User } from '@supabase/supabase-js'
import {
  UserRound,
  Mail,
  LogOut,
  ChevronRight,
  ShieldCheck,
  Shield,
  Trash2,
  LoaderCircle,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { cerrarSesion } from '../services/auth'
import { verificarSuperadmin } from '../services/permisos'

export default function ProfilePage() {
  const navigate = useNavigate()
  const [usuario, setUsuario] = useState<User | null>(null)
  const [cargando, setCargando] = useState(true)
  const [cerrando, setCerrando] = useState(false)
  const [error, setError] = useState('')
  const [esSuperadmin, setEsSuperadmin] = useState(false)

  useEffect(() => {
    let activo = true

    void supabase.auth.getUser().then(({ data, error }) => {
      if (!activo) return
      setUsuario(error ? null : data.user)
      setCargando(false)
    })

    const { data: suscripcion } = supabase.auth.onAuthStateChange(
      (_evento, sesion) => {
        if (activo) {
          setUsuario(sesion?.user ?? null)
          setCargando(false)
        }
      },
    )

    return () => {
      activo = false
      suscripcion.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    let activo = true
    setEsSuperadmin(false)
    if (usuario) {
      void verificarSuperadmin().then((permitido) => {
        if (activo) setEsSuperadmin(permitido)
      })
    }
    return () => { activo = false }
  }, [usuario?.id])

  async function salir() {
    if (cerrando) return

    setCerrando(true)
    setError('')

    try {
      await cerrarSesion()
      navigate('/', { replace: true })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudo cerrar la sesión.',
      )
    } finally {
      setCerrando(false)
    }
  }

  if (cargando) {
    return (
      <main className="flex min-h-[50vh] items-center justify-center">
        <LoaderCircle
          size={28}
          className="animate-spin text-[#F97316]"
        />
      </main>
    )
  }

  if (!usuario) {
    return (
      <main className="mx-auto max-w-lg px-5 pb-28 pt-10">
        <div className="rounded-3xl bg-white px-6 py-10 text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-orange-50">
            <UserRound size={36} className="text-[#F97316]" />
          </div>

          <h1 className="mt-5 text-2xl font-extrabold text-[#171717]">
            Tu cuenta FlashFood
          </h1>

          <p className="mt-3 text-sm leading-6 text-gray-500">
            Inicia sesión para administrar tus datos,
            direcciones y consultar tus pedidos.
          </p>

          <Link
            to="/login"
            className="mt-7 flex h-12 items-center justify-center rounded-xl bg-[#F97316] text-sm font-bold text-white"
          >
            Iniciar sesión o registrarse
          </Link>

          <Link
            to="/"
            className="mt-5 block text-sm font-semibold text-gray-500"
          >
            Continuar explorando
          </Link>
        </div>
      </main>
    )
  }

  const nombre =
    typeof usuario.user_metadata?.full_name === 'string'
      ? usuario.user_metadata.full_name
      : 'Cliente FlashFood'

  return (
    <main className="mx-auto max-w-lg px-4 pb-28 pt-6">
      <h1 className="mb-5 text-xl font-extrabold text-[#171717]">
        Mi perfil
      </h1>

      <section className="rounded-2xl border border-gray-100 bg-white p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-orange-50">
            <UserRound size={27} className="text-[#F97316]" />
          </div>

          <div className="min-w-0">
            <h2 className="truncate text-base font-extrabold text-gray-900">
              {nombre}
            </h2>

            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-gray-500">
              <Mail size={13} className="shrink-0" />
              {usuario.email ?? 'Correo no disponible'}
            </p>
          </div>
        </div>
      </section>

      {esSuperadmin && (
        <Link to="/superadmin" className="mt-4 flex items-center gap-3 rounded-2xl border border-orange-100 bg-white px-5 py-4">
          <Shield size={20} className="text-[#F97316]" />
          <span className="flex-1 text-sm font-bold text-gray-800">Panel Superadmin</span>
          <ChevronRight size={18} className="text-gray-400" />
        </Link>
      )}

      <section className="mt-4 overflow-hidden rounded-2xl border border-gray-100 bg-white">
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4">
          <ShieldCheck size={19} className="text-[#F97316]" />
          <span className="flex-1 text-sm font-semibold text-gray-800">
            Seguridad de la cuenta
          </span>
          <ChevronRight size={17} className="text-gray-300" />
        </div>

        <div className="flex items-center gap-3 px-5 py-4 opacity-60">
          <Trash2 size={19} className="text-red-500" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-red-600">
              Eliminar mi cuenta
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Disponible al completar el proceso seguro de eliminación
            </p>
          </div>
        </div>
      </section>

      {error && (
        <p role="alert" className="mt-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={() => void salir()}
        disabled={cerrando}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white text-sm font-bold text-gray-700 disabled:opacity-50"
      >
        {cerrando ? (
          <LoaderCircle size={18} className="animate-spin" />
        ) : (
          <LogOut size={18} />
        )}
        Cerrar sesión
      </button>
    </main>
  )
}
