import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, ArrowRight, Bike, Check, ChevronRight,
  CreditCard, Landmark, MapPin, MessageSquareText,
  ReceiptText, Store, Wallet, ShoppingBag, Trash2,
  Minus, Plus, Package, UtensilsCrossed, AlertCircle,
} from 'lucide-react'
import {
  obtenerCarrito, actualizarCantidadItem, vaciarCarrito,
  calcularSubtotalCarrito, suscribirseAlCarrito,
  type Carrito,
} from '../services/carrito'

type MetodoPago =
  | 'tarjeta'
  | 'transferencia'
  | 'efectivo'
  | 'local'

type ModalAbierto =
  | 'direccion'
  | 'pago'
  | 'facturacion'
  | 'nota'
  | 'propina'
  | 'modalidad'
  | null

type DatosFacturacion = {
  nombre: string
  identificacion: string
  correo: string
  telefono: string
}

const TARIFA_SERVICIO = 0.15

function redondear(valor: number): number {
  return Math.round((valor + Number.EPSILON) * 100) / 100
}

function dinero(valor: number): string {
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(valor)
}

function tituloMetodo(metodo: MetodoPago): string {
  switch (metodo) {
    case 'tarjeta':
      return 'Tarjeta · PayPhone'
    case 'transferencia':
      return 'Transferencia bancaria'
    case 'efectivo':
      return 'Efectivo al repartidor'
    case 'local':
      return 'Pago en el establecimiento'
  }
}

type FilaEditableProps = {
  icono: ReactNode
  titulo: string
  valor: string
  placeholder?: boolean
  onClick: () => void
}

function FilaEditable({
  icono,
  titulo,
  valor,
  placeholder = false,
  onClick,
}: FilaEditableProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-4 border-b border-gray-100 px-4 py-4 text-left last:border-b-0"
    >
      <div className="flex w-9 shrink-0 justify-center text-gray-700">
        {icono}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-orange-600">
          {titulo}
        </p>
        <p
          className={`mt-1 break-words text-sm leading-6 ${
            placeholder
              ? 'text-gray-400'
              : 'text-gray-900'
          }`}
        >
          {valor}
        </p>
      </div>

      <ChevronRight
        size={19}
        className="shrink-0 text-gray-400"
      />
    </button>
  )
}

type ModalProps = {
  titulo: string
  children: ReactNode
  onClose: () => void
}

