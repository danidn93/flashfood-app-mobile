import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const uuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const fail = (msg: string, status = 400) => json({ ok: false, error: msg }, status)
const asString = (v: unknown, max = 250) => typeof v === 'string' ? v.trim().slice(0, max) : ''

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return fail('Método no permitido', 405)
  try {
    const url = Deno.env.get('SUPABASE_URL')
    const anon = Deno.env.get('SUPABASE_ANON_KEY')
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !anon || !service) return fail('Configuración incompleta', 500)
    const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
    if (!token) return fail('Sesión requerida', 401)
    const { data: identity, error: authError } = await createClient(url, anon).auth.getUser(token)
    if (authError || !identity.user) return fail('Sesión inválida', 401)
    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: roles, error: roleError } = await db.from('flashfood_user_roles').select('id').eq('user_id', identity.user.id).eq('role', 'superadmin').eq('active', true).limit(1)
    if (roleError) throw roleError
    if (!roles?.length) return fail('No autorizado', 403)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const action = asString(body.action, 60)
    const id = body.id
    const page = Math.max(1, Math.min(10000, Number(body.page) || 1))
    const pageSize = 100
    const paged = (table: string, cols = '*') => db.from(table).select(cols).range((page - 1) * pageSize, page * pageSize - 1)
    const checked = (result: { data: unknown; error: { message: string } | null }) => {
      if (result.error) throw new Error(result.error.message)
      return result.data
    }
    const catalog = async () => checked(await db.rpc('flashfood_catalogo_restaurantes', { p_app_codigo: 'flashfood_mobile' })) as Record<string, unknown>[] || []

    if (action === 'ping') return json({ ok: true, user_id: identity.user.id })
    if (action === 'dashboard') {
      const [locals, branches, orders, drivers, roleRows, paid] = await Promise.all([
        db.from('locales').select('id', { count: 'exact', head: true }),
        db.from('sucursales').select('id', { count: 'exact', head: true }),
        db.from('flashfood_orders').select('id', { count: 'exact', head: true }),
        db.from('flashfood_drivers').select('id', { count: 'exact', head: true }),
        db.from('flashfood_user_roles').select('id', { count: 'exact', head: true }).eq('active', true),
        db.from('flashfood_orders').select('grand_total').eq('payment_status', 'paid').limit(10000),
      ])
      for (const result of [locals, branches, orders, drivers, roleRows, paid]) if (result.error) throw result.error
      const visible = await catalog()
      return json({ ok: true, dashboard: {
        restaurants: locals.count ?? 0, branches: branches.count ?? 0,
        published_restaurants: new Set(visible.map(r => r.local_id)).size,
        published_branches: new Set(visible.map(r => r.sucursal_id)).size,
        orders: orders.count ?? 0, drivers: drivers.count ?? 0, users: roleRows.count ?? 0,
        gross_sales: (paid.data || []).reduce((sum, r) => sum + Number(r.grand_total || 0), 0),
      } })
    }
    if (action === 'restaurants') return json({ ok: true, rows: checked(await paged('locales')) })
    if (action === 'branches') return json({ ok: true, rows: checked(await paged('sucursales')) })
    if (action === 'catalog') return json({ ok: true, rows: await catalog() })
    if (action === 'orders') return json({ ok: true, rows: checked(await paged('flashfood_orders')) })
    if (action === 'drivers') return json({ ok: true, rows: checked(await paged('flashfood_drivers')) })
    if (action === 'settings') {
      const [settings, tariffs, zones] = await Promise.all([
        db.from('flashfood_global_settings').select('*').order('key'),
        db.from('flashfood_delivery_tariffs').select('*').order('created_at'),
        db.from('flashfood_delivery_zones').select('id,name,city'),
      ])
      for (const result of [settings, tariffs, zones]) if (result.error) throw result.error
      const names = new Map((zones.data || []).map(z => [z.id, `${z.name} · ${z.city}`]))
      return json({ ok: true, rows: settings.data, zones: zones.data || [], tariffs: (tariffs.data || []).map(t => ({ ...t, zone_name: names.get(t.zone_id) || '' })) })
    }
    if (action === 'create_delivery_zone') {
      const name = asString(body.name, 100)
      const city = asString(body.city, 100)
      if (!name || !city) return fail('Nombre y ciudad son obligatorios')
      const { data, error } = await db.from('flashfood_delivery_zones').insert({ name, city }).select().single()
      if (error) throw error
      return json({ ok: true, row: data })
    }
    if (action === 'create_delivery_tariff') {
      if (!uuid(body.zone_id)) return fail('Zona inválida')
      const { data: zone, error: zoneError } = await db.from('flashfood_delivery_zones').select('id').eq('id', body.zone_id).maybeSingle()
      if (zoneError) throw zoneError
      if (!zone) return fail('Zona no encontrada', 404)
      const { data, error } = await db.from('flashfood_delivery_tariffs').insert({ zone_id: body.zone_id, base_fee: 0, included_km: 0, additional_km_fee: 0, night_fee: 0, night_start: null, night_end: null, rain_fee: 0, rain_enabled: false, active: false }).select().single()
      if (error) throw error
      return json({ ok: true, row: data })
    }
    if (action === 'save_card_surcharge') {
      const percent = body.percent
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 25) return fail('Porcentaje inválido (0–25)')
      const { data, error } = await db.from('flashfood_global_settings').upsert({ key: 'card_surcharge_percent', value: percent, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select().single()
      if (error) throw error
      return json({ ok: true, row: data })
    }
    if (action === 'save_delivery_tariff') {
      const t = body.tariff
      if (!t || typeof t !== 'object' || Array.isArray(t)) return fail('Tarifa inválida')
      const tariff = t as Record<string, unknown>
      if (!uuid(tariff.id)) return fail('ID de tarifa inválido')
      const fields = ['base_fee','included_km','additional_km_fee','night_fee','rain_fee']
      const payload: Record<string, unknown> = {}
      for (const field of fields) {
        const n = tariff[field]
        if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 100000) return fail(`Importe inválido: ${field}`)
        payload[field] = n
      }
      for (const field of ['night_start','night_end']) {
        const value = tariff[field]
        if (value !== null && (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(value))) return fail(`Horario inválido: ${field}`)
        payload[field] = value
      }
      if (typeof tariff.rain_enabled !== 'boolean' || typeof tariff.active !== 'boolean') return fail('Estados inválidos')
      payload.rain_enabled = tariff.rain_enabled
      payload.active = tariff.active
      payload.updated_at = new Date().toISOString()
      const { data, error } = await db.from('flashfood_delivery_tariffs').update(payload).eq('id', tariff.id).select().maybeSingle()
      if (error) throw error
      if (!data) return fail('Tarifa no encontrada', 404)
      return json({ ok: true, row: data })
    }
    if (action === 'availability') return json({ ok: true, rows: checked(await paged('flashfood_branch_availability')) })
    if (action === 'users') {
      const { data: list, error } = await db.auth.admin.listUsers({ page, perPage: pageSize })
      if (error) throw error
      const users = list.users.map(u => ({ id: u.id, email: u.email, name: u.user_metadata?.full_name || u.user_metadata?.name || '', phone: u.phone || '', created_at: u.created_at, banned_until: u.banned_until || null }))
      const userIds = users.map(u => u.id)
      const roleList = userIds.length ? checked(await db.from('flashfood_user_roles').select('id,user_id,role,active,created_at').in('user_id', userIds)) : []
      return json({ ok: true, rows: users, roles: roleList })
    }
    if (action === 'roles') return json({ ok: true, rows: checked(await paged('flashfood_user_roles')) })

    // Explicitly allowlisted updates. Never accept arbitrary table names or columns from the browser.
    const editable: Record<string, { table: string; fields: Record<string, 'text' | 'bool' | 'number' | 'json'> }> = {
      restaurant: { table: 'locales', fields: { nombre: 'text', nombre_comercial: 'text', activo: 'bool' } },
      branch: { table: 'sucursales', fields: { nombre: 'text', direccion: 'text', telefono: 'text', activo: 'bool' } },
      driver: { table: 'flashfood_drivers', fields: { full_name: 'text', phone: 'text', active: 'bool', verified: 'bool', availability: 'text' } },
      availability: { table: 'flashfood_branch_availability', fields: { marketplace_enabled: 'bool', accepting_orders: 'bool' } },
      setting: { table: 'flashfood_global_settings', fields: { value: 'json' } },
    }
    if (action === 'update') {
      const entity = asString(body.entity, 30)
      const def = editable[entity]
      if (!def || !uuid(id) || !body.changes || typeof body.changes !== 'object' || Array.isArray(body.changes)) return fail('Datos de edición inválidos')
      const changes = body.changes as Record<string, unknown>
      const payload: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(changes)) {
        const kind = def.fields[key]
        if (!kind) return fail(`Campo no autorizado: ${key}`)
        if (kind === 'bool' && typeof value !== 'boolean') return fail(`Valor inválido: ${key}`)
        if (kind === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) return fail(`Valor inválido: ${key}`)
        if (kind === 'text' && (typeof value !== 'string' || value.length > 500)) return fail(`Valor inválido: ${key}`)
        payload[key] = value
      }
      if (!Object.keys(payload).length) return fail('No hay cambios')
      const { data, error } = await db.from(def.table).update(payload).eq('id', id).select('*').maybeSingle()
      if (error) throw error
      if (!data) return fail('Registro no encontrado', 404)
      return json({ ok: true, row: data })
    }
    if (action === 'update_user') {
      if (!uuid(id) || !body.changes || typeof body.changes !== 'object') return fail('Usuario inválido')
      const changes = body.changes as Record<string, unknown>
      if (Object.keys(changes).some(k => !['name', 'phone', 'ban'].includes(k))) return fail('Campo de usuario no autorizado')
      if (id === identity.user.id && changes.ban === true) return fail('No puedes suspender tu propia cuenta')
      const attrs: Record<string, unknown> = {}
      if ('name' in changes) attrs.user_metadata = { full_name: asString(changes.name, 150) }
      if ('phone' in changes) attrs.phone = asString(changes.phone, 30)
      if ('ban' in changes) {
        if (typeof changes.ban !== 'boolean') return fail('Suspensión inválida')
        attrs.ban_duration = changes.ban ? '876000h' : 'none'
      }
      const { data, error } = await db.auth.admin.updateUserById(id as string, attrs)
      if (error) throw error
      return json({ ok: true, user_id: data.user.id })
    }
    if (action === 'set_role_by_email') {
      const email=asString(body.email,255).toLowerCase()
      const role=asString(body.role,60)
      const active=body.active
      if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || !['superadmin','admin','empleado','delivery'].includes(role) || typeof active!=='boolean') return fail('Correo, rol o estado inválidos')
      let userId:string|null=null
      for(let p=1;p<=100;p++){
        const {data:users,error:e}=await db.auth.admin.listUsers({page:p,perPage:1000})
        if(e)throw e
        const match=users.users.find(u=>u.email?.toLowerCase()===email)
        if(match){userId=match.id;break}
        if(users.users.length<1000)break
      }
      if(!userId){
        if(body.invite!==true)return fail('El usuario no existe. Activa la opción de enviar invitación.',404)
        const {data:invitation,error:e}=await db.auth.admin.inviteUserByEmail(email)
        if(e)throw e
        if(!invitation.user)return fail('No se pudo invitar al usuario')
        userId=invitation.user.id
      }
      if(userId===identity.user.id&&role==='superadmin'&&!active)return fail('No puedes revocar tu propio acceso')
      const {data:existing,error:readError}=await db.from('flashfood_user_roles').select('id').eq('user_id',userId).eq('role',role).maybeSingle()
      if(readError)throw readError
      const result=existing?await db.from('flashfood_user_roles').update({active}).eq('id',existing.id).select().single():await db.from('flashfood_user_roles').insert({user_id:userId,role,active}).select().single()
      if(result.error)throw result.error
      return json({ok:true,user_id:userId,role,active})
    }
    if (action === 'set_role') {
      const userId = body.user_id
      const role = asString(body.role, 60)
      const active = body.active
      if (!uuid(userId) || !/^[a-z][a-z0-9_]{1,59}$/.test(role) || typeof active !== 'boolean') return fail('Rol inválido')
      if (userId === identity.user.id && role === 'superadmin' && !active) return fail('No puedes quitarte tu propio rol Superadmin')
      const { data: existing, error: readError } = await db.from('flashfood_user_roles').select('id').eq('user_id', userId).eq('role', role).maybeSingle()
      if (readError) throw readError
      const result = existing
        ? await db.from('flashfood_user_roles').update({ active }).eq('id', existing.id).select().single()
        : await db.from('flashfood_user_roles').insert({ user_id: userId, role, active }).select().single()
      if (result.error) throw result.error
      return json({ ok: true, row: result.data })
    }
    return fail('Acción no soportada')
  } catch (e) {
    console.error('flashfood-superadmin', e)
    return fail(e instanceof Error ? e.message : 'Error administrativo', 500)
  }
})
