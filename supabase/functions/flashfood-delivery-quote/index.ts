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
const kmBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const radians = (d: number) => d * Math.PI / 180
  const dLat = radians(bLat - aLat)
  const dLng = radians(bLng - aLng)
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(aLat)) * Math.cos(radians(bLat)) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
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
    const { data: address, error: addressError } = await db.from('flashfood_customer_addresses')
      .select('id,latitude,longitude').eq('id', input.address_id).eq('user_id', userData.user.id).maybeSingle()
    if (addressError) throw addressError
    if (!address) return reply({ ok: false, error: 'Dirección no encontrada' }, 404)
    if (!coord(address.latitude, 90) || !coord(address.longitude, 180))
      return reply({ ok: false, error: 'Agrega coordenadas GPS a tu dirección para calcular el envío' }, 422)

    const { data: catalog, error: catalogError } = await db.rpc('flashfood_catalogo_restaurantes', { p_app_codigo: 'flashfood_mobile' })
    if (catalogError) throw catalogError
    const branch = (Array.isArray(catalog) ? catalog : []).find(r => r.sucursal_id === input.branch_id)
    if (!branch) return reply({ ok: false, error: 'La sucursal no está disponible en FlashFood' }, 404)
    const bLat = Number(branch.lat), bLng = Number(branch.lng)
    if (branch.lat === null || branch.lng === null || !coord(bLat, 90) || !coord(bLng, 180))
      return reply({ ok: false, error: 'La sucursal aún no tiene coordenadas configuradas' }, 422)

    const { data: available, error: availabilityError } = await db.rpc('flashfood_delivery_disponible')
    if (availabilityError) throw availabilityError
    if (available !== true) return reply({ ok: false, error: 'No hay repartidores disponibles en este momento' }, 409)

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

    const distance = kmBetween(bLat, bLng, address.latitude, address.longitude)
    // Straight-line distance is only an estimate: road routing is not yet connected.
    const night = isNight(config.night_start, config.night_end)
    const rain = config.rain_enabled === true
    const extra = round(Math.max(0, distance - included!) * perKm!)
    const { data: businessSettings, error: businessError } = await db.from('flashfood_business_settings')
      .select('free_delivery').eq('business_id', branch.local_id).maybeSingle()
    if (businessError) throw businessError
    const customerFee = businessSettings?.free_delivery === true ? 0 : round(base! + extra + (night ? nightFee! : 0) + (rain ? rainFee! : 0))
    return reply({
      ok: true, estimated: true, distance_method: 'straight_line',
      distance_km: round(distance), base_fee: base, included_km: included, additional_fee: extra,
      night_fee: night ? nightFee : 0, rain_fee: rain ? rainFee : 0,
      free_delivery: businessSettings?.free_delivery === true,
      delivery_fee: customerFee, currency: 'USD',
      message: 'Estimación basada en distancia geográfica, no recorrido vial. El precio definitivo se validará en el checkout.',
    })
  } catch (error) {
    console.error('flashfood-delivery-quote', error)
    return reply({ ok: false, error: 'No se pudo cotizar el envío. Revisa la configuración y vuelve a intentar.' }, 500)
  }
})
