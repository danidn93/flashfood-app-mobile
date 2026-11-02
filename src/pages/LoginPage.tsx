import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Apple,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  UserRound,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { Capacitor } from '@capacitor/core'
import {
  iniciarSesionConCorreo,
  registrarConCorreo,
  recuperarContrasena,
} from '../services/auth'

type Modo = 'login' | 'registro' | 'recuperar'

export default function LoginPage() {
  const navigate = useNavigate()
  const [modo, setModo] = useState<Modo>('login')
  const [nombre, setNombre] = useState('')
  const [correo, setCorreo] = useState('')
  const [contrasena, setContrasena] = useState('')
  const [mostrarContrasena, setMostrarContrasena] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  const esIOS = Capacitor.getPlatform() === 'ios'

  function cambiarModo(nuevoModo: Modo) {
    setModo(nuevoModo)
    setError('')
    setMensaje('')
    setContrasena('')
  }

  async function enviarFormulario(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (procesando) return

    setProcesando(true)
    setError('')
    setMensaje('')

    try {
      if (modo === 'recuperar') {
        await recuperarContrasena(correo)

        setMensaje(
          'Si el correo está registrado, recibirás instrucciones para restablecer tu contraseña.',
        )
        return
      }

      if (modo === 'registro') {
        if (nombre.trim().length < 2) {
          throw new Error('Ingresa tu nombre completo.')
        }

        if (contrasena.length < 8) {
          throw new Error('La contraseña debe tener al menos 8 caracteres.')
        }

        const resultado = await registrarConCorreo(
          nombre,
          correo,
          contrasena,
        )

        if (resultado.session) {
          navigate('/perfil', { replace: true })
        } else {
          setMensaje(
            'Tu cuenta fue registrada. Revisa tu correo electrónico y confirma tu dirección antes de iniciar sesión.',
          )
          setContrasena('')
        }

        return
      }

      await iniciarSesionConCorreo(correo, contrasena)
      navigate('/perfil', { replace: true })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error. Inténtalo nuevamente.',
      )
    } finally {
      setProcesando(false)
    }
  }

  const titulo =
    modo === 'registro'
      ? 'Crea tu cuenta'
      : modo === 'recuperar'
        ? 'Recupera tu acceso'
        : '¡Qué gusto verte!'

  const subtitulo =
    modo === 'registro'
      ? 'Regístrate para disfrutar de FlashFood.'
      : modo === 'recuperar'
        ? 'Te enviaremos instrucciones a tu correo.'
        : 'Inicia sesión y disfruta de tus restaurantes favoritos.'

  return (
    <main className="min-h-dvh bg-[#F7F8FA] px-5 pb-12 pt-6">
      <div className="mx-auto max-w-[420px]">
        <Link
          to="/"
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white text-gray-700 shadow-sm"
          aria-label="Volver al inicio"
        >
          <ArrowLeft size={20} />
        </Link>

        <div className="mb-8 mt-8 text-center">
          <img
            src="/flashfood-logo.png"
            alt="FlashFood"
            className="mx-auto h-20 w-20 rounded-2xl object-contain"
          />

          <h1 className="mt-6 text-[26px] font-extrabold tracking-tight text-[#171717]">
            {titulo}
          </h1>

          <p className="mx-auto mt-2 max-w-[300px] text-[13px] leading-5 text-gray-500">
            {subtitulo}
          </p>
        </div>

        <div className="rounded-[24px] border border-gray-100 bg-white p-5 shadow-[0_4px_24px_rgba(0,0,0,0.035)]">
          {modo !== 'recuperar' && (
            <div className="mb-6 grid grid-cols-2 rounded-xl bg-[#F4F5F7] p-1">
              <button
                type="button"
                onClick={() => cambiarModo('login')}
                className={`rounded-lg py-2.5 text-[13px] font-bold transition ${
                  modo === 'login'
                    ? 'bg-white text-[#F97316] shadow-sm'
                    : 'text-gray-500'
                }`}
              >
                Iniciar sesión
              </button>

              <button
                type="button"
                onClick={() => cambiarModo('registro')}
                className={`rounded-lg py-2.5 text-[13px] font-bold transition ${
                  modo === 'registro'
                    ? 'bg-white text-[#F97316] shadow-sm'
                    : 'text-gray-500'
                }`}
              >
                Registrarse
              </button>
            </div>
          )}

          <form onSubmit={enviarFormulario} className="space-y-4">
            {modo === 'registro' && (
              <div>
                <label
                  htmlFor="nombre"
                  className="mb-2 block text-[12px] font-bold text-gray-700"
                >
                  Nombre completo
                </label>

                <div className="flex h-12 items-center gap-3 rounded-xl border border-gray-200 px-3 focus-within:border-orange-400">
                  <UserRound size={18} className="text-gray-400" />

                  <input
                    id="nombre"
                    type="text"
                    autoComplete="name"
                    required
                    value={nombre}
                    onChange={(event) => setNombre(event.target.value)}
                    placeholder="Tu nombre completo"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </div>
              </div>
            )}

            <div>
              <label
                htmlFor="correo"
                className="mb-2 block text-[12px] font-bold text-gray-700"
              >
                Correo electrónico
              </label>

              <div className="flex h-12 items-center gap-3 rounded-xl border border-gray-200 px-3 focus-within:border-orange-400">
                <Mail size={18} className="text-gray-400" />

                <input
                  id="correo"
                  type="email"
                  autoComplete="email"
                  required
                  value={correo}
                  onChange={(event) => setCorreo(event.target.value)}
                  placeholder="correo@ejemplo.com"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </div>
            </div>

            {modo !== 'recuperar' && (
              <div>
                <label
                  htmlFor="contrasena"
                  className="mb-2 block text-[12px] font-bold text-gray-700"
                >
                  Contraseña
                </label>

                <div className="flex h-12 items-center gap-3 rounded-xl border border-gray-200 px-3 focus-within:border-orange-400">
                  <LockKeyhole size={18} className="text-gray-400" />

                  <input
                    id="contrasena"
                    type={mostrarContrasena ? 'text' : 'password'}
                    autoComplete={
                      modo === 'registro'
                        ? 'new-password'
                        : 'current-password'
                    }
                    minLength={modo === 'registro' ? 8 : undefined}
                    required
                    value={contrasena}
                    onChange={(event) =>
                      setContrasena(event.target.value)
                    }
                    placeholder="Ingresa tu contraseña"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />

                  <button
                    type="button"
                    onClick={() =>
                      setMostrarContrasena(!mostrarContrasena)
                    }
                    aria-label={
                      mostrarContrasena
                        ? 'Ocultar contraseña'
                        : 'Mostrar contraseña'
                    }
                    className="text-gray-400"
                  >
                    {mostrarContrasena ? (
                      <EyeOff size={18} />
                    ) : (
                      <Eye size={18} />
                    )}
                  </button>
                </div>
              </div>
            )}

            {modo === 'login' && (
              <button
                type="button"
                onClick={() => cambiarModo('recuperar')}
                className="block w-full text-right text-[12px] font-bold text-[#F97316]"
              >
                ¿Olvidaste tu contraseña?
              </button>
            )}

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-[12px] text-red-700"
              >
                <AlertCircle size={17} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {mensaje && (
              <div
                role="status"
                className="flex items-start gap-2 rounded-xl bg-green-50 p-3 text-[12px] text-green-700"
              >
                <CheckCircle2 size={17} className="shrink-0" />
                <span>{mensaje}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={procesando}
              className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#F97316] text-[14px] font-extrabold text-white transition hover:bg-orange-600 disabled:opacity-60"
            >
              {procesando && (
                <LoaderCircle size={18} className="animate-spin" />
              )}

              {modo === 'registro'
                ? 'Crear cuenta'
                : modo === 'recuperar'
                  ? 'Enviar instrucciones'
                  : 'Iniciar sesión'}
            </button>
          </form>

          {modo === 'recuperar' && (
            <button
              type="button"
              onClick={() => cambiarModo('login')}
              className="mt-5 w-full text-center text-[13px] font-bold text-[#F97316]"
            >
              Volver a iniciar sesión
            </button>
          )}

          {modo !== 'recuperar' && esIOS && (
            <div className="mt-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-[11px] text-gray-400">
                  O continúa con
                </span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <button
                type="button"
                disabled
                title="Disponible cuando se complete la integración nativa con Apple"
                className="flex h-[50px] w-full items-center justify-center gap-2 rounded-xl bg-[#171717] text-[14px] font-bold text-white opacity-60"
              >
                <Apple size={20} />
                Continuar con Apple
              </button>

              <p className="mt-2 text-center text-[11px] text-gray-400">
                Integración con Apple en preparación
              </p>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-[12px] leading-5 text-gray-500">
          Puedes explorar restaurantes sin iniciar sesión.
        </p>

        <Link
          to="/"
          className="mt-3 block text-center text-[13px] font-bold text-[#F97316]"
        >
          Continuar explorando
        </Link>
      </div>
    </main>
  )
}
