import RestaurantExitGuard from '../components/RestaurantExitGuard'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Search,
  X,
  Store,
  MapPin,
  Clock3,
  Bike,
  ShoppingBag,
  UtensilsCrossed,
  Plus,
  Minus,
  ChevronRight,
  RefreshCw,
  ImageOff,
} from 'lucide-react'
import { obtenerRestaurantes } from '../services/restaurantes'
import { supabase } from '../lib/supabase'
import {
  agregarAlCarrito,
  obtenerCarrito,
  calcularSubtotalCarrito,
  suscribirseAlCarrito,
  registrarSalidaRestaurante,
  registrarRegresoRestaurante,
  obtenerTiempoRestanteCarrito,
  type Carrito,
  type AgregarItemInput,
} from '../services/carrito'
import {
  obtenerProductosSucursal,
  obtenerPrecioMinimo,
  calcularPrecio,
  type ProductoMenu,
  type ModalidadPedido,
} from '../services/productos'

type Restaurante = Awaited<ReturnType<typeof obtenerRestaurantes>>[number]

type Local = {
  nombre: string
  nombre_comercial: string | null
}

type Configuracion = {
  logo_url: string | null
  hero_bg_url: string | null
}

const dinero = (valor: number) =>
  new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
  }).format(valor)

function obtenerRelacion<T>(relacion: T | T[] | null | undefined): T | null {
  if (Array.isArray(relacion)) return relacion[0] ?? null
  return relacion ?? null
}

function nombreLocal(restaurante: Restaurante) {
  const local = obtenerRelacion(
    restaurante.locales as Local | Local[] | null,
  )

  return (
    local?.nombre_comercial?.trim() ||
    local?.nombre?.trim() ||
    restaurante.nombre
  )
}

function imagenProducto(producto: ProductoMenu) {
  return (
    producto.image_url ||
    producto.presentaciones.find((p) => p.imagen_url)?.imagen_url ||
    null
  )
}

