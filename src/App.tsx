import { useEffect } from 'react'
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
    <div className="min-h-dvh bg-[#F7F8FA] text-[#171717]">
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
