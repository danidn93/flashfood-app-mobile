import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './lib/supabase'
import { rememberPushToken } from './services/pushDevice'
import {
  obtenerCarrito,
  obtenerTiempoRestanteCarrito,
  suscribirseAlCarrito,
} from './services/carrito'
import CarritoPage from './pages/CarritoPage'
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom'
import { Bell, MapPin } from 'lucide-react'
import BottomNavigation from './components/BottomNavigation'
import HomePage from './pages/HomePage'
import RestaurantPage from './pages/RestaurantPage'
import LoginPage from './pages/LoginPage'
import ProfilePage from './pages/ProfilePage'
import SuperadminPage from './pages/SuperadminPage'
import SuperadminGuard from './components/SuperadminGuard'
import RoleGuard from './components/RoleGuard'
import BusinessAdminWorkspace from './pages/BusinessAdminWorkspace'
import EmployeePage from './pages/EmployeePage'
import DriverPage from './pages/DriverPage'
import PasswordPage from './pages/PasswordPage'

function SectionPage({ titulo }: { titulo: string }) {
  return (
    <main className="mx-auto max-w-5xl px-5 py-8">
      <h1 className="text-2xl font-bold text-gray-900">
        {titulo}
      </h1>

      <p className="mt-2 text-sm text-gray-500">
        Próximamente disponible en FlashFood.
      </p>
    </main>
  )
}