function Modal({
  titulo,
  children,
  onClose,
}: ModalProps) {
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
      <div className="flex max-h-[calc(100dvh-16px)] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-xl sm:max-h-[90dvh] sm:rounded-3xl">
        <div className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-lg font-bold text-gray-900">
            {titulo}
          </h3>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-1 text-sm font-semibold text-orange-600"
          >
            Cerrar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 pb-[max(24px,env(safe-area-inset-bottom))] [-webkit-overflow-scrolling:touch]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function CarritoPage() {
  const navigate = useNavigate()
  const [carrito, setCarrito] = useState<Carrito | null>(() => obtenerCarrito())
  const [confirmarVaciar, setConfirmarVaciar] = useState(false)
  const [mensaje, setMensaje] = useState('')
  const [metodoPago, setMetodoPago] = useState<MetodoPago>(
    obtenerCarrito()?.modalidad === 'domicilio' ? 'efectivo' : 'local',
  )
  const [modal, setModal] = useState<ModalAbierto>(null)
  const [direccion, setDireccion] = useState('')
  const [referencia, setReferencia] = useState('')
  const [nota, setNota] = useState('')
  const [facturacion, setFacturacion] = useState<DatosFacturacion>({
    nombre: '', identificacion: '', correo: '', telefono: '',
  })
  const [propina, setPropina] = useState(0)
  const [otraPropina, setOtraPropina] = useState('')
  // Se conectará con la cotización real del repartidor.
  const [costoEnvio] = useState<number | null>(null)

  useEffect(() => suscribirseAlCarrito(() => setCarrito(obtenerCarrito())), [])

  const esDelivery = carrito?.modalidad === 'domicilio'
  /* eslint-disable react-hooks/set-state-in-effect -- La modalidad de pago debe sincronizarse al cambiar entrega. */
  useEffect(() => {
    if (esDelivery) {
      setMetodoPago(actual => actual === 'local' ? 'efectivo' : actual)
    } else {
      setMetodoPago('local')
      setPropina(0)
    }
  }, [esDelivery])

  const subtotal = useMemo(() => redondear(calcularSubtotalCarrito(carrito)), [carrito])
  const cantidadTotal = carrito?.items.reduce((n, item) => n + item.cantidad, 0) ?? 0
  const desglose = useMemo(() => {
    const envioBase = esDelivery ? (costoEnvio ?? 0) : 0
    const propinaReal = esDelivery ? propina : 0
    const envio = redondear(envioBase + propinaReal)
    const base = redondear(subtotal + envio)
    const tarifaServicio = esDelivery && metodoPago === 'tarjeta'
      ? redondear(base * TARIFA_SERVICIO) : 0
    return {
      pedido: subtotal, costoEnvio: envioBase, propina: propinaReal,
      envio, tarifaServicio, total: redondear(base + tarifaServicio),
    }
  }, [subtotal, esDelivery, costoEnvio, propina, metodoPago])
  const pendienteEnvio = esDelivery && costoEnvio === null
  const datosFacturacionCompletos = !!(
    facturacion.nombre.trim() && facturacion.identificacion.trim() && facturacion.correo.trim()
  )

  function cambiarModalidad(nuevaModalidad: Carrito['modalidad']) {
    if (!carrito || nuevaModalidad === carrito.modalidad) {
      setModal(null)
      return
    }
    try {
      const actualizado: Carrito = { ...carrito, modalidad: nuevaModalidad }
      localStorage.setItem('flashfood_mobile_carrito_v1', JSON.stringify(actualizado))
      setCarrito(actualizado)
      setMetodoPago(nuevaModalidad === 'domicilio' ? 'efectivo' : 'local')
      if (nuevaModalidad !== 'domicilio') setPropina(0)
      setModal(null)
      setMensaje('Revisa los precios de los productos: algunas presentaciones pueden variar según la modalidad.')
    } catch {
      setMensaje('No se pudo guardar la modalidad del pedido.')
    }
  }

  function cambiarCantidad(id: string, cantidad: number) {
    try {
      actualizarCantidadItem(id, cantidad)
      setMensaje('')
      setCarrito(obtenerCarrito())
    } catch (error) {
      setMensaje(error instanceof Error ? error.message : 'No se pudo actualizar la cantidad.')
    }
  }
  function limpiarCarrito() {
    vaciarCarrito()
    setCarrito(obtenerCarrito())
    setConfirmarVaciar(false)
    setMensaje('')
  }
  function seleccionarPropina(valor: number) {
    setPropina(valor)
    setOtraPropina('')
  }
  function guardarOtraPropina() {
    const numero = Number(otraPropina.replace(',', '.'))
    if (!Number.isFinite(numero) || numero < 0 || numero > 9999) return
    setPropina(redondear(numero))
    setModal(null)
  }

  const modalidadInfo = carrito?.modalidad === 'domicilio'
    ? { nombre: 'Entrega a domicilio', descripcion: 'El envío se calculará antes de confirmar.', icono: Bike }
    : carrito?.modalidad === 'retirar'
      ? { nombre: 'Retiro en el restaurante', descripcion: 'Recoge tu pedido en el local.', icono: Package }
      : { nombre: 'Servir en el restaurante', descripcion: 'Consume tu pedido en el local.', icono: UtensilsCrossed }
  const IconoModalidad = modalidadInfo.icono

  return (
    <main className="h-[calc(100dvh-76px)] w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-[#F7F8FA] pb-32 [-webkit-overflow-scrolling:touch]">
      <div className="mx-auto max-w-3xl">
        <header className="flex items-center gap-3 bg-white px-4 py-5">
          <button type="button" onClick={() => navigate(-1)} aria-label="Volver"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-100">
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold text-gray-900">Mi pedido</h1>
            <p className="text-xs text-gray-500">{cantidadTotal} {cantidadTotal === 1 ? 'producto' : 'productos'}</p>
          </div>
          {!!carrito?.items.length && (
            <button type="button" onClick={() => setConfirmarVaciar(true)}
              className="flex items-center gap-1 text-xs font-bold text-red-500">
              <Trash2 size={16} /> Vaciar
            </button>
          )}
        </header>

        {!carrito || carrito.items.length === 0 ? (
          <section className="mx-4 mt-5 rounded-3xl bg-white px-6 py-14 text-center">
            <ShoppingBag size={40} className="mx-auto text-orange-500" />
            <h2 className="mt-5 text-lg font-bold">Tu carrito está vacío</h2>
            <p className="mt-2 text-sm text-gray-500">Explora nuestros restaurantes y agrega tus productos favoritos.</p>
            <Link to="/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-sm font-bold text-white">
              Explorar restaurantes <ArrowRight size={17} />
            </Link>
          </section>
        ) : (
          <>
            <section className="mt-2 bg-white px-4 py-4">
              <Link to={`/restaurante/${carrito.sucursalId}`} className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-500"><Store size={22} /></div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-400">Establecimiento</p>
                  <p className="truncate text-base font-extrabold text-gray-900">{carrito.restauranteNombre}</p>
                </div>
                <ChevronRight size={18} className="text-gray-400" />
              </Link>
              <button type="button" onClick={() => setModal('modalidad')}
                className="mt-3 flex w-full items-center gap-3 rounded-xl bg-gray-50 p-3 text-left">
                <IconoModalidad size={20} className="shrink-0 text-orange-500" />
                <div className="min-w-0 flex-1"><p className="text-sm font-bold">{modalidadInfo.nombre}</p>
                  <p className="text-xs text-gray-500">{modalidadInfo.descripcion}</p></div>
                <ChevronRight size={19} className="shrink-0 text-gray-400" />
              </button>
            </section>

            <section className="mt-2 bg-white px-4 py-5">
              <h2 className="mb-4 text-sm font-bold text-orange-600">Detalle del pedido</h2>
              <div className="divide-y divide-gray-100">
                {carrito.items.map(item => (
                  <article key={item.id} className="py-3 first:pt-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-gray-900">{item.cantidad}x {item.nombreProducto}</p>
                        {item.nombrePresentacion && <p className="mt-1 text-xs text-orange-600">{item.nombrePresentacion}</p>}
                        {item.observaciones && <p className="mt-1 text-xs text-gray-500">{item.observaciones}</p>}
                        <p className="mt-1 text-xs text-gray-400">{dinero(item.precioUnitario)} c/u</p>
                      </div>
                      <p className="shrink-0 text-sm font-bold text-gray-900">{dinero(item.precioUnitario * item.cantidad)}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <button type="button" onClick={() => cambiarCantidad(item.id, item.cantidad - 1)}
                        aria-label={item.cantidad === 1 ? 'Eliminar producto' : 'Reducir cantidad'}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-orange-600">
                        {item.cantidad === 1 ? <Trash2 size={16} /> : <Minus size={16} />}
                      </button>
                      <span className="text-sm font-bold">{item.cantidad}</span>
                      <button type="button" onClick={() => cambiarCantidad(item.id, item.cantidad + 1)}
                        aria-label="Aumentar cantidad" className="flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-orange-600"><Plus size={16} /></button>
                    </div>
                  </article>
                ))}
              </div>
              <Link to={`/restaurante/${carrito.sucursalId}`}
                className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-orange-200 py-3 text-sm font-bold text-orange-600">
                <Plus size={17} /> Agregar más productos
              </Link>
            </section>

            <section className="mt-2 bg-white">
              <FilaEditable icono={<MessageSquareText size={23} />} titulo="Nota adicional (opcional)"
                valor={nota || '¿Algo que el establecimiento deba considerar?'} placeholder={!nota} onClick={() => setModal('nota')} />
              {esDelivery && (
                <FilaEditable icono={<MapPin size={23} />} titulo="Dirección de entrega"
                  valor={direccion ? (referencia ? `${direccion} · ${referencia}` : direccion) : 'Seleccionar dirección de entrega'}
                  placeholder={!direccion} onClick={() => setModal('direccion')} />
              )}
              <FilaEditable icono={metodoPago === 'tarjeta' ? <CreditCard size={23} /> : metodoPago === 'transferencia' ? <Landmark size={23} /> : <Wallet size={23} />}
                titulo="Método de pago" valor={tituloMetodo(metodoPago)} onClick={() => { if (esDelivery) setModal('pago') }} />
              <FilaEditable icono={<ReceiptText size={23} />} titulo="Datos de facturación"
                valor={datosFacturacionCompletos ? `${facturacion.nombre} · ${facturacion.identificacion}` : 'Agregar datos de facturación'}
                placeholder={!datosFacturacionCompletos} onClick={() => setModal('facturacion')} />
            </section>

            {esDelivery && (
              <section className="mt-2 bg-white px-4 py-5">
                <h2 className="text-sm font-bold text-orange-600">Propina para el repartidor</h2>
                <p className="mt-2 text-sm font-bold text-gray-900">¡Gracias a ellos las entregas son posibles!</p>
                <p className="mt-1 text-sm text-gray-500">Añade una propina y reconoce su esfuerzo.</p>
                <div className="mt-4 grid grid-cols-4 gap-2">
                  {[0.5, 1, 2].map(valor => (
                    <button key={valor} type="button" onClick={() => seleccionarPropina(valor)}
                      className={`rounded-full border px-1 py-2.5 text-sm font-bold ${propina === valor ? 'border-orange-500 bg-orange-50 text-orange-600' : 'border-gray-200 text-gray-700'}`}>
                      {dinero(valor)}
                    </button>
                  ))}
                  <button type="button" onClick={() => setModal('propina')}
                    className="rounded-full border border-gray-200 px-1 py-2.5 text-sm font-bold text-gray-700">Otro</button>
                </div>
                <button type="button" onClick={() => seleccionarPropina(0)}
                  className="mt-3 text-xs font-semibold text-gray-500 underline">Sin propina</button>
                <p className="mt-3 text-xs text-gray-400">La propina se incluye en Envío, pero se guarda como concepto separado al crear el pedido.</p>
              </section>
            )}

            <section className="mt-2 bg-white px-4 py-5">
              <h2 className="mb-5 text-base font-bold text-gray-900">Resumen del pago</h2>
              <div className="space-y-4 text-sm">
                <div className="flex justify-between gap-3"><span>Pedido</span><b>{dinero(desglose.pedido)}</b></div>
                {esDelivery && <div className="flex justify-between gap-3"><span>Envío</span><b>{pendienteEnvio ? 'Por calcular' : dinero(desglose.envio)}</b></div>}
                {esDelivery && metodoPago === 'tarjeta' &&
                  <div className="flex justify-between gap-3"><span>Tarifa de servicio</span><b>{pendienteEnvio ? 'Por calcular' : dinero(desglose.tarifaServicio)}</b></div>}
                <div className="flex justify-between gap-3 border-t border-gray-200 pt-4 text-lg font-extrabold">
                  <span>Total</span><span>{pendienteEnvio ? 'Por calcular' : dinero(desglose.total)}</span>
                </div>
              </div>
              {pendienteEnvio && <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-800">Falta obtener la tarifa real de entrega antes de confirmar el total.</p>}
            </section>
            {mensaje && <div className="mx-4 mt-4 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700"><AlertCircle size={17} />{mensaje}</div>}
            <div className="bg-white px-4 pb-6 pt-4">
              <button type="button" disabled
                className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-orange-500 px-4 py-4 text-base font-bold text-white opacity-70">
                {esDelivery && metodoPago === 'tarjeta' ? 'Continuar con PayPhone' : 'Confirmar pedido'}
                <ChevronRight size={20} />
              </button>
              <p className="mt-2 text-center text-xs text-gray-400">Pendiente de conectar la creación real del pedido y el pago.</p>
            </div>
          </>
        )}
      </div>

      {confirmarVaciar && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-5">
          <div role="dialog" aria-modal="true" aria-label="Vaciar carrito" className="w-full max-w-sm rounded-3xl bg-white p-6">
            <h2 className="text-lg font-extrabold">¿Vaciar tu carrito?</h2>
            <p className="mt-2 text-sm text-gray-500">Se eliminarán todos los productos seleccionados.</p>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setConfirmarVaciar(false)} className="rounded-xl bg-gray-100 py-3 font-bold">Cancelar</button>
              <button type="button" onClick={limpiarCarrito} className="rounded-xl bg-red-500 py-3 font-bold text-white">Vaciar carrito</button>
            </div>
          </div>
        </div>, document.body,
      )}
      {/* Modales */}
      {modal === 'modalidad' && (
        <Modal titulo="¿Cómo deseas recibir tu pedido?" onClose={() => setModal(null)}>
          <div className="space-y-3">
            {([
              { id: 'domicilio', titulo: 'Entrega a domicilio', descripcion: 'Un repartidor entrega tu pedido', icono: Bike },
              { id: 'retirar', titulo: 'Pide y retira', descripcion: 'Recoge y paga en el restaurante', icono: Package },
              { id: 'servir', titulo: 'Para servirse', descripcion: 'Consume y paga en el restaurante', icono: UtensilsCrossed },
            ] as const).map(opcion => {
              const Icono = opcion.icono
              return (
                <button key={opcion.id} type="button" onClick={() => cambiarModalidad(opcion.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left ${carrito.modalidad === opcion.id ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}>
                  <Icono size={23} className="shrink-0 text-orange-600" />
                  <span className="min-w-0 flex-1"><span className="block text-sm font-bold">{opcion.titulo}</span>
                    <span className="mt-1 block text-xs text-gray-500">{opcion.descripcion}</span></span>
                  {carrito.modalidad === opcion.id && <Check size={20} className="shrink-0 text-orange-600" />}
                </button>
              )
            })}
          </div>
        </Modal>
      )}
      {modal === 'direccion' && (
        <Modal
          titulo="Dirección de entrega"
          onClose={() => setModal(null)}
        >
          <div className="space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              Dirección
              <input
                type="text"
                value={direccion}
                onChange={(event) =>
                  setDireccion(event.target.value)
                }
                placeholder="Calle principal, número, sector"
                className="mt-2 w-full rounded-xl border border-gray-200 p-3 outline-none focus:border-orange-500"
              />
            </label>

            <label className="block text-sm font-medium text-gray-700">
              Referencia
              <textarea
                value={referencia}
                onChange={(event) =>
                  setReferencia(event.target.value)
                }
                placeholder="Color de la casa, puerta, indicaciones..."
                rows={3}
                className="mt-2 w-full rounded-xl border border-gray-200 p-3 outline-none focus:border-orange-500"
              />
            </label>

            <button
              type="button"
              onClick={() => setModal(null)}
              disabled={!direccion.trim()}
              className="w-full rounded-xl bg-orange-500 p-3 font-bold text-white disabled:opacity-50"
            >
              Guardar dirección
            </button>
          </div>
        </Modal>
      )}

      {modal === 'pago' && (
        <Modal
          titulo="Método de pago"
          onClose={() => setModal(null)}
        >
          <div className="space-y-3">
            {(
              [
                {
                  id: 'tarjeta',
                  nombre: 'Tarjeta de crédito o débito',
                  descripcion:
                    'PayPhone · Tarifa de servicio del 15 %',
                  icono: <CreditCard size={23} />,
                },
                {
                  id: 'transferencia',
                  nombre: 'Transferencia bancaria',
                  descripcion:
                    'A las cuentas del delivery asignado',
                  icono: <Landmark size={23} />,
                },
                {
                  id: 'efectivo',
                  nombre: 'Efectivo',
                  descripcion:
                    'Pago al delivery al recibir el pedido',
                  icono: <Wallet size={23} />,
                },
              ] as const
            ).map((opcion) => (
              <button
                key={opcion.id}
                type="button"
                onClick={() => {
                  setMetodoPago(opcion.id)
                  setModal(null)
                }}
                className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left ${
                  metodoPago === opcion.id
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-gray-200'
                }`}
              >
                <span className="text-orange-600">
                  {opcion.icono}
                </span>

                <span className="flex-1">
                  <span className="block text-sm font-semibold text-gray-900">
                    {opcion.nombre}
                  </span>
                  <span className="mt-1 block text-xs text-gray-500">
                    {opcion.descripcion}
                  </span>
                </span>

                {metodoPago === opcion.id && (
                  <Check
                    size={20}
                    className="text-orange-600"
                  />
                )}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {modal === 'facturacion' && (
        <Modal
          titulo="Datos de facturación"
          onClose={() => setModal(null)}
        >
          <div className="space-y-4">
            {(
              [
                ['nombre', 'Nombre o razón social'],
                ['identificacion', 'Cédula o RUC'],
                ['correo', 'Correo electrónico'],
                ['telefono', 'Teléfono'],
              ] as const
            ).map(([campo, etiqueta]) => (
              <label
                key={campo}
                className="block text-sm font-medium text-gray-700"
              >
                {etiqueta}
                <input
                  type={
                    campo === 'correo'
                      ? 'email'
                      : campo === 'telefono'
                        ? 'tel'
                        : 'text'
                  }
                  value={facturacion[campo]}
                  onChange={(event) =>
                    setFacturacion((actual) => ({
                      ...actual,
                      [campo]: event.target.value,
                    }))
                  }
                  className="mt-2 w-full rounded-xl border border-gray-200 p-3 outline-none focus:border-orange-500"
                />
              </label>
            ))}

            <button
              type="button"
              onClick={() => setModal(null)}
              className="w-full rounded-xl bg-orange-500 p-3 font-bold text-white"
            >
              Guardar datos
            </button>
          </div>
        </Modal>
      )}

      {modal === 'nota' && (
        <Modal
          titulo="Nota adicional"
          onClose={() => setModal(null)}
        >
          <textarea
            value={nota}
            onChange={(event) =>
              setNota(event.target.value)
            }
            rows={5}
            maxLength={500}
            placeholder="¿Algo que el establecimiento deba considerar?"
            className="w-full rounded-xl border border-gray-200 p-3 outline-none focus:border-orange-500"
          />

          <button
            type="button"
            onClick={() => setModal(null)}
            className="mt-4 w-full rounded-xl bg-orange-500 p-3 font-bold text-white"
          >
            Guardar nota
          </button>
        </Modal>
      )}

      {modal === 'propina' && (
        <Modal
          titulo="Otra propina"
          onClose={() => setModal(null)}
        >
          <p className="mb-3 text-sm text-gray-500">
            Ingresa el valor que deseas entregar al
            repartidor.
          </p>

          <div className="flex items-center gap-2 rounded-xl border border-gray-200 p-3">
            <span className="font-bold">$</span>

            <input
              type="text"
              inputMode="decimal"
              value={otraPropina}
              onChange={(event) => {
                const valor =
                  event.target.value.replace(',', '.')

                if (
                  valor === '' ||
                  /^\d{0,4}(\.\d{0,2})?$/.test(valor)
                ) {
                  setOtraPropina(valor)
                }
              }}
              placeholder="0.00"
              className="w-full outline-none"
            />
          </div>

          <button
            type="button"
            onClick={guardarOtraPropina}
            disabled={
              otraPropina.trim() === '' ||
              !Number.isFinite(
                Number(
                  otraPropina.replace(',', '.'),
                ),
              )
            }
            className="mt-4 w-full rounded-xl bg-orange-500 p-3 font-bold text-white disabled:opacity-50"
          >
            Guardar propina
          </button>
        </Modal>
      )}
    </main>
  )
}
