import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Search,
  MapPin,
  Store,
  RefreshCw,
  UtensilsCrossed,
  ShoppingBag,
  Clock3,
  X,
} from 'lucide-react'
import { obtenerRestaurantes } from '../services/restaurantes'
import {
  obtenerCarrito,
  obtenerTiempoRestanteCarrito,
  calcularSubtotalCarrito,
  suscribirseAlCarrito,
  type Carrito,
} from '../services/carrito'

type Restaurante = Awaited<ReturnType<typeof obtenerRestaurantes>>[number]

type Local = {
  nombre: string
  nombre_comercial: string | null
}

type Configuracion = {
  logo_url: string | null
  hero_bg_url: string | null
}

function obtenerLocal(restaurante: Restaurante): Local | null {
  const relacion = restaurante.locales
  return Array.isArray(relacion) ? relacion[0] ?? null : relacion ?? null
}

function obtenerConfiguracion(restaurante: Restaurante): Configuracion | null {
  const relacion = restaurante.configuracion
  return Array.isArray(relacion) ? relacion[0] ?? null : relacion ?? null
}

function nombreRestaurante(restaurante: Restaurante): string {
  const local = obtenerLocal(restaurante)

  return (
    local?.nombre_comercial?.trim() ||
    local?.nombre?.trim() ||
    restaurante.nombre
  )
}

function estadoRestaurante(restaurante: Restaurante) {
  if (!restaurante.acepta_pedidos_app) {
    return {
      texto: 'Próximamente',
      clases: 'bg-amber-50 text-amber-700',
      punto: 'bg-amber-500',
    }
  }

  if (!restaurante.abierto) {
    return {
      texto: 'Cerrado',
      clases: 'bg-gray-100 text-gray-600',
      punto: 'bg-gray-400',
    }
  }

  return {
    texto: 'Disponible',
    clases: 'bg-emerald-50 text-emerald-700',
    punto: 'bg-emerald-500',
  }
}

function formatearTiempo(milisegundos: number): string {
  const segundos = Math.max(0, Math.ceil(milisegundos / 1000))
  const horas = Math.floor(segundos / 3600)
  const minutos = Math.floor((segundos % 3600) / 60)
  const segundosRestantes = segundos % 60

  return [horas, minutos, segundosRestantes]
    .map((valor) => String(valor).padStart(2, '0'))
    .join(':')
}

