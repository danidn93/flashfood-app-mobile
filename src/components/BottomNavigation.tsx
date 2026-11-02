import { NavLink } from 'react-router-dom'
import {
  House,
  Compass,
  ShoppingBag,
  ReceiptText,
  UserRound,
} from 'lucide-react'

const opciones = [
  { ruta: '/', nombre: 'Inicio', Icono: House, exacta: true },
  { ruta: '/restaurantes', nombre: 'Explorar', Icono: Compass },
  { ruta: '/carrito', nombre: 'Carrito', Icono: ShoppingBag },
  { ruta: '/pedidos', nombre: 'Pedidos', Icono: ReceiptText },
  { ruta: '/perfil', nombre: 'Perfil', Icono: UserRound },
]

export default function BottomNavigation() {
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-gray-100 bg-white/95 shadow-[0_-4px_20px_rgba(0,0,0,0.04)] backdrop-blur-xl"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-around px-2 pt-2">
        {opciones.map(({ ruta, nombre, Icono, exacta }) => (
          <NavLink
            key={ruta}
            to={ruta}
            end={exacta}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl transition-colors ${
                isActive
                  ? 'text-[#FF6500]'
                  : 'text-gray-400 hover:text-gray-700'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icono
                  size={22}
                  strokeWidth={isActive ? 2.5 : 1.9}
                />
                <span
                  className={`text-[10px] leading-tight ${
                    isActive ? 'font-bold' : 'font-medium'
                  }`}
                >
                  {nombre}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </div>
      <div style={{ height: 'env(safe-area-inset-bottom, 0px)' }} />
    </nav>
  )
}
