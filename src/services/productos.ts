import { supabase } from '../lib/supabase'

export type ModalidadPedido = 'retirar' | 'domicilio'

export type PresentacionProducto = {
  id: string
  producto_id: string
  nombre: string
  descripcion: string | null
  precio: number
  precio_para_llevar: number | null
  imagen_url: string | null
  activo: boolean
  orden: number
}

export type ProductoMenu = {
  id: string
  local_id: string
  nombre: string
  descripcion: string | null
  categoria: string | null
  tipo: string
  precio: number
  precio_para_llevar: number | null
  image_url: string | null
  presentaciones: PresentacionProducto[]
}

type ProductoDB = Omit<ProductoMenu, 'presentaciones'>

type DisponibilidadDB = {
  producto_id: string
}

export function calcularPrecio(
  producto: Pick<ProductoMenu, 'precio' | 'precio_para_llevar'>,
  _modalidad: ModalidadPedido,
): number {
  const precio = producto.precio_para_llevar ?? producto.precio

  return Number(precio)
}

export function obtenerPrecioMinimo(
  producto: ProductoMenu,
  modalidad: ModalidadPedido,
): number {
  if (producto.presentaciones.length === 0) {
    return calcularPrecio(producto, modalidad)
  }

  // La opción "Normal" usa el precio del producto y también debe
  // participar en el mínimo, aunque existan presentaciones adicionales.
  return Math.min(
    calcularPrecio(producto, modalidad),
    ...producto.presentaciones.map((presentacion) =>
      calcularPrecio(presentacion, modalidad),
    ),
  )
}

export async function obtenerProductosSucursal(
  sucursalId: string,
): Promise<ProductoMenu[]> {
  // Consultar disponibilidad de productos en esta sucursal.
  const { data: disponibilidades, error: errorDisponibilidad } =
    await supabase
      .from('productos_sucursal')
      .select('producto_id')
      .eq('sucursal_id', sucursalId)
      .eq('disponible', true)

  if (errorDisponibilidad) {
    throw new Error(errorDisponibilidad.message)
  }

  const idsProductos = [
    ...new Set(
      ((disponibilidades ?? []) as DisponibilidadDB[])
        .map((registro) => registro.producto_id),
    ),
  ]

  if (idsProductos.length === 0) {
    return []
  }

  // Obtener los productos reales habilitados en la sucursal.
  const { data: productos, error: errorProductos } = await supabase
    .from('productos_local')
    .select(`
      id,
      local_id,
      nombre,
      descripcion,
      categoria,
      tipo,
      precio,
      precio_para_llevar,
      image_url
    `)
    .in('id', idsProductos)
    .eq('tipo', 'producto')
    .order('nombre', { ascending: true })

  if (errorProductos) {
    throw new Error(errorProductos.message)
  }

  const productosReales = (productos ?? []) as ProductoDB[]

  if (productosReales.length === 0) {
    return []
  }

  // Obtener las presentaciones activas de los productos.
  const { data: presentaciones, error: errorPresentaciones } =
    await supabase
      .from('producto_presentaciones')
      .select(`
        id,
        producto_id,
        nombre,
        descripcion,
        precio,
        precio_para_llevar,
        imagen_url,
        activo,
        orden
      `)
      .in(
        'producto_id',
        productosReales.map((producto) => producto.id),
      )
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('nombre', { ascending: true })

  if (errorPresentaciones) {
    throw new Error(errorPresentaciones.message)
  }

  const presentacionesReales =
    (presentaciones ?? []) as PresentacionProducto[]

  return productosReales.map((producto) => ({
    ...producto,
    precio: Number(producto.precio),
    precio_para_llevar:
      producto.precio_para_llevar === null
        ? null
        : Number(producto.precio_para_llevar),
    presentaciones: presentacionesReales
      .filter(
        (presentacion) =>
          presentacion.producto_id === producto.id,
      )
      .map((presentacion) => ({
        ...presentacion,
        precio: Number(presentacion.precio),
        precio_para_llevar:
          presentacion.precio_para_llevar === null
            ? null
            : Number(presentacion.precio_para_llevar),
      })),
  }))
}
