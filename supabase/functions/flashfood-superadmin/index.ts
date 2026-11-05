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


    const ensureDriverProfile = async (userId: string, fullName: string, phone: string) => {
      const { data: existing, error: readError } = await db.from('flashfood_drivers')
        .select('id').eq('user_id', userId).maybeSingle()
      if (readError) throw readError
      if (existing) return existing.id
      const { data, error } = await db.from('flashfood_drivers').insert({
        user_id: userId, full_name: fullName, phone, active: false, verified: false,
      }).select('id').single()
      if (error) throw error
      return data.id
    }
    const ensureDeliveryRole = async (userId: string) => {
      const { data: old, error: readError } = await db.from('flashfood_user_roles')
        .select('id').eq('user_id', userId).eq('role', 'delivery').maybeSingle()
      if (readError) throw readError
      const result = old
        ? await db.from('flashfood_user_roles').update({ active: true }).eq('id', old.id)
        : await db.from('flashfood_user_roles').insert({ user_id: userId, role: 'delivery', active: true })
      if (result.error) throw result.error
    }

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


    // Push campaigns are visible and mutable only via this superadmin-authenticated function.
    if (action === 'notifications') {
      const [campaigns, deviceCount] = await Promise.all([
        db.from('flashfood_push_campaigns').select('id,title,message,audience,status,created_at,sent_at,sent_count,failed_count,error_message').order('created_at', { ascending: false }).range((page - 1) * pageSize, page * pageSize - 1),
        db.from('flashfood_push_devices').select('id', { count: 'exact', head: true }).eq('active', true),
      ])
      if (campaigns.error) throw campaigns.error
      if (deviceCount.error) throw deviceCount.error
      return json({ ok: true, rows: campaigns.data || [], devices: deviceCount.count ?? 0 })
    }

    if (action === 'notification_create') {
      const title = asString(body.title, 101)
      const message = asString(body.message, 501)
      const audience = asString(body.audience, 16)
      if (title.length < 3 || title.length > 100 || message.length < 3 || message.length > 500)
        return fail('El título debe tener 3–100 caracteres y el mensaje 3–500 caracteres')
      if (!['all', 'customer', 'merchant', 'driver'].includes(audience)) return fail('Destinatarios inválidos')
      const { data, error } = await db.from('flashfood_push_campaigns').insert({
        title, message, audience, status: 'draft', created_by: identity.user.id,
      }).select('id,title,message,audience,status,created_at').single()
      if (error) throw error
      return json({ ok: true, row: data })
    }

    if (action === 'notification_send') {
      if (!uuid(id)) return fail('Campaña inválida')
      const { data: campaign, error: campaignError } = await db.from('flashfood_push_campaigns')
        .select('id,title,message,audience,status').eq('id', id).maybeSingle()
      if (campaignError) throw campaignError
      if (!campaign) return fail('Campaña no encontrada', 404)
      if (campaign.status !== 'draft') return fail('Esta campaña ya fue procesada', 409)

      // Filter recipients on the SERVER. Frontend-selected audiences are never trusted.
      const selectedRoles: string[] = campaign.audience === 'driver' ? ['delivery']
        : campaign.audience === 'merchant' ? ['admin', 'empleado']
        : []
      let allowedUsers: Set<string> | null = null
      if (selectedRoles.length) {
        const { data: roleRows, error: roleError2 } = await db.from('flashfood_user_roles')
          .select('user_id').in('role', selectedRoles).eq('active', true).limit(10000)
        if (roleError2) throw roleError2
        allowedUsers = new Set((roleRows || []).map(r => r.user_id))
      }

      // Never silently truncate a broadcast. A scheduled worker is needed above this cap.
      const { data: allDevices, error: devicesError } = await db.from('flashfood_push_devices')
        .select('id,user_id,token,platform').eq('active', true).limit(1001)
      if (devicesError) throw devicesError
      if ((allDevices || []).length > 1000) return fail('Hay más de 1.000 dispositivos. Configura el despachador por lotes antes del envío masivo.', 409)
      const devices = (allDevices || []).filter(device => {
        if (campaign.audience === 'all') return true
        if (campaign.audience === 'customer') return !!device.user_id
          && (!allowedUsers || !allowedUsers.has(device.user_id))
        return !!device.user_id && allowedUsers?.has(device.user_id)
      })
      // Customers exclude privileged roles, not only merchant/driver roles.
      if (campaign.audience === 'customer') {
        const { data: privileged, error: privilegedError } = await db.from('flashfood_user_roles')
          .select('user_id').in('role', ['superadmin', 'admin', 'empleado', 'delivery']).eq('active', true).limit(10000)
        if (privilegedError) throw privilegedError
        const privilegedIds = new Set((privileged || []).map(r => r.user_id))
        for (let i = devices.length - 1; i >= 0; i--) if (privilegedIds.has(devices[i].user_id)) devices.splice(i, 1)
      }
      if (!devices.length) return fail('No existen dispositivos activos para el grupo seleccionado.', 409)
      // This synchronous action is suitable for small/medium campaigns only.
      if (devices.length > 100) return fail('La campaña supera 100 dispositivos; se requiere envío por lotes para evitar vencimientos.', 409)

      const androidDevices = devices.filter(d => d.platform === 'android')
      const iosDevices = devices.filter(d => d.platform === 'ios')
      const serviceAccountText = Deno.env.get('FLASHFOOD_FIREBASE_SERVICE_ACCOUNT')
      const appleKeyText = Deno.env.get('FLASHFOOD_APNS_PRIVATE_KEY')
      if (androidDevices.length && !serviceAccountText)
        return fail('Configura FLASHFOOD_FIREBASE_SERVICE_ACCOUNT en los secretos de Supabase.', 503)
      if (iosDevices.length && (!appleKeyText || !Deno.env.get('FLASHFOOD_APNS_TEAM_ID') || !Deno.env.get('FLASHFOOD_APNS_KEY_ID')))
        return fail('Configura la clave APNs, Team ID y Key ID en los secretos de Supabase.', 503)

      // Atomic claim prevents parallel clicks from dispatching the same campaign twice.
      const { data: claimed, error: claimError } = await db.from('flashfood_push_campaigns')
        .update({ status: 'sending' }).eq('id', campaign.id).eq('status', 'draft').select('id').maybeSingle()
      if (claimError) throw claimError
      if (!claimed) return fail('Esta campaña ya está siendo enviada', 409)

      let accepted = 0
      let rejected = 0
      let lastError = ''
      try {
        const title = campaign.title as string
        const message = campaign.message as string
        const b64url = (value: Uint8Array) => btoa(String.fromCharCode(...value))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
        const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)))
        const pkcs8 = (pem: string) => Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '')), c => c.charCodeAt(0))
        let googleAccessToken = ''
        let googleProjectId = ''
        if (androidDevices.length && serviceAccountText) {
          const account = JSON.parse(serviceAccountText) as Record<string, string>
          if (!account.client_email || !account.private_key || !account.project_id) throw new Error('Cuenta de servicio Firebase incompleta')
          googleProjectId = account.project_id
          const key = await crypto.subtle.importKey('pkcs8', pkcs8(account.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
          const now = Math.floor(Date.now() / 1000)
          const jwtInput = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
            iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging',
            aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
          })
          const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(jwtInput))
          const assertion = jwtInput + '.' + b64url(new Uint8Array(signature))
          const oauth = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
          })
          const oauthBody = await oauth.json()
          if (!oauth.ok || !oauthBody.access_token) throw new Error('No se pudo autorizar Firebase HTTP v1')
          googleAccessToken = oauthBody.access_token
        }
        let apnsJwt = ''
        const bundleId = Deno.env.get('FLASHFOOD_APNS_BUNDLE_ID') || 'com.flashfood.mobile'
        if (iosDevices.length && appleKeyText) {
          const key = await crypto.subtle.importKey('pkcs8', pkcs8(appleKeyText.replace(/\\n/g, '\n')),
            { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
          const now = Math.floor(Date.now() / 1000)
          const jwtInput = encode({ alg: 'ES256', kid: Deno.env.get('FLASHFOOD_APNS_KEY_ID') })
            + '.' + encode({ iss: Deno.env.get('FLASHFOOD_APNS_TEAM_ID'), iat: now })
          const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(jwtInput))
          apnsJwt = jwtInput + '.' + b64url(new Uint8Array(signature))
        }
        const apnsHost = Deno.env.get('FLASHFOOD_APNS_ENVIRONMENT') === 'production'
          ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com'
        for (const device of devices) {
          try {
            let response: Response
            if (device.platform === 'android') {
              response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(googleProjectId)}/messages:send`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${googleAccessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: { token: device.token, notification: { title, body: message },
                  data: { type: 'campaign', campaign_id: String(campaign.id) } } }),
              })
            } else {
              response = await fetch(`${apnsHost}/3/device/${encodeURIComponent(device.token)}`, {
                method: 'POST',
                headers: { authorization: `bearer ${apnsJwt}`, 'apns-topic': bundleId, 'apns-push-type': 'alert', 'apns-priority': '10', 'content-type': 'application/json' },
                body: JSON.stringify({ aps: { alert: { title, body: message }, sound: 'default' }, campaign_id: campaign.id }),
              })
            }
            if (response.ok) accepted++
            else {
              rejected++
              const content = await response.text()
              lastError = `Error proveedor HTTP ${response.status}: ${content.slice(0, 180)}`
              if (response.status === 404 || response.status === 410) await db.from('flashfood_push_devices').update({ active: false }).eq('id', device.id)
            }
          } catch (sendError) {
            rejected++
            lastError = sendError instanceof Error ? sendError.message : 'Error de red'
          }
        }
        const status = rejected ? (accepted ? 'partial' : 'failed') : 'sent'
        const { error: saveError } = await db.from('flashfood_push_campaigns').update({
          status, sent_at: new Date().toISOString(), sent_count: accepted, failed_count: rejected,
          error_message: lastError || null,
        }).eq('id', campaign.id)
        if (saveError) throw saveError
        return json({ ok: true, sent: accepted, failed: rejected, status })
      } catch (dispatchError) {
        const message2 = dispatchError instanceof Error ? dispatchError.message : 'No se pudo despachar'
        await db.from('flashfood_push_campaigns').update({
          status: 'failed', sent_at: new Date().toISOString(), sent_count: accepted,
          failed_count: rejected, error_message: message2.slice(0, 500),
        }).eq('id', campaign.id)
        throw dispatchError
      }
    }

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

    if (action === 'driver_register') {
      const email = asString(body.email, 254).toLowerCase()
      const name = asString(body.full_name, 150)
      const phone = asString(body.phone, 30)
      const invite = body.invite === true
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || name.length < 3)
        return fail('Ingresa un nombre completo y un correo válido')
      let targetId = ''
      let invited = false
      for (let page = 1; page <= 100; page++) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 })
        if (error) throw error
        const found = data.users.find(u => u.email?.toLowerCase() === email)
        if (found) { targetId = found.id; break }
        if (data.users.length < 1000) break
      }
      if (!targetId) {
        if (!invite) return fail('No existe esa cuenta. Activa la opción Invitar si no existe.', 404)
        const appUrl = Deno.env.get('FLASHFOOD_APP_URL')?.trim().replace(/\\/$/, '')
        if (!appUrl || !appUrl.startsWith('https://')) return fail('Configura FLASHFOOD_APP_URL.', 503)
        const { data, error } = await db.auth.admin.inviteUserByEmail(email, {
          data: { full_name: name }, redirectTo: appUrl + '/establecer-contrasena',
        })
        if (error) throw error
        if (!data.user) return fail('No se pudo enviar la invitación', 500)
        targetId = data.user.id
        invited = true
      }
      const driverId = await ensureDriverProfile(targetId, name, phone)
      await ensureDeliveryRole(targetId)
      return json({ ok: true, driver_id: driverId, user_id: targetId, invited })
    }

    if (action === 'create_user') {
      const name=asString(body.name,150)
      const email=asString(body.email,254).toLowerCase()
      const role=asString(body.role,30)
      const businessId=body.business_id
      if(name.length<3)return fail('Ingresa el nombre completo del usuario')
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return fail('Correo inválido')
      if(!['cliente','superadmin','admin','empleado','delivery'].includes(role))return fail('Rol inválido')
      if((role==='admin'||role==='empleado')&&!uuid(businessId))return fail('Selecciona el negocio al que tendrá acceso')
      if(role==='admin'||role==='empleado'){
        const {data:business,error:businessError}=await db.from('locales').select('id').eq('id',businessId).maybeSingle()
        if(businessError)throw businessError
        if(!business)return fail('Negocio no encontrado',404)
      }
      // No duplicar cuentas ya existentes. Para ellas, utilizar Asignar rol por correo.
      for(let p=1;p<=100;p++){
        const {data:list,error:listError}=await db.auth.admin.listUsers({page:p,perPage:1000})
        if(listError)throw listError
        if(list.users.some(u=>u.email?.toLowerCase()===email))return fail('Ya existe una cuenta con ese correo. Utiliza Asignar rol por correo.',409)
        if(list.users.length<1000)break
      }
      const configuredAppUrl=Deno.env.get('FLASHFOOD_APP_URL')?.trim()
      const appUrl=configuredAppUrl?.endsWith('/')?configuredAppUrl.slice(0,-1):configuredAppUrl
      if(!appUrl || !/^https:\/\//.test(appUrl))return fail('Configura FLASHFOOD_APP_URL con el dominio HTTPS público de FlashFood.',503)
      const {data:invitation,error:inviteError}=await db.auth.admin.inviteUserByEmail(email,{data:{full_name:name},redirectTo:appUrl+'/establecer-contrasena'})
      if(inviteError)throw inviteError
      const userId=invitation.user?.id
      if(!userId)return fail('No se pudo crear la invitación',500)
      try {
        if(role!=='cliente'){
          const {error:roleError}=await db.from('flashfood_user_roles').insert({user_id:userId,role,active:true})
          if(roleError)throw roleError
        }
        if(role==='delivery') await ensureDriverProfile(userId, name, '')
        if(role==='admin'||role==='empleado'){
          const {error:accessError}=await db.from('flashfood_business_access').insert({
            user_id:userId,business_id:businessId,branch_id:null,role,active:true
          })
          if(accessError)throw accessError
        }
      }catch(assignError){
        console.error('Cuenta invitada pero asignación pendiente',userId,assignError)
        return json({ok:false,error:'La invitación se creó, pero no se pudo asignar el rol. Revisa la tabla de permisos y asigna el rol desde Superadmin → Roles.',user_id:userId,partial:true},500)
      }
      return json({ok:true,user_id:userId,email,role,invited:true})
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
      if (role === 'delivery' && active) {
        const { data: u, error: e } = await db.auth.admin.getUserById(userId)
        if (e) throw e
        await ensureDriverProfile(userId, String(u.user.user_metadata?.full_name || u.user.email || 'Repartidor'), String(u.user.phone || ''))
      }
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
      if (role === 'delivery' && active) {
        const { data: u, error: e } = await db.auth.admin.getUserById(userId as string)
        if (e) throw e
        await ensureDriverProfile(userId as string, String(u.user.user_metadata?.full_name || u.user.email || 'Repartidor'), String(u.user.phone || ''))
      }
      return json({ ok: true, row: result.data })
    }
    return fail('Acción no soportada')
  } catch (e) {
    console.error('flashfood-superadmin', e)
    return fail(e instanceof Error ? e.message : 'Error administrativo', 500)
  }
})