export default function RestaurantPage() {
  const { sucursalId } = useParams<{ sucursalId: string }>()
  const navigate = useNavigate()
  const [mostrarSalida, setMostrarSalida] = useState(false)
  const [destinoSalida, setDestinoSalida] = useState('/')

  const [restaurante, setRestaurante] = useState<Restaurante | null>(null)
  const [productos, setProductos] = useState<ProductoMenu[]>([])
  const [modalidad, setModalidad] = useState<ModalidadPedido>('retirar')
  const [deliveryDisponible, setDeliveryDisponible] = useState(false)
  const [consultandoDelivery, setConsultandoDelivery] = useState(true)
  const [mensajeDelivery, setMensajeDelivery] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [categoria, setCategoria] = useState('Todos')
  const [ordenPrecio, setOrdenPrecio] = useState(false)
  const [soloDisponibles, setSoloDisponibles] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [seleccionado, setSeleccionado] = useState<ProductoMenu | null>(null)
  const [cantidadesPresentaciones, setCantidadesPresentaciones] = useState<Record<string, number>>({})
  const [cantidad, setCantidad] = useState(1)
  const [cantidadBase, setCantidadBase] = useState(1)
  const [observaciones, setObservaciones] = useState('')
  const [carritoActual, setCarritoActual] = useState<Carrito | null>(
    () => obtenerCarrito(),
  )
  const [mensajeCarrito, setMensajeCarrito] = useState('')
  const [confirmacionCarrito, setConfirmacionCarrito] =
    useState<AgregarItemInput[] | null>(null)

  const verificarDelivery = useCallback(async () => {
    setConsultandoDelivery(true)
    const { data, error: disponibilidadError } = await supabase.rpc('flashfood_delivery_disponible')
    const disponible = !disponibilidadError && data === true
    setDeliveryDisponible(disponible)
    setConsultandoDelivery(false)
    return disponible
  }, [])

  useEffect(() => {
    void verificarDelivery()
    const alVolver = () => { if (document.visibilityState === 'visible') void verificarDelivery() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [verificarDelivery])

  useEffect(() => {
    let activo = true

    async function cargar() {
      setCargando(true)
      setError('')

      try {
        const restaurantes = await obtenerRestaurantes()
        const encontrado = restaurantes.find(
          (item) => item.id === sucursalId,
        )

        if (!encontrado) {
          throw new Error('No encontramos este restaurante.')
        }

        const productosReales = await obtenerProductosSucursal(encontrado.id)

        if (!activo) return

        setRestaurante(encontrado)
        setProductos(productosReales)
      } catch (err) {
        if (!activo) return

        setError(
          err instanceof Error
            ? err.message
            : 'No se pudo cargar el restaurante.',
        )
      } finally {
        if (activo) setCargando(false)
      }
    }

    void cargar()

    return () => {
      activo = false
    }
  }, [sucursalId])

  useEffect(() => {
    return suscribirseAlCarrito(() => {
      setCarritoActual(obtenerCarrito())
    })
  }, [])

  const carritoDelRestaurante =
    carritoActual?.sucursalId === restaurante?.id
      ? carritoActual
      : null

  const cantidadCarrito =
    carritoDelRestaurante?.items.reduce(
      (total, item) => total + item.cantidad,
      0,
    ) ?? 0

  const subtotalCarrito = calcularSubtotalCarrito(carritoDelRestaurante)

  useEffect(() => {
    if (!sucursalId) return

    registrarRegresoRestaurante(sucursalId)
  }, [sucursalId])

  const tiempoDisponible = obtenerTiempoRestanteCarrito(carritoActual)
  const horasDisponibles = Math.floor(tiempoDisponible / 3600000)
  const minutosDisponibles = Math.ceil(
    (tiempoDisponible % 3600000) / 60000,
  )

  const tiempoYaUtilizado =
    carritoActual?.tiempoRestanteMs !== undefined &&
    carritoActual.tiempoRestanteMs < 7200000

  function solicitarSalida(destino = '/') {
    setDestinoSalida(destino)
    const carrito = obtenerCarrito()

    if (
      !carrito ||
      carrito.sucursalId !== sucursalId ||
      carrito.items.length === 0
    ) {
      navigate(destino)
      return
    }

    setMostrarSalida(true)
  }

  function confirmarSalida() {
    if (sucursalId) {
      registrarSalidaRestaurante(sucursalId)
    }

    setMostrarSalida(false)
    navigate(destinoSalida)
  }

  const categorias = useMemo(() => {
    const reales = [
      ...new Set(
        productos
          .map((producto) => producto.categoria?.trim())
          .filter((valor): valor is string => Boolean(valor)),
      ),
    ]

    return ['Todos', ...reales]
  }, [productos])

  const filtrados = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase('es')

    const resultado = productos.filter((producto) => {
      const coincideCategoria =
        categoria === 'Todos' || producto.categoria?.trim() === categoria

      const texto = [
        producto.nombre,
        producto.descripcion,
        producto.categoria,
        ...producto.presentaciones.map((p) => p.nombre),
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('es')

      return coincideCategoria && (!termino || texto.includes(termino))
    })

    if (ordenPrecio) {
      resultado.sort(
        (a, b) =>
          obtenerPrecioMinimo(a, modalidad) -
          obtenerPrecioMinimo(b, modalidad),
      )
    }

    return resultado
  }, [productos, busqueda, categoria, modalidad, ordenPrecio])

  const cantidadSeleccionada = seleccionado?.presentaciones.length
    ? cantidadBase + seleccionado.presentaciones.reduce(
        (total, opcion) => total + (cantidadesPresentaciones[opcion.id] ?? 0),
        0,
      )
    : cantidad

  const totalSeleccionado = seleccionado
    ? seleccionado.presentaciones.length > 0
      ? cantidadBase * calcularPrecio(seleccionado, modalidad) +
        seleccionado.presentaciones.reduce(
          (total, opcion) => total +
            (cantidadesPresentaciones[opcion.id] ?? 0) * calcularPrecio(opcion, modalidad),
          0,
        )
      : cantidad * calcularPrecio(seleccionado, modalidad)
    : 0

  function cambiarCantidadPresentacion(id: string, diferencia: number) {
    setCantidadesPresentaciones((actual) => ({
      ...actual,
      [id]: Math.max(0, (actual[id] ?? 0) + diferencia),
    }))
  }

  const puedePedir =
    restaurante?.abierto === true &&
    restaurante?.acepta_pedidos_app === true

  function abrirProducto(producto: ProductoMenu) {
    setSeleccionado(producto)
    setCantidadesPresentaciones({})
    setCantidadBase(1)
    setCantidad(1)
    setObservaciones('')
  }

  function agregarEntradas(entradas: AgregarItemInput[], reemplazar = false) {
    entradas.forEach((entrada, indice) => {
      agregarAlCarrito(entrada, reemplazar && indice === 0)
    })
  }

  async function agregarProducto() {
    if (!seleccionado || !restaurante || !puedePedir || cantidadSeleccionada < 1) return
    if (modalidad === 'domicilio' && !(await verificarDelivery())) {
      setMensajeCarrito('No hay repartidores disponibles. Selecciona Retirar o Servir.')
      return
    }

    const base = {
      sucursalId: restaurante.id,
      restauranteNombre: nombreLocal(restaurante),
      modalidad,
      productoId: seleccionado.id,
      nombreProducto: seleccionado.nombre,
      observaciones,
    }

    const entradas: AgregarItemInput[] = seleccionado.presentaciones.length > 0
      ? [
          ...(cantidadBase > 0 ? [{
            ...base,
            presentacionId: null,
            nombrePresentacion: null,
            imagenUrl: imagenProducto(seleccionado),
            cantidad: cantidadBase,
            precioUnitario: calcularPrecio(seleccionado, modalidad),
          }] : []),
          ...seleccionado.presentaciones
            .filter((opcion) => (cantidadesPresentaciones[opcion.id] ?? 0) > 0)
            .map((opcion) => ({
              ...base,
              presentacionId: opcion.id,
              nombrePresentacion: opcion.nombre,
              imagenUrl: opcion.imagen_url || imagenProducto(seleccionado),
              cantidad: cantidadesPresentaciones[opcion.id],
              precioUnitario: calcularPrecio(opcion, modalidad),
            })),
        ]
      : [{
          ...base,
          presentacionId: null,
          nombrePresentacion: null,
          imagenUrl: imagenProducto(seleccionado),
          cantidad,
          precioUnitario: calcularPrecio(seleccionado, modalidad),
        }]

    const carritoExistente = obtenerCarrito()
    if (
      carritoExistente && carritoExistente.items.length > 0 &&
      (carritoExistente.sucursalId !== restaurante.id ||
        carritoExistente.modalidad !== modalidad)
    ) {
      setConfirmacionCarrito(entradas)
      return
    }

    try {
      agregarEntradas(entradas)
      cerrarProducto()
      setMensajeCarrito('Productos agregados al carrito')
    } catch (error) {
      setMensajeCarrito(error instanceof Error ? error.message : 'No se pudo agregar el producto')
    }
  }

  function confirmarReemplazoCarrito() {
    if (!confirmacionCarrito?.length) return
    try {
      agregarEntradas(confirmacionCarrito, true)
      setConfirmacionCarrito(null)
      cerrarProducto()
      setMensajeCarrito('Carrito actualizado correctamente')
    } catch (error) {
      setMensajeCarrito(error instanceof Error ? error.message : 'No se pudo actualizar el carrito')
    }
  }

  function cerrarProducto() {
    setSeleccionado(null)
    setCantidadesPresentaciones({})
    setCantidadBase(1)
    setCantidad(1)
    setObservaciones('')
  }

  const configuracion = restaurante
    ? obtenerRelacion(
        restaurante.configuracion as Configuracion | Configuracion[] | null,
      )
    : null

  if (cargando) {
    return (
      <main className="flex h-[calc(100dvh-76px)] items-center justify-center">
        <RefreshCw size={28} className="animate-spin text-orange-500" />
      </main>
    )
  }

  if (error || !restaurante) {
    return (
      <main className="mx-auto flex h-[calc(100dvh-76px)] max-w-lg flex-col items-center justify-center px-5 text-center">
        <Store size={42} className="text-gray-300" />
        <h1 className="mt-4 text-lg font-extrabold text-gray-900">
          No pudimos abrir el restaurante
        </h1>
        <p className="mt-2 text-sm text-gray-500">{error}</p>
        <Link
          to="/"
          className="mt-6 rounded-xl bg-[#F97316] px-6 py-3 text-sm font-bold text-white"
        >
          Volver al inicio
        </Link>
      </main>
    )
  }

  return (
    <main className="h-[calc(100dvh-76px)] w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-[#F7F8FA] pb-28 [-webkit-overflow-scrolling:touch]">
      <div className="mx-auto max-w-5xl">
        {/* Portada */}
        <div className="relative h-44 overflow-hidden bg-orange-100 sm:h-56">
          {configuracion?.hero_bg_url ? (
            <img
              src={configuracion.hero_bg_url}
              alt={`Portada de ${nombreLocal(restaurante)}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <Store size={54} className="text-orange-300" />
            </div>
          )}

          <div className="absolute inset-0 bg-gradient-to-t from-black/30 to-transparent" />

          <button
            type="button"
            onClick={() => solicitarSalida('/')}
            aria-label="Salir del restaurante"
            className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white text-gray-900 shadow-sm"
          >
            <ArrowLeft size={20} />
          </button>
        </div>

        {/* Información del restaurante */}
        <section className="relative -mt-5 rounded-t-[28px] bg-white px-4 pb-5 pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-[62px] w-[62px] shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              {configuracion?.logo_url ? (
                <img
                  src={configuracion.logo_url}
                  alt="Logotipo"
                  className="h-full w-full object-contain"
                />
              ) : (
                <Store size={26} className="text-orange-400" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <h1 className="text-[20px] font-extrabold leading-tight tracking-tight text-[#171717]">
                {nombreLocal(restaurante)}
              </h1>
              <div
                data-rating="flashfood-rating-detail"
                className="mt-2 flex items-center gap-1.5"
              >
                {restaurante.total_calificaciones > 0 &&
                restaurante.promedio_calificacion !== null ? (
                  <>
                    <span className="text-amber-500">★</span>
                    <span className="text-sm font-extrabold text-gray-900">
                      {restaurante.promedio_calificacion.toFixed(1)}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({restaurante.total_calificaciones})
                    </span>
                  </>
                ) : (
                  <span className="text-xs text-gray-400">
                    <span className="inline-flex items-center gap-1 whitespace-nowrap">
                              <span className="text-[15px] leading-none text-amber-500">
                                ★
                              </span>
                              <span>0.0 (0)</span>
                            </span>
                  </span>
                )}
              </div>


              <p className="mt-1 text-xs text-gray-500">
                Sucursal {restaurante.nombre}
              </p>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                    puedePedir
                      ? 'bg-green-50 text-green-700'
                      : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {puedePedir
                    ? 'Aceptando pedidos'
                    : !restaurante.acepta_pedidos_app
                      ? 'Pedidos próximamente'
                      : 'Cerrado'}
                </span>
              </div>
            </div>
          </div>

          {restaurante.direccion && (
            <p className="mt-4 flex items-start gap-2 text-xs text-gray-500">
              <MapPin size={15} className="shrink-0 text-orange-500" />
              {restaurante.direccion}
            </p>
          )}

          {/* Modalidad */}
          <div className="mt-5 grid grid-cols-3 rounded-2xl bg-[#F3F4F6] p-1">
            {([
              ['domicilio', 'Domicilio', Bike],
              ['retirar', 'Retirar', ShoppingBag],
              ['servir', 'Servir', UtensilsCrossed],
            ] as const).map(([valor, etiqueta, Icono]) => (
              <button
                key={valor}
                type="button"
                onClick={async () => {
                  if (valor === 'domicilio') {
                    const disponible = await verificarDelivery()
                    if (!disponible) {
                      setMensajeDelivery('No hay repartidores disponibles. Puedes retirar o consumir en el restaurante.')
                      return
                    }
                  }
                  setMensajeDelivery('')
                  setModalidad(valor)
                }}
                disabled={valor === 'domicilio' && (consultandoDelivery || !deliveryDisponible)}
                title={valor === 'domicilio' && !deliveryDisponible ? 'No hay repartidores disponibles' : undefined}
                className={`flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-3 text-[12px] font-bold transition ${
                  modalidad === valor
                    ? 'bg-[#171717] text-white shadow-sm'
                    : 'text-gray-600'
                } ${valor === 'domicilio' && (consultandoDelivery || !deliveryDisponible) ? 'cursor-not-allowed opacity-40' : ''
                }`}
              >
                <Icono size={15} className="shrink-0" />
                <span>{etiqueta}</span>
              </button>
            ))}
          </div>

          {!consultandoDelivery && !deliveryDisponible && (
            <p className="mt-2 text-xs font-semibold text-amber-700">Domicilio no disponible: no hay repartidores activos y disponibles.</p>
          )}
          {mensajeDelivery && <p role="status" className="mt-2 text-xs text-amber-700">{mensajeDelivery}</p>}
          <div className="mt-4 flex items-start gap-2 rounded-xl bg-orange-50 px-3 py-3 text-xs text-orange-900">
            {modalidad === 'domicilio' ? (
              <Bike size={17} className="shrink-0" />
            ) : modalidad === 'retirar' ? (
              <ShoppingBag size={17} className="shrink-0" />
            ) : (
              <UtensilsCrossed size={17} className="shrink-0" />
            )}

            <span>
              {modalidad === 'domicilio'
                ? 'Precios para llevar. El costo de entrega se calculará al confirmar el pedido.'
                : modalidad === 'retirar'
                  ? 'Recoge tu pedido en el restaurante. Se aplican los precios para llevar.'
                  : 'Consumo en el restaurante. Se aplican los precios normales.'}
            </span>
          </div>
        </section>

        {/* Búsqueda y filtros */}
        <section className="mt-2 bg-white px-4 py-5">
          <div className="flex h-12 items-center gap-3 rounded-2xl bg-[#F5F6F8] px-4">
            <Search size={19} className="shrink-0 text-orange-500" />

            <input
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder={`Buscar en ${nombreLocal(restaurante)}...`}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            />

            {busqueda && (
              <button
                type="button"
                onClick={() => setBusqueda('')}
                aria-label="Limpiar búsqueda"
              >
                <X size={17} className="text-gray-400" />
              </button>
            )}
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {categorias.map((nombre) => (
              <button
                key={nombre}
                type="button"
                onClick={() => setCategoria(nombre)}
                className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold ${
                  categoria === nombre
                    ? 'bg-[#171717] text-white'
                    : 'bg-[#F3F4F6] text-gray-700'
                }`}
              >
                {nombre}
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOrdenPrecio(!ordenPrecio)}
              className={`rounded-full px-3 py-2 text-xs font-semibold ${
                ordenPrecio
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              Precio más bajo primero
            </button>

            <button
              type="button"
              onClick={() => setSoloDisponibles(!soloDisponibles)}
              className={`rounded-full px-3 py-2 text-xs font-semibold ${
                soloDisponibles
                  ? 'bg-orange-100 text-orange-700'
                  : 'bg-gray-100 text-gray-600'
              }`}
            >
              {soloDisponibles ? '✓ ' : ''}Disponibles
            </button>
          </div>
        </section>

        {/* Productos */}
        <section className="mt-2 bg-white px-4 pb-10 pt-5">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-extrabold text-[#171717]">
                Nuestro menú
              </h2>
              <p className="mt-1 text-xs text-gray-500">
                {filtrados.length} productos
              </p>
            </div>
            <Clock3 size={18} className="text-gray-400" />
          </div>

          {filtrados.length === 0 ? (
            <div className="py-12 text-center">
              <Store size={35} className="mx-auto text-gray-300" />
              <p className="mt-3 text-sm font-bold text-gray-700">
                No hay productos para mostrar
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Prueba otra categoría o búsqueda.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtrados
                .filter(() => !soloDisponibles || puedePedir)
                .map((producto) => {
                  const imagen = imagenProducto(producto)
                  const precio = calcularPrecio(producto, modalidad)

                  return (
                    <article
                      key={producto.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Seleccionar ${producto.nombre}`}
                      onClick={() => abrirProducto(producto)}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault()
                          abrirProducto(producto)
                        }
                      }}
                      className="flex min-h-[140px] cursor-pointer overflow-hidden rounded-2xl border border-gray-100 bg-white active:bg-orange-50"
                    >
                      <div className="relative w-[120px] shrink-0 bg-gray-100">
                        {imagen ? (
                          <img
                            src={imagen}
                            alt={producto.nombre}
                            loading="lazy"
                            className="h-full min-h-[140px] w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full items-center justify-center">
                            <ImageOff size={27} className="text-gray-300" />
                          </div>
                        )}
                      </div>

                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 p-3">
                        <div>
                          <h3 className="line-clamp-2 text-sm font-extrabold leading-snug text-gray-900">
                            {producto.nombre}
                          </h3>

                          {producto.descripcion && (
                            <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-gray-500">
                              {producto.descripcion}
                            </p>
                          )}

                          {producto.presentaciones.length > 0 && (
                            <p className="mt-1 text-[10px] font-medium text-orange-600">
                              {producto.presentaciones.length} opciones
                            </p>
                          )}
                        </div>

                        <div className="flex items-end justify-between gap-2">
                          <div>
                            <p className="text-[15px] font-extrabold text-[#171717]">
                              {dinero(precio)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              abrirProducto(producto)
                            }}
                            aria-label={`Seleccionar ${producto.nombre}`}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F97316] text-white"
                          >
                            {puedePedir ? (
                              <Plus size={20} />
                            ) : (
                              <ChevronRight size={19} />
                            )}
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
            </div>
          )}
        </section>
      </div>

      {mensajeCarrito && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[120] flex w-[calc(100%-32px)] max-w-sm -translate-x-1/2 items-center justify-between gap-3 rounded-2xl bg-[#171717] px-4 py-3 text-sm font-semibold text-white shadow-xl"
        >
          <span>{mensajeCarrito}</span>
          <button
            type="button"
            onClick={() => setMensajeCarrito('')}
            aria-label="Cerrar aviso"
            className="shrink-0"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {confirmacionCarrito && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 px-5">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-carrito-titulo"
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
              <ShoppingBag size={24} />
            </div>

            <h2
              id="confirmar-carrito-titulo"
              className="text-lg font-extrabold text-gray-900"
            >
              ¿Reemplazar tu carrito?
            </h2>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              Ya tienes productos de otro restaurante o de una
              modalidad diferente. Para continuar, debemos
              reemplazar los productos anteriores.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setConfirmacionCarrito(null)}
                className="rounded-xl bg-gray-100 px-3 py-3 text-sm font-bold text-gray-700"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={confirmarReemplazoCarrito}
                className="rounded-xl bg-[#F97316] px-3 py-3 text-sm font-bold text-white"
              >
                Reemplazar
              </button>
            </div>
          </div>
        </div>
      )}

      {carritoDelRestaurante && cantidadCarrito > 0 && !seleccionado && (
        <div className="fixed bottom-[82px] left-0 right-0 z-40 px-4">
          <Link
            to="/carrito"
            className="mx-auto flex h-14 w-full max-w-2xl items-center gap-3 rounded-2xl bg-[#F97316] px-4 text-white shadow-[0_8px_30px_rgba(249,115,22,0.35)]"
          >
            <span className="flex h-9 min-w-9 items-center justify-center rounded-xl bg-white px-2 text-sm font-extrabold text-[#171717]">
              {cantidadCarrito}
            </span>

            <span className="min-w-0 flex-1 text-sm font-extrabold">
              Ver mi carrito
            </span>

            <span className="text-sm font-extrabold">
              {dinero(subtotalCarrito)}
            </span>

            <ChevronRight size={20} />
          </Link>
        </div>
      )}

      <RestaurantExitGuard
        onSolicitarSalida={solicitarSalida}
      />

      {mostrarSalida && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/60 px-5">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirmar-salida-restaurante"
            className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-100 text-orange-600">
              <Clock3 size={24} />
            </div>

            <h2
              id="confirmar-salida-restaurante"
              className="text-lg font-extrabold text-gray-900"
            >
              ¿Salir del restaurante?
            </h2>

            <p className="mt-3 text-sm leading-7 text-gray-600">
              Tu pedido de{' '}
              <strong className="text-gray-800">
                {restaurante ? nombreLocal(restaurante) : 'este restaurante'}
              </strong>
              {' '}quedará guardado por{' '}
              <strong className="text-gray-800">
                {tiempoYaUtilizado
                  ? `${horasDisponibles} h ${minutosDisponibles} min restantes`
                  : '2 horas a partir de ahora'}
              </strong>.
            </p>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setMostrarSalida(false)}
                className="rounded-xl bg-gray-100 px-3 py-3 text-sm font-bold text-gray-700"
              >
                Permanecer
              </button>

              <button
                type="button"
                onClick={confirmarSalida}
                className="rounded-xl bg-[#F97316] px-3 py-3 text-sm font-bold text-white"
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detalle de producto y presentaciones */}
      {seleccionado && createPortal(
        <div role="presentation" className="fixed inset-x-0 bottom-0 z-[200] flex items-end justify-center bg-black/50 sm:items-center" style={{ top: "calc(var(--flashfood-safe-top, 0px) + 16px)" }}>
          <div role="dialog" aria-modal="true" aria-label={`Detalle de ${seleccionado.nombre}`} className="flex min-h-0 max-h-full w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-3xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="min-w-0 flex-1 truncate text-base font-extrabold">
                {seleccionado.nombre}
              </h2>

              <button
                type="button"
                onClick={cerrarProducto}
                aria-label="Cerrar"
                className="ml-3 flex h-9 w-9 items-center justify-center rounded-full bg-gray-100"
              >
                <X size={19} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5">
              <div className="mb-4 flex h-40 w-full items-center justify-center overflow-hidden rounded-2xl bg-gray-100">
                {imagenProducto(seleccionado) ? (
                  <img
                    src={imagenProducto(seleccionado)!}
                    alt={seleccionado.nombre}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-400">
                    <UtensilsCrossed size={36} strokeWidth={1.5} />
                    <span className="text-xs font-medium">Imagen no disponible</span>
                  </div>
                )}
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {seleccionado.descripcion && (
                    <p className="text-sm leading-6 text-gray-500">
                      {seleccionado.descripcion}
                    </p>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[11px] text-gray-500">Precio base</p>
                  <p className="text-lg font-extrabold text-gray-900">
                    {dinero(calcularPrecio(seleccionado, modalidad))}
                  </p>
                </div>
              </div>

              {seleccionado.presentaciones.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-sm font-extrabold text-gray-900">Opciones</h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Combina las opciones y elige cuántas unidades quieres de cada una.
                  </p>
                  <div className="mt-3 space-y-2">
                    <div className={`flex min-h-16 items-center gap-2 rounded-xl border px-3 py-2 ${cantidadBase > 0 ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-gray-900">Normal</p>
                        <p className="text-[11px] text-gray-500">Incluido</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button type="button" disabled={cantidadBase === 0 || !puedePedir} onClick={() => setCantidadBase((actual) => Math.max(0, actual - 1))} aria-label="Quitar una unidad normal" className="flex h-9 w-9 items-center justify-center rounded-lg bg-white disabled:opacity-40"><Minus size={17} /></button>
                        <span className="w-6 text-center text-sm font-extrabold">{cantidadBase}</span>
                        <button type="button" disabled={!puedePedir} onClick={() => setCantidadBase((actual) => actual + 1)} aria-label="Agregar una unidad normal" className="flex h-9 w-9 items-center justify-center rounded-lg bg-white disabled:opacity-40"><Plus size={17} /></button>
                      </div>
                    </div>
                    {seleccionado.presentaciones.map((opcion) => {
                      const cantidadOpcion = cantidadesPresentaciones[opcion.id] ?? 0
                      const precioBase = calcularPrecio(seleccionado, modalidad)
                      const diferencia = calcularPrecio(opcion, modalidad) - precioBase
                      const textoDiferencia = diferencia > 0
                        ? `+${dinero(diferencia)}`
                        : diferencia < 0
                          ? `-${dinero(Math.abs(diferencia))}`
                          : 'Incluido'
                      return (
                        <div key={opcion.id} className={`flex min-h-16 items-center gap-2 rounded-xl border px-3 py-2 ${cantidadOpcion > 0 ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-gray-900" title={opcion.nombre}>{opcion.nombre}</p>
                            <p className="text-[11px] font-bold text-orange-600">{textoDiferencia}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button type="button" disabled={cantidadOpcion === 0 || !puedePedir} onClick={() => cambiarCantidadPresentacion(opcion.id, -1)} aria-label={`Quitar una unidad de ${opcion.nombre}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white disabled:opacity-40"><Minus size={17} /></button>
                            <span className="w-6 text-center text-sm font-extrabold">{cantidadOpcion}</span>
                            <button type="button" disabled={!puedePedir} onClick={() => cambiarCantidadPresentacion(opcion.id, 1)} aria-label={`Agregar una unidad de ${opcion.nombre}`} className="flex h-9 w-9 items-center justify-center rounded-lg bg-white disabled:opacity-40"><Plus size={17} /></button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 flex items-center justify-between rounded-xl bg-gray-100 p-3 text-sm font-bold">
                    <span>{cantidadSeleccionada} {cantidadSeleccionada === 1 ? 'unidad' : 'unidades'}</span>
                    <span>{dinero(totalSeleccionado)}</span>
                  </div>
                </div>
              )}

              {puedePedir && (
                <>
                  {seleccionado.presentaciones.length === 0 && (
                    <div className="mt-5">
                      <h3 className="text-sm font-extrabold">Cantidad</h3>
                      <div className="mt-3 flex items-center gap-5">
                        <button type="button" onClick={() => setCantidad(Math.max(1, cantidad - 1))} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100"><Minus size={18} /></button>
                        <span className="min-w-6 text-center text-lg font-extrabold">{cantidad}</span>
                        <button type="button" onClick={() => setCantidad(cantidad + 1)} className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100"><Plus size={18} /></button>
                      </div>
                    </div>
                  )}

                  <div className="mt-5">
                    <label
                      htmlFor="observaciones"
                      className="text-sm font-extrabold"
                    >
                      Observaciones
                    </label>

                    <textarea
                      id="observaciones"
                      value={observaciones}
                      onChange={(event) =>
                        setObservaciones(event.target.value)
                      }
                      placeholder="Indicaciones especiales para tu pedido..."
                      rows={3}
                      className="mt-2 w-full resize-none rounded-xl border border-gray-200 p-3 text-sm outline-none focus:border-orange-400"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="shrink-0 border-t border-gray-100 bg-white px-5 pt-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
              {!puedePedir ? (
                <p className="rounded-xl bg-amber-50 p-3 text-center text-sm font-semibold text-amber-800">
                  Este restaurante todavía no acepta pedidos desde FlashFood.
                </p>
              ) : (
                <button
                  type="button"
                  disabled={cantidadSeleccionada < 1}
                  onClick={agregarProducto}
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-[#F97316] px-4 text-sm font-extrabold text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {cantidadSeleccionada < 1
                    ? 'Selecciona al menos una unidad'
                    : `Agregar ${cantidadSeleccionada} · ${dinero(totalSeleccionado)}`}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </main>
  )
}
