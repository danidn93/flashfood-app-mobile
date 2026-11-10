import type { ModalidadPedido } from './productos'

const STORAGE_KEY = 'flashfood_mobile_carrito_v1'
const EVENTO_CAMBIO = 'flashfood:carrito-actualizado'
const DOS_HORAS_MS = 2 * 60 * 60 * 1000

export type ItemCarrito = {
  id: string
  productoId: string
  presentacionId: string | null
  nombreProducto: string
  nombrePresentacion: string | null
  imagenUrl: string | null
  cantidad: number
  precioUnitario: number
  observaciones: string
}

export type Carrito = {
  sucursalId: string
  restauranteNombre: string
  modalidad: ModalidadPedido
  items: ItemCarrito[]
  tiempoRestanteMs?: number
  ultimaSalidaEn?: number | null
}

export type AgregarItemInput = {
  sucursalId: string
  restauranteNombre: string
  modalidad: ModalidadPedido
  productoId: string
  presentacionId: string | null
  nombreProducto: string
  nombrePresentacion: string | null
  imagenUrl: string | null
  cantidad: number
  precioUnitario: number
  observaciones: string
}

function guardar(carrito: Carrito | null): void {
  if (carrito) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(carrito))
  } else {
    localStorage.removeItem(STORAGE_KEY)
  }

  window.dispatchEvent(new Event(EVENTO_CAMBIO))
}

export function obtenerCarrito(): Carrito | null {
  try {
    const valor = localStorage.getItem(STORAGE_KEY)
    if (!valor) return null

    const carrito = JSON.parse(valor) as Carrito

    if (
      !carrito ||
      typeof carrito.sucursalId !== 'string' ||
      !Array.isArray(carrito.items)
    ) {
      return null
    }

    // No conservar pedidos antiguos de "servirse": tenían precios diferentes
    // y el servidor ya no acepta esa modalidad.
    if (!['retirar','domicilio'].includes(carrito.modalidad)) {
      guardar(null)
      return null
    }

    if (
      typeof carrito.ultimaSalidaEn === 'number' &&
      Number.isFinite(carrito.ultimaSalidaEn)
    ) {
      const restante =
        (carrito.tiempoRestanteMs ?? DOS_HORAS_MS) -
        Math.max(0, Date.now() - carrito.ultimaSalidaEn)

      if (restante <= 0) {
        guardar(null)
        return null
      }
    }

    return carrito
  } catch {
    return null
  }
}

export function obtenerTiempoRestanteCarrito(
  carrito: Carrito | null,
): number {
  if (!carrito) return 0

  const restante = carrito.tiempoRestanteMs ?? DOS_HORAS_MS

  if (typeof carrito.ultimaSalidaEn !== 'number') {
    return Math.max(0, restante)
  }

  return Math.max(
    0,
    restante - Math.max(0, Date.now() - carrito.ultimaSalidaEn),
  )
}

export function registrarSalidaRestaurante(sucursalId: string): Carrito | null {
  const carrito = obtenerCarrito()

  if (!carrito || carrito.sucursalId !== sucursalId) {
    return carrito
  }

  carrito.tiempoRestanteMs = 2 * 60 * 60 * 1000
  carrito.ultimaSalidaEn = Date.now()

  guardar(carrito)
  return carrito
}

export function registrarAplicacionEnSegundoPlano(
  sucursalId: string,
): Carrito | null {
  const carrito = obtenerCarrito()

  if (!carrito || carrito.sucursalId !== sucursalId) {
    return carrito
  }

  // Si ya está corriendo el contador, no reiniciarlo.
  if (typeof carrito.ultimaSalidaEn === 'number') {
    return carrito
  }

  // Al minimizar, iniciar el contador sin conceder tiempo adicional.
  carrito.tiempoRestanteMs ??= 2 * 60 * 60 * 1000
  carrito.ultimaSalidaEn = Date.now()

  guardar(carrito)
  return carrito
}

