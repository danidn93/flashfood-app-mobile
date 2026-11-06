import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const uuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab0-9a-f]{12}$/i.test(v)
const coord = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max
const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
const roadDistance = async (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const key = Deno.env.get('OPENROUTESERVICE_API_KEY')
  if (!key) throw new Error('Falta OPENROUTESERVICE_API_KEY')
  const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
    method: 'POST',
    headers: { 'Authorization': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ coordinates: [[aLng, aLat], [bLng, bLat]] }),
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error('No se pudo calcular un recorrido vial (' + response.status + ')')
  const data = await response.json()
  const meters = Number(data?.routes?.[0]?.summary?.distance)
  const seconds = Number(data?.routes?.[0]?.summary?.duration)
  if (!Number.isFinite(meters) || meters < 0 || !Number.isFinite(seconds)) throw new Error('Ruta vial no disponible')
  return { distance_km: meters / 1000, duration_minutes: Math.ceil(seconds / 60) }
}
const parseTime = (raw: unknown): number | null => {
  if (typeof raw !== 'string' || !/^\d{2}:\d{2}$/.test(raw)) return null
  const [h, m] = raw.split(':').map(Number)
  return h < 24 && m < 60 ? h * 60 + m : null
}
const isNight = (start: unknown, end: unknown) => {
  const s = parseTime(start), e = parseTime(end)
  if (s === null || e === null || s === e) return false
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
  const now = parseTime(local)
  if (now === null) return false
  return s < e ? now >= s && now < e : now >= s || now < e
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return reply({ ok: false, error: 'Método no permitido' }, 405)
  let stage = 'initialization'
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const anon = Deno.env.get('SUPABASE_ANON_KEY')
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !service) return reply({ ok: false, error: 'Configuración incompleta' }, 503)
    const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    if (!jwt) return reply({ ok: false, error: 'Inicia sesión para cotizar el envío' }, 401)
    const auth = createClient(url, anon)
    const { data: userData, error: authError } = await auth.auth.getUser(jwt)
    if (authError || !userData.user) return reply({ ok: false, error: 'Sesión inválida' }, 401)
    const input = await req.json().catch(() => ({})) as Record<string, unknown>
    if (!uuid(input.branch_id) || !uuid(input.address_id))
      return reply({ ok: false, error: 'Selecciona una sucursal y dirección válidas' }, 400)

    const db = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
    stage = 'customer_address'
    const { data: address, error: addressError } = await db.from('flashfood_customer_addresses')
      .select('id,latitude,longitude').eq('id', input.address_id).eq('user_id', userData.user.id).maybeSingle()
    if (addressError) throw addressError
    if (!address) return reply({ ok: false, error: 'Dirección no encontrada' }, 404)
    if (!coord(address.latitude, 90) || !coord(address.longitude, 180))
      return reply({ ok: false, error: 'Agrega coordenadas GPS a tu dirección para calcular el envío' }, 422)

    stage = 'restaurant_catalog'
    const { data: catalog, error: catalogError } = await db.rpc('flashfood_catalogo_restaurantes', { p_app_codigo: 'flashfood_mobile' })
    if (catalogError) throw catalogError
    const { data: erpCatalog, error: erpError } = await db.rpc('flashfood_erp_public_restaurants')
    if (erpError) throw erpError
    const { data: mirrored, error: mirroredError } = await db.rpc('flashfood_erp_mirror_branch_ids')
    if (mirroredError) throw mirroredError
    const erpIds = new Set<string>(Array.isArray(mirrored) ? mirrored as string[] : [])
    const allowed = [
      ...(Array.isArray(catalog) ? catalog.filter(r => !erpIds.has(r.sucursal_id)) : []),
      ...(Array.isArray(erpCatalog) ? erpCatalog : []),
    ]
    const branch = allowed.find(r => r.sucursal_id === input.branch_id)
    if (!branch || !branch.abierto || !branch.acepta_pedidos)
      return reply({ ok: false, error: 'La sucursal está cerrada o no recibe pedidos en FlashFood' }, 409)

    // La tabla configuracion conserva coordenadas independientes de sucursales.
    // No sobrescribirlas con lat/lng nulos que pudiera traer el catálogo.
    stage = 'branch_coordinates'
    const { data: dbBranch, error: branchError } = await db.from('sucursales')
      .select('id,lat,lng').eq('id', input.branch_id).maybeSingle()
    if (branchError) throw branchError
    if (!dbBranch) return reply({ ok: false, error: 'Sucursal no encontrada' }, 404)
    const { data: branchConfig, error: configError } = await db.from('configuracion')
      .select('lat,lng').eq('sucursal_id', input.branch_id).maybeSingle()
    if (configError) throw configError
    const branchLat = coord(dbBranch.lat, 90) ? dbBranch.lat
      : coord(branchConfig?.lat, 90) ? branchConfig!.lat : null
    const branchLng = coord(dbBranch.lng, 180) ? dbBranch.lng
      : coord(branchConfig?.lng, 180) ? branchConfig!.lng : null
    if (branchLat === null || branchLng === null)
      return reply({ ok: false, error: 'La sucursal aún no tiene coordenadas configuradas en sucursales ni configuracion' }, 422)
    const bLat = branchLat, bLng = branchLng

    stage = 'drivers_availability'
    const { data: available, error: availabilityError } = await db.rpc('flashfood_delivery_disponible')
    if (availabilityError) throw availabilityError
    if (available !== true) return reply({ ok: false, error: 'No hay repartidores disponibles en este momento' }, 409)

    stage = 'delivery_tariff'
    const { data: tariff, error: tariffError } = await db.from('flashfood_global_settings')
      .select('value').eq('key', 'delivery_global_tariff').maybeSingle()
    if (tariffError) throw tariffError
    const config = tariff?.value as Record<string, unknown> | null
    if (!config || typeof config !== 'object' || Array.isArray(config))
      return reply({ ok: false, error: 'Configura primero la tarifa global del delivery en Superadmin' }, 503)
    const readAmount = (key: string) => {
      const value = config[key]
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000 ? value : null
    }
    const base = readAmount('base_fee'), included = readAmount('included_km')
    const perKm = readAmount('additional_km_fee'), nightFee = readAmount('night_fee')
    const rainFee = readAmount('rain_fee')
    if ([base, included, perKm, nightFee, rainFee].some(x => x === null))
      return reply({ ok: false, error: 'La tarifa global del delivery tiene valores inválidos' }, 503)

    stage = 'route_provider'
    if (!Deno.env.get('OPENROUTESERVICE_API_KEY'))
      return reply({ ok: false, error: 'No está configurada OPENROUTESERVICE_API_KEY en los secretos de Locales' }, 503)
    const road = await roadDistance(bLat, bLng, address.latitude, address.longitude)
    const distance = road.distance_km
    // Straight-line distance is only an estimate: road routing is not yet connected.
    const night = isNight(config.night_start, config.night_end)
    const rain = config.rain_enabled === true
    const extra = round(Math.max(0, distance - included!) * perKm!)
    stage = 'business_delivery_settings'
    const { data: businessSettings, error: businessError } = await db.from('flashfood_business_settings')
      .select('free_delivery').eq('business_id', branch.local_id).maybeSingle()
    if (businessError) throw businessError
    const customerFee = businessSettings?.free_delivery === true ? 0 : round(base! + extra + (night ? nightFee! : 0) + (rain ? rainFee! : 0))
    return reply({
      ok: true, estimated: false, distance_method: 'road', duration_minutes: road.duration_minutes,
      distance_km: round(distance), base_fee: base, included_km: included, additional_fee: extra,
      night_fee: night ? nightFee : 0, rain_fee: rain ? rainFee : 0,
      free_delivery: businessSettings?.free_delivery === true,
      delivery_fee: customerFee, currency: 'USD',
      message: 'Cotización calculada sobre vías transitables. Se confirmará nuevamente antes de crear el pedido.',
    })
  } catch (error) {
    const problem = error as { message?: string; code?: string }
    console.error('flashfood-delivery-quote', stage, problem?.code ?? '', problem?.message ?? 'Error')
    const known = problem?.code ? ' [' + problem.code + ']' : ''
    const explanation = problem?.message?.slice(0, 240) ?? 'Error inesperado'
    return reply({ ok: false, error: 'Cotización (' + stage + ')' + known + ': ' + explanation }, 500)
  }
})