export default function HomePage() {
  const [restaurantes, setRestaurantes] = useState<Restaurante[]>([])
  const [busqueda, setBusqueda] = useState('')
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [carritoPendiente, setCarritoPendiente] = useState<Carrito | null>(
    () => obtenerCarrito(),
  )
  const [tiempoRestante, setTiempoRestante] = useState(
    () => obtenerTiempoRestanteCarrito(obtenerCarrito()),
  )

  useEffect(() => {
    function actualizarPedido() {
      const carrito = obtenerCarrito()
      setCarritoPendiente(carrito)
      setTiempoRestante(obtenerTiempoRestanteCarrito(carrito))
    }

    const cancelarSuscripcion = suscribirseAlCarrito(actualizarPedido)
    const intervalo = window.setInterval(actualizarPedido, 1000)

    window.addEventListener('focus', actualizarPedido)

    return () => {
      cancelarSuscripcion()
      window.clearInterval(intervalo)
      window.removeEventListener('focus', actualizarPedido)
    }
  }, [])

  const pedidoPendiente =
    carritoPendiente &&
    carritoPendiente.items.length > 0 &&
    typeof carritoPendiente.ultimaSalidaEn === 'number' &&
    tiempoRestante > 0
      ? carritoPendiente
      : null

  const cantidadPendiente =
    pedidoPendiente?.items.reduce(
      (total, item) => total + item.cantidad,
      0,
    ) ?? 0

  const subtotalPendiente = calcularSubtotalCarrito(pedidoPendiente)
  const dinero = (valor: number) =>
    new Intl.NumberFormat('es-EC', {
      style: 'currency',
      currency: 'USD',
    }).format(valor)

  async function cargarRestaurantes() {
    setCargando(true)
    setError(null)

    try {
      const datos = await obtenerRestaurantes()
      setRestaurantes(datos)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'No se pudieron cargar los restaurantes.',
      )
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    queueMicrotask(() => { void cargarRestaurantes() })
  }, [])

  const filtrados = useMemo(() => {
    const termino = busqueda.toLocaleLowerCase('es').trim()

    return restaurantes
      .filter((restaurante) => {
        if (!termino) return true

        const texto = [
          nombreRestaurante(restaurante),
          restaurante.nombre,
          restaurante.direccion,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('es')

        return texto.includes(termino)
      })
      .sort((a, b) => {
        const disponibleA = Number(Boolean(a.abierto && a.acepta_pedidos_app))
        const disponibleB = Number(Boolean(b.abierto && b.acepta_pedidos_app))

        return (
          disponibleB - disponibleA ||
          nombreRestaurante(a).localeCompare(nombreRestaurante(b), 'es')
        )
      })
  }, [restaurantes, busqueda])

  const disponibles = restaurantes.filter(
    (restaurante) => restaurante.abierto && restaurante.acepta_pedidos_app,
  ).length

  return (
    <main className="mx-auto h-[calc(100dvh-76px)] w-full max-w-5xl overflow-x-hidden overflow-y-auto overscroll-contain bg-[#F7F8FA] pb-28 [-webkit-overflow-scrolling:touch]">
      {/* Buscador y bienvenida */}
      <section className="bg-white px-4 pb-5 pt-5">
        <div className="mb-4">
          <p className="text-[13px] font-medium text-gray-500">
            Tu comida favorita, a un toque
          </p>
          <h1 className="mt-1 text-[23px] font-extrabold leading-tight tracking-tight text-[#171717]">
            ¿Qué se te antoja hoy?
          </h1>
        </div>

        <div className="flex h-[50px] items-center gap-3 rounded-2xl border border-gray-100 bg-[#F5F6F8] px-4 transition-colors focus-within:border-orange-300">
          <Search size={20} className="shrink-0 text-[#F97316]" />

          <input
            value={busqueda}
            onChange={(event) => setBusqueda(event.target.value)}
            placeholder="Buscar restaurantes..."
            aria-label="Buscar restaurantes"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-gray-900 outline-none placeholder:text-gray-400"
          />

          {busqueda && (
            <button
              type="button"
              onClick={() => setBusqueda('')}
              aria-label="Limpiar búsqueda"
              className="rounded-full p-1 text-gray-400"
            >
              <X size={17} />
            </button>
          )}
        </div>
      </section>

      {/* Pedido pendiente */}
      {pedidoPendiente && (
        <section className="mt-2 bg-white px-4 py-5">
          <div className="rounded-2xl border border-orange-100 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-[#F97316]">
                <ShoppingBag size={22} />
              </div>

              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-extrabold text-gray-900">
                  Tienes un pedido pendiente
                </h2>

                <p className="mt-1 truncate text-[13px] font-semibold text-gray-700">
                  {pedidoPendiente.restauranteNombre}
                </p>

                <p className="mt-1 text-xs text-gray-500">
                  {cantidadPendiente} {cantidadPendiente === 1 ? 'producto' : 'productos'}
                  {' · '}
                  {dinero(subtotalPendiente)}
                </p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-2">
                <Clock3 size={17} className="text-[#F97316]" />
                <div>
                  <p className="text-[10px] font-medium text-gray-500">
                    Tiempo restante
                  </p>
                  <p className="text-[16px] font-extrabold tabular-nums text-gray-900">
                    {formatearTiempo(tiempoRestante)}
                  </p>
                </div>
              </div>

              <Link
                to={`/restaurante/${pedidoPendiente.sucursalId}`}
                className="rounded-xl bg-[#F97316] px-4 py-3 text-center text-xs font-extrabold text-white"
              >
                Continuar pedido
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Accesos visuales */}
      <section className="mt-2 bg-white px-4 py-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-extrabold text-[#171717]">
            Descubre FlashFood
          </h2>
          <UtensilsCrossed size={18} className="text-[#F97316]" />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-[66px] w-full items-center justify-center rounded-2xl bg-[#FFF1E6]">
              <UtensilsCrossed size={27} className="text-[#F97316]" />
            </div>
            <span className="text-center text-[12px] font-semibold text-gray-700">
              Restaurantes
            </span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex h-[66px] w-full items-center justify-center rounded-2xl bg-[#FFF1E6]">
              <ShoppingBag size={27} className="text-[#F97316]" />
            </div>
            <span className="text-center text-[12px] font-semibold text-gray-700">
              Para llevar
            </span>
          </div>

          <div className="flex flex-col items-center gap-2">
            <div className="flex h-[66px] w-full items-center justify-center rounded-2xl bg-[#FFF1E6]">
              <Clock3 size={27} className="text-[#F97316]" />
            </div>
            <span className="text-center text-[12px] font-semibold text-gray-700">
              Disponibles
            </span>
          </div>
        </div>
      </section>

      {/* Restaurantes reales */}
      <section className="mt-2 bg-white px-4 pb-8 pt-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[19px] font-extrabold tracking-tight text-[#171717]">
              Restaurantes
            </h2>
            <p className="mt-1 text-[12px] text-gray-500">
              {cargando
                ? 'Buscando restaurantes...'
                : `${restaurantes.length} restaurantes · ${disponibles} disponibles para pedir`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void cargarRestaurantes()}
            disabled={cargando}
            aria-label="Actualizar restaurantes"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-100 bg-[#F7F8FA] text-[#F97316] disabled:opacity-50"
          >
            <RefreshCw
              size={18}
              className={cargando ? 'animate-spin' : ''}
            />
          </button>
        </div>

        {cargando ? (
          <div className="space-y-3" aria-label="Cargando restaurantes">
            {[1, 2, 3].map((numero) => (
              <div
                key={numero}
                className="flex animate-pulse gap-3 rounded-2xl border border-gray-100 p-3"
              >
                <div className="h-[100px] w-[110px] shrink-0 rounded-xl bg-gray-100" />
                <div className="flex flex-1 flex-col justify-center gap-3">
                  <div className="h-4 w-4/5 rounded bg-gray-100" />
                  <div className="h-3 w-2/5 rounded bg-gray-100" />
                  <div className="h-3 w-3/5 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-100 bg-red-50 p-5 text-center">
            <p className="text-sm font-bold text-red-700">
              No se pudieron cargar los restaurantes
            </p>
            <p className="mt-2 break-words text-xs text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => void cargarRestaurantes()}
              className="mt-4 rounded-xl bg-[#F97316] px-5 py-2.5 text-sm font-bold text-white"
            >
              Reintentar
            </button>
          </div>
        ) : filtrados.length === 0 ? (
          <div className="rounded-2xl border border-gray-100 px-5 py-12 text-center">
            <Store size={36} className="mx-auto text-gray-300" />
            <h3 className="mt-3 text-sm font-bold text-gray-800">
              {busqueda
                ? 'No encontramos coincidencias'
                : 'No hay restaurantes registrados'}
            </h3>
            <p className="mt-2 text-xs text-gray-500">
              {busqueda
                ? 'Intenta buscar con otro nombre.'
                : 'Los restaurantes aparecerán aquí cuando estén disponibles en el catálogo.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtrados.map((restaurante) => {
              const configuracion = obtenerConfiguracion(restaurante)
              const nombre = nombreRestaurante(restaurante)
              const imagen = configuracion?.hero_bg_url || configuracion?.logo_url
              const estado = estadoRestaurante(restaurante)

              return (
                <Link
                  key={restaurante.id}
                  to={`/restaurante/${restaurante.id}`}
                  className="flex min-h-[124px] overflow-hidden rounded-2xl border border-[#ECEEF1] bg-white shadow-[0_2px_8px_rgba(0,0,0,0.025)]"
                >
                  <div className="relative w-[118px] shrink-0 bg-[#FFF1E6] sm:w-[145px]">
                    {imagen ? (
                      <img
                        src={imagen}
                        alt={nombre}
                        loading="lazy"
                        className="h-full min-h-[124px] w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full min-h-[124px] items-center justify-center">
                        <Store size={34} className="text-orange-300" />
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-3">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 line-clamp-2 text-[14px] font-extrabold leading-snug text-[#171717]">
                          {nombre}
                        </h3>

                        <div className="flex shrink-0 items-center gap-1 pt-0.5">
                          {restaurante.total_calificaciones > 0 &&
                          restaurante.promedio_calificacion !== null ? (
                            <>
                              <span className="text-[15px] leading-none text-amber-500">
                                ★
                              </span>
                              <span className="text-[12px] font-extrabold text-[#171717]">
                                {restaurante.promedio_calificacion.toFixed(1)}
                              </span>
                              <span className="text-[10px] text-gray-500">
                                ({restaurante.total_calificaciones})
                              </span>
                            </>
                          ) : (
                            <span className="max-w-[65px] text-right text-[10px] leading-tight text-gray-400">
                              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <span className="text-[15px] leading-none text-amber-500">
                                ★
                              </span>
                              <span>0.0 (0)</span>
                            </span>
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="mt-1 truncate text-[12px] text-gray-500">
                        {restaurante.nombre}
                      </p>

                      {restaurante.direccion && (
                        <div className="mt-2 flex items-start gap-1 text-[11px] text-gray-400">
                          <MapPin size={12} className="mt-0.5 shrink-0" />
                          <span className="line-clamp-1">
                            {restaurante.direccion}
                          </span>
                        </div>
                      )}
                    </div>

                    <div>
                      <span
                        className={`inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${estado.clases}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${estado.punto}`}
                        />
                        {estado.texto}
                      </span>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