export function registrarRegresoRestaurante(
  sucursalId: string,
): Carrito | null {
  const carrito = obtenerCarrito()

  if (!carrito || carrito.sucursalId !== sucursalId) {
    return carrito
  }

  if (typeof carrito.ultimaSalidaEn !== 'number') {
    return carrito
  }

  carrito.tiempoRestanteMs = obtenerTiempoRestanteCarrito(carrito)
  carrito.ultimaSalidaEn = null

  if (carrito.tiempoRestanteMs <= 0) {
    guardar(null)
    return null
  }

  guardar(carrito)
  return carrito
}

export function agregarAlCarrito(
  entrada: AgregarItemInput,
  reemplazarCarrito = false,
): Carrito {
  if (!Number.isInteger(entrada.cantidad) || entrada.cantidad < 1) {
    throw new Error('La cantidad debe ser mayor que cero.')
  }

  if (
    !Number.isFinite(entrada.precioUnitario) ||
    entrada.precioUnitario < 0
  ) {
    throw new Error('El precio del producto no es válido.')
  }

  const actual = obtenerCarrito()

  const diferentePedido =
    actual !== null &&
    (
      actual.sucursalId !== entrada.sucursalId ||
      actual.modalidad !== entrada.modalidad
    )

  if (diferentePedido && !reemplazarCarrito) {
    throw new Error(
      'Ya tienes productos de otro restaurante o modalidad. ' +
      'Debes confirmar si deseas reemplazar el carrito.',
    )
  }

  const carrito: Carrito =
    !actual || diferentePedido
      ? {
          sucursalId: entrada.sucursalId,
          restauranteNombre: entrada.restauranteNombre,
          modalidad: entrada.modalidad,
          items: [],
        }
      : {
          ...actual,
          items: [...actual.items],
        }

  const observaciones = entrada.observaciones.trim()

  const existente = carrito.items.find(
    (item) =>
      item.productoId === entrada.productoId &&
      item.presentacionId === entrada.presentacionId &&
      item.observaciones === observaciones &&
      item.precioUnitario === entrada.precioUnitario,
  )

  if (existente) {
    existente.cantidad += entrada.cantidad
  } else {
    carrito.items.push({
      id: crypto.randomUUID(),
      productoId: entrada.productoId,
      presentacionId: entrada.presentacionId,
      nombreProducto: entrada.nombreProducto,
      nombrePresentacion: entrada.nombrePresentacion,
      imagenUrl: entrada.imagenUrl,
      cantidad: entrada.cantidad,
      precioUnitario: entrada.precioUnitario,
      observaciones,
    })
  }

  guardar(carrito)
  return carrito
}

export function actualizarCantidadItem(
  itemId: string,
  cantidad: number,
): Carrito | null {
  const carrito = obtenerCarrito()
  if (!carrito) return null

  if (!Number.isInteger(cantidad) || cantidad < 0) {
    throw new Error('Cantidad no válida.')
  }

  carrito.items = carrito.items
    .map((item) =>
      item.id === itemId ? { ...item, cantidad } : item,
    )
    .filter((item) => item.cantidad > 0)

  if (carrito.items.length === 0) {
    guardar(null)
    return null
  }

  guardar(carrito)
  return carrito
}

export function vaciarCarrito(): void {
  guardar(null)
}

export function calcularSubtotalCarrito(carrito: Carrito | null): number {
  if (!carrito) return 0

  return carrito.items.reduce(
    (total, item) => total + item.precioUnitario * item.cantidad,
    0,
  )
}

export function suscribirseAlCarrito(
  callback: () => void,
): () => void {
  window.addEventListener(EVENTO_CAMBIO, callback)
  window.addEventListener('storage', callback)

  return () => {
    window.removeEventListener(EVENTO_CAMBIO, callback)
    window.removeEventListener('storage', callback)
  }
}
