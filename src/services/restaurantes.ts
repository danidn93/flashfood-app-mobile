
import { obtenerCalificacionesRestaurantes } from './calificaciones'
import { supabase } from '../lib/supabase'

export type Restaurante = {
  id: string
  local_id: string
  nombre: string
  direccion: string | null
  abierto: boolean
  acepta_pedidos_app: boolean
  lat: number | null
  lng: number | null
  locales: {
    id: string
    nombre: string
    nombre_comercial: string | null
    activo: boolean
  }[]
  configuracion: {
    logo_url: string | null
    hero_bg_url: string | null
  }[]
  promedio_calificacion: number | null
  total_calificaciones: number
}

type RestauranteGlobalDB = {
  local_id: string
  restaurante: string
  nombre_comercial: string | null
  sucursal_id: string
  sucursal: string
  direccion: string | null
  telefono: string | null
  lat: number | null
  lng: number | null
  abierto: boolean
  acepta_pedidos: boolean
  logo_url?: string | null
  hero_bg_url?: string | null
}

type ImagenRestaurante = {
  logo_url: string | null
  hero_bg_url: string | null
}

type SucursalConConfiguracion = {
  id: string
  configuracion:
    | ImagenRestaurante
    | ImagenRestaurante[]
    | null
}

export async function obtenerRestaurantes(): Promise<Restaurante[]> {
  // 1. Obtener los restaurantes habilitados para
  // la aplicación global FlashFood Mobile.
  const { data, error } = await supabase.rpc(
    'flashfood_catalogo_restaurantes',
    {
      p_app_codigo: 'flashfood_mobile',
    },
  )

  if (error) {
    throw new Error(
      `Error al consultar restaurantes: ${error.message}`,
    )
  }

  // Agregar el espejo del ERP sin exponer IDs del ERP ni usar una segunda sesión Supabase.
  const {data:erpRows,error:erpError}=await supabase.rpc('flashfood_erp_public_restaurants')
  if(erpError)throw new Error('No se pudo leer catálogo de Multicomercios: '+erpError.message)
  const {data:mirrorIds,error:mirrorError}=await supabase.rpc('flashfood_erp_mirror_branch_ids')
  if(mirrorError)throw new Error('No se pudieron verificar los restaurantes importados: '+mirrorError.message)
  const mirrors=new Set(Array.isArray(mirrorIds)?mirrorIds as string[]:[])
  const legacy=((data ?? []) as RestauranteGlobalDB[]).filter(x=>!mirrors.has(x.sucursal_id))
  const erp=(Array.isArray(erpRows)?erpRows:[]) as RestauranteGlobalDB[]
  const catalogo=[...legacy,...erp]

  if (catalogo.length === 0) {
    return []
  }

  // 2. Obtener los identificadores de las sucursales
  // y los locales que pertenecen al catálogo.
  const sucursalesIds = [
    ...new Set(
      catalogo.map((restaurante) => restaurante.sucursal_id),
    ),
  ]

  const localesIds = [
    ...new Set(
      catalogo.map((restaurante) => restaurante.local_id),
    ),
  ]

  // 3. Recuperar los logotipos y las imágenes comerciales
  // usando la relación original de Supabase.
  //
  // IMPORTANTE:
  // La tabla configuracion no tiene columna local_id.
  // Por eso se consulta desde sucursales.
  const {
    data: sucursalesConImagenes,
    error: errorConfiguracion,
  } = await supabase
    .from('sucursales')
    .select(`
      id,
      configuracion (
        logo_url,
        hero_bg_url
      )
    `)
    .in('id', sucursalesIds)

  if (errorConfiguracion) {
    // Un error de imágenes no debe impedir
    // que aparezcan los restaurantes.
    console.error(
      'Error al consultar imágenes de restaurantes:',
      errorConfiguracion,
    )
  }

  // 4. Crear un mapa de imágenes por sucursal.
  const imagenesPorSucursal = new Map<
    string,
    ImagenRestaurante
  >()

  const sucursales =
    (sucursalesConImagenes ?? []) as SucursalConConfiguracion[]

  for (const sucursal of sucursales) {
    const configuracion = Array.isArray(
      sucursal.configuracion,
    )
      ? sucursal.configuracion[0]
      : sucursal.configuracion

    if (!configuracion) {
      continue
    }

    imagenesPorSucursal.set(sucursal.id, {
      logo_url: configuracion.logo_url ?? null,
      hero_bg_url: configuracion.hero_bg_url ?? null,
    })
  }

  // 5. Consultar las calificaciones por local.
  // Las calificaciones pertenecen al restaurante,
  // no individualmente a cada sucursal.
  let calificaciones: Awaited<
    ReturnType<typeof obtenerCalificacionesRestaurantes>
  > = {}

  try {
    calificaciones =
      await obtenerCalificacionesRestaurantes(localesIds)
  } catch (error) {
    // Si falla la consulta de calificaciones,
    // los restaurantes deben seguir apareciendo.
    console.error(
      'Error al cargar calificaciones:',
      error,
    )
  }

  // 6. Transformar los resultados globales
  // a la estructura utilizada por HomePage.
  return catalogo.map((item): Restaurante => {
    const configuracion =
      imagenesPorSucursal.get(item.sucursal_id)

    const calificacion =
      calificaciones[item.local_id]

    return {
      // Identificador de la sucursal.
      id: item.sucursal_id,

      // Identificador del restaurante.
      local_id: item.local_id,

      // Nombre de la sucursal.
      nombre: item.sucursal,

      direccion: item.direccion,

      abierto: item.abierto,

      acepta_pedidos_app: item.acepta_pedidos,

      lat: item.lat,

      lng: item.lng,

      // Mantener la estructura esperada
      // por los componentes existentes.
      locales: [
        {
          id: item.local_id,
          nombre: item.restaurante,
          nombre_comercial:
            item.nombre_comercial?.trim() ||
            item.restaurante,
          activo: true,
        },
      ],

      // Logotipo y portada del restaurante.
      configuracion: [
        {
          logo_url: configuracion?.logo_url ?? item.logo_url ?? null,
          hero_bg_url: configuracion?.hero_bg_url ?? item.hero_bg_url ?? null,
        },
      ],

      // Calificaciones reales.
      promedio_calificacion:
        calificacion?.promedio ?? null,

      total_calificaciones:
        calificacion?.total_calificaciones ?? 0,
    }
  })
}