function AppLayout() {
  const location = useLocation()

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    let active = true
    let nativeToken: string | null = null

    const saveTokenForSignedInUser = async (tokenValue: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!active || !user) return
      const platform = Capacitor.getPlatform()
      if (platform !== 'ios' && platform !== 'android') return
      const { error } = await supabase.from('flashfood_push_devices').upsert({
        user_id: user.id, token: tokenValue, platform, active: true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'token' })
      if (error && active) console.error('[FlashFood Push] No se pudo registrar dispositivo:', error.message)
    }

    // Register the native token after login and token rotations. Do not log full tokens.
    const authSubscription = supabase.auth.onAuthStateChange((event) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') && nativeToken) {
        // Never await Supabase queries from inside its auth change callback.
        queueMicrotask(() => { if (active && nativeToken) void saveTokenForSignedInUser(nativeToken) })
      }
    })

    // Register listeners before calling register(): native callbacks may arrive quickly.
    const registration = PushNotifications.addListener('registration', (token) => {
      if (!active) return
      console.info('[FlashFood Push] Registro correcto, token recibido:', token.value.slice(0, 12) + '…')
      nativeToken = token.value
      rememberPushToken(token.value)
      void saveTokenForSignedInUser(token.value)
    })

    const registrationError = PushNotifications.addListener('registrationError', (error) => {
      if (active) console.error('[FlashFood Push] Error en el registro:', error)
    })

    const received = PushNotifications.addListener('pushNotificationReceived', (notification) => {
      if (active) console.info('[FlashFood Push] Notificación recibida:', notification.title)
    })

    const action = PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      if (active) console.info('[FlashFood Push] Notificación abierta:', event.notification.id)
    })

    async function requestAndRegister() {
      try {
        // Ensure native listeners are installed before requesting registration.
        await Promise.all([registration, registrationError, received, action])
        if (!active) return

        const current = await PushNotifications.checkPermissions()
        let permission = current.receive

        if (permission === 'prompt' || permission === 'prompt-with-rationale') {
          const requested = await PushNotifications.requestPermissions()
          permission = requested.receive
        }

        if (!active) return
        if (permission !== 'granted') {
          console.warn('[FlashFood Push] Permiso de notificaciones no concedido:', permission)
          return
        }

        await PushNotifications.register()
      } catch (error) {
        if (active) console.error('[FlashFood Push] Error al solicitar permisos:', error)
      }
    }

    void requestAndRegister()

    return () => {
      active = false
      authSubscription.data.subscription.unsubscribe()
      void Promise.all([registration, registrationError, received, action])
        .then((listeners) => Promise.all(listeners.map((listener) => listener.remove())))
        .catch((error: unknown) => console.error('[FlashFood Push] Error liberando listeners:', error))
    }
  }, [])

  useEffect(() => {
    let temporizador: ReturnType<typeof setTimeout> | undefined

    function programarVencimiento() {
      if (temporizador !== undefined) {
        clearTimeout(temporizador)
        temporizador = undefined
      }

      const carrito = obtenerCarrito()

      if (!carrito || typeof carrito.ultimaSalidaEn !== 'number') {
        return
      }

      const restante = obtenerTiempoRestanteCarrito(carrito)

      if (restante <= 0) {
        obtenerCarrito()
        return
      }

      temporizador = setTimeout(() => {
        temporizador = undefined
        programarVencimiento()
      }, Math.min(restante + 50, 2147483647))
    }

    const cancelarSuscripcion = suscribirseAlCarrito(programarVencimiento)

    function comprobarAlRegresar() {
      if (document.visibilityState === 'visible') {
        programarVencimiento()
      }
    }

    document.addEventListener('visibilitychange', comprobarAlRegresar)
    window.addEventListener('focus', programarVencimiento)

    programarVencimiento()

    return () => {
      cancelarSuscripcion()
      document.removeEventListener('visibilitychange', comprobarAlRegresar)
      window.removeEventListener('focus', programarVencimiento)

      if (temporizador !== undefined) {
        clearTimeout(temporizador)
      }
    }
  }, [])

  const esPantallaAutenticacion =
    location.pathname === '/login' || ['/establecer-contrasena', '/restablecer-contrasena', '/cambiar-contrasena'].includes(location.pathname)

  return (
    <div className="flashfood-app-shell bg-[#F7F8FA] text-[#171717]">
      {!esPantallaAutenticacion && (
        <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur-xl">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <Link to="/" aria-label="Ir al inicio">
              <img
                src="/flashfood-logo.png"
                alt="FlashFood"
                className="h-11 w-auto max-w-[130px] object-contain"
              />
            </Link>

            <div className="flex min-w-0 flex-1 flex-col items-end">
              <span className="text-[10px] font-medium text-gray-400">
                Tu ubicación
              </span>

              <div className="flex max-w-full items-center gap-1 text-xs font-bold text-gray-800">
                <MapPin
                  size={14}
                  className="shrink-0 text-[#FF6500]"
                />

                <span className="truncate">
                  Seleccionar dirección
                </span>
              </div>
            </div>

            <div
              aria-label="Notificaciones"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-50 text-gray-700"
            >
              <Bell size={20} />
            </div>
          </div>
        </header>
      )}

      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/restaurante/:sucursalId" element={<RestaurantPage />} />

        <Route
          path="/restaurantes"
          element={
            <SectionPage titulo="Explorar restaurantes" />
          }
        />

        <Route path="/carrito" element={<CarritoPage />} />

        <Route
          path="/pedidos"
          element={<SectionPage titulo="Mis pedidos" />}
        />

        <Route
          path="/perfil"
          element={<ProfilePage />}
        />

        <Route path="/superadmin" element={<SuperadminGuard><SuperadminPage /></SuperadminGuard>} />
        <Route path="/negocio" element={<RoleGuard role="admin"><BusinessAdminWorkspace /></RoleGuard>} />
        <Route path="/empleado" element={<RoleGuard role="empleado"><EmployeePage /></RoleGuard>} />
        <Route path="/delivery" element={<RoleGuard role="delivery"><DriverPage /></RoleGuard>} />
        <Route path="/establecer-contrasena" element={<PasswordPage mode="invite" />} />
        <Route path="/restablecer-contrasena" element={<PasswordPage mode="recovery" />} />
        <Route path="/cambiar-contrasena" element={<PasswordPage mode="change" />} />

        <Route
          path="/login"
          element={<LoginPage />}
        />

        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
      </Routes>

      {!esPantallaAutenticacion && <BottomNavigation />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppLayout />
    </BrowserRouter>
  )
}
