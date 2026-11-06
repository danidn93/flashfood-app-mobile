import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const send = (data: Record<string, unknown>, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (error: string, status = 400) => send({ ok: false, error }, status)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(v)
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100)
const dollars = (value: number) => cents(value) / 100
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000
const num = (v: unknown, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback
const originOK = (lat: unknown, lng: unknown) => typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
const road = async (a: {lat:number;lng:number}, b: {lat:number;lng:number}) => {
  const key = Deno.env.get('OPENROUTESERVICE_API_KEY')
  if (!key) throw new Error('Configura OPENROUTESERVICE_API_KEY')
  const resp = await fetch('https://api.openrouteservice.org/v2/directions/driving-car', {
    method:'POST', headers:{ Authorization:key, 'Content-Type':'application/json' },
    body:JSON.stringify({ coordinates:[[a.lng,a.lat],[b.lng,b.lat]] }), signal:AbortSignal.timeout(12000),
  })
  if (!resp.ok) throw new Error('No existe una ruta vial disponible entre la sucursal y el destino')
  const json = await resp.json()
  const distance = Number(json.routes?.[0]?.summary?.distance)
  const duration = Number(json.routes?.[0]?.summary?.duration)
  if (!Number.isFinite(distance) || distance < 0 || !Number.isFinite(duration)) throw new Error('Ruta vial no disponible')
  return { km:dollars(distance/1000), minutes:Math.ceil(duration/60) }
}
const localTime = () => {
  const p = new Intl.DateTimeFormat('en-GB',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date())
  const [h,m] = p.split(':').map(Number)
  return h*60+m
}
const hm = (v:unknown) => {
  if(typeof v!=='string'|| !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))return null
  const [h,m]=v.split(':').map(Number);return h*60+m
}
const tariffAmount = (v:unknown) => typeof v==='number'&&Number.isFinite(v)&&v>=0?v:0
const errorInfo = (error:unknown) => error instanceof Error?error.message:'Error de operación'

Deno.serve(async req => {
  if(req.method==='OPTIONS')return new Response(null,{headers:cors})
  if(req.method!=='POST')return fail('Método no permitido',405)
  try{
    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!anon||!secret)return fail('Secrets de Supabase incompletos',503)
    const jwt=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'')
    if(!jwt)return fail('Inicia sesión',401)
    const {data:auth,error:authError}=await createClient(url,anon).auth.getUser(jwt)
    if(authError||!auth.user)return fail('Sesión inválida',401)
    const userId=auth.user.id
    const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
    const body=await req.json().catch(()=>({})) as Record<string,unknown>
    const action=String(body.action||'list')
    const {data:roleRows,error:roleError}=await db.from('flashfood_user_roles').select('role').eq('user_id',userId).eq('active',true)
    if(roleError)throw roleError
    const roles=(roleRows||[]).map(r=>r.role)
    const admin=roles.includes('superadmin')
    const driverRole=roles.includes('delivery')
    const {data:driver,error:driverError}=await db.from('flashfood_drivers').select('id,active,verified,availability').eq('auth_user_id',userId).maybeSingle()
    if(driverError)throw driverError

    if(action==='list'){
      const q=admin&&body.scope==='all'
        ? db.from('flashfood_mobile_orders').select('*').order('created_at',{ascending:false}).limit(100)
        : driverRole&&body.scope==='driver'&&driver
        ? db.from('flashfood_mobile_orders').select('*').eq('assigned_driver_id',driver.id).order('created_at',{ascending:false}).limit(100)
        : db.from('flashfood_mobile_orders').select('*').eq('customer_id',userId).order('created_at',{ascending:false}).limit(100)
      const {data,error}=await q
      if(error)throw error
      return send({ok:true,orders:data||[]})
    }

    if(action==='create'){
      if(!uuid(body.idempotency_key)||!uuid(body.branch_id))return fail('Solicitud de pedido inválida')
      const {data:existing,error:existingError}=await db.from('flashfood_mobile_orders')
        .select('id,status,total,payment_status,payment_method,payphone_link').eq('customer_id',userId).eq('idempotency_key',body.idempotency_key).maybeSingle()
      if(existingError)throw existingError
      if(existing)return send({ok:true,order:existing,reused:true})
      const modality=String(body.modalidad||'')
      const method=String(body.payment_method||'')
      if(!['domicilio','retirar','servir'].includes(modality))return fail('Modalidad inválida')
      if(!['tarjeta','transferencia','efectivo','local'].includes(method))return fail('Método de pago inválido')
      if(modality==='domicilio'&&method==='local')return fail('Selecciona pago por tarjeta, transferencia o efectivo')
      if(modality!=='domicilio'&&method!=='local')return fail('El retiro o consumo debe pagarse en el establecimiento')
      const note=typeof body.note==='string'?body.note.trim().slice(0,500):''
      const tip=modality==='domicilio'&&money(body.tip)?dollars(body.tip as number):0
      const submitted=body.items
      if(!Array.isArray(submitted)||submitted.length===0||submitted.length>50)return fail('El carrito no contiene productos válidos')
      const {data:catalog,error:catalogError}=await db.rpc('flashfood_catalogo_restaurantes',{p_app_codigo:'flashfood_mobile'})
      if(catalogError)throw catalogError
      const branch=(Array.isArray(catalog)?catalog:[]).find(x=>x.sucursal_id===body.branch_id)
      if(!branch||!branch.acepta_pedidos||!branch.abierto)return fail('La sucursal está cerrada o no admite pedidos',409)

      const productsIds=[...new Set(submitted.map(x=>x.productoId))]
      if(productsIds.some(x=>!uuid(x)))return fail('Producto inválido')
      const {data:productRows,error:productsError}=await db.from('productos_local')
        .select('id,local_id,nombre,precio,precio_para_llevar,tipo').in('id',productsIds).eq('local_id',branch.local_id).eq('tipo','producto')
      if(productsError)throw productsError
      const products=new Map((productRows||[]).map(x=>[x.id,x]))
      const {data:stockRows,error:stockError}=await db.from('productos_sucursal')
        .select('producto_id').eq('sucursal_id',branch.sucursal_id).eq('disponible',true).in('producto_id',productsIds)
      if(stockError)throw stockError
      const allowed=new Set((stockRows||[]).map(x=>x.producto_id))
      if(productsIds.some(x=>!products.has(x)||!allowed.has(x)))return fail('Hay productos no disponibles en esta sucursal',409)
      const presentationIds=[...new Set(submitted.map(x=>x.presentacionId).filter(Boolean))]
      if(presentationIds.some(x=>!uuid(x)))return fail('Presentación inválida')
      const {data:pRows,error:pError}=presentationIds.length
        ? await db.from('producto_presentaciones').select('id,producto_id,nombre,precio,precio_para_llevar').in('id',presentationIds).eq('activo',true)
        : {data:[],error:null}
      if(pError)throw pError
      const presentations=new Map((pRows||[]).map(x=>[x.id,x]))
      let subtotalCents=0
      const items=[]
      for(const item of submitted){
        if(!Number.isInteger(item.cantidad)||item.cantidad<1||item.cantidad>100)return fail('Cantidad inválida')
        const product=products.get(item.productoId)
        if(!product)return fail('Producto no encontrado')
        const presentation=item.presentacionId?presentations.get(item.presentacionId):null
        if(item.presentacionId&&(!presentation||presentation.producto_id!==product.id))return fail('Presentación no válida para el producto')
        const source=presentation||product
        const raw=modality==='servir'?source.precio:source.precio_para_llevar??source.precio
        const unit=Number(raw)
        if(!Number.isFinite(unit)||unit<0)return fail('Precio inválido')
        const unitCents=cents(unit)
        subtotalCents+=unitCents*item.cantidad
        items.push({product_id:product.id,presentation_id:presentation?.id||null,
          name:product.nombre,presentation_name:presentation?.nombre||null,
          quantity:item.cantidad,unit_price:unitCents/100,line_total:unitCents*item.cantidad/100,
          note:typeof item.observaciones==='string'?item.observaciones.trim().slice(0,500):''})
      }
      if(subtotalCents<=0)return fail('El total de productos debe ser mayor que cero')
      let addressId:null|string=null,addressSnapshot:null|Record<string,unknown>=null,km:null|number=null,minutes:null|number=null,fee=0
      if(modality==='domicilio'){
        if(!uuid(body.address_id))return fail('Selecciona una dirección guardada')
        const {data:address,error:addressError}=await db.from('flashfood_customer_addresses').select('*')
          .eq('id',body.address_id).eq('user_id',userId).maybeSingle()
        if(addressError)throw addressError
        if(!address)return fail('La dirección no pertenece a tu cuenta',403)
        if(!originOK(address.latitude,address.longitude)||!originOK(branch.lat,branch.lng))return fail('Se requieren coordenadas de dirección y sucursal',422)
        const {data:hasDriver,error:availableError}=await db.rpc('flashfood_delivery_disponible')
        if(availableError)throw availableError
        if(!hasDriver)return fail('No hay repartidores disponibles',409)
        const routing=await road({lat:branch.lat,lng:branch.lng},{lat:address.latitude,lng:address.longitude})
        km=routing.km;minutes=routing.minutes
        const {data:setting,error:settingError}=await db.from('flashfood_global_settings')
          .select('value').eq('key','delivery_global_tariff').maybeSingle()
        if(settingError)throw settingError
        if(!setting?.value)return fail('No está configurada la tarifa global del delivery',503)
        const t=setting.value as Record<string,unknown>
        const s=hm(t.night_start),e=hm(t.night_end),clock=localTime()
        const night=s!==null&&e!==null&&s!==e&&(s<e?(clock>=s&&clock<e):(clock>=s||clock<e))
        const extra=Math.max(0,km-tariffAmount(t.included_km))*tariffAmount(t.additional_km_fee)
        const {data:freeRow,error:freeError}=await db.from('flashfood_business_settings')
          .select('free_delivery').eq('business_id',branch.local_id).maybeSingle()
        if(freeError)throw freeError
        fee=freeRow?.free_delivery===true?0:dollars(tariffAmount(t.base_fee)+extra+(night?tariffAmount(t.night_fee):0)+(t.rain_enabled===true?tariffAmount(t.rain_fee):0))
        addressId=address.id
        addressSnapshot={label:address.label,address_line:address.address_line,city:address.city,
          reference:address.reference,latitude:address.latitude,longitude:address.longitude}
      }
      const subtotal=subtotalCents/100
      const service=method==='tarjeta'?dollars((subtotal+fee+tip)*0.15):0
      const total=dollars(subtotal+fee+tip+service)
      const paymentStatus=method==='transferencia'?'awaiting_verification':'pending'
      const status=method==='tarjeta'||method==='transferencia'?'pending_payment':'placed'
      const {data:order,error:orderError}=await db.from('flashfood_mobile_orders').insert({
        customer_id:userId,idempotency_key:body.idempotency_key,branch_id:branch.sucursal_id,business_id:branch.local_id,
        address_id:addressId,address_snapshot:addressSnapshot,modality,status,payment_method:method,
        payment_status:paymentStatus,subtotal,delivery_fee:fee,tip,service_fee:service,total,
        route_km:km,route_duration_minutes:minutes,note,
      }).select('*').single()
      if(orderError){
        if(orderError.code==='23505'){
          const {data:duplicate}=await db.from('flashfood_mobile_orders').select('*')
            .eq('customer_id',userId).eq('idempotency_key',body.idempotency_key).maybeSingle()
          if(duplicate)return send({ok:true,order:duplicate,reused:true})
        }
        throw orderError
      }
      const {error:itemError}=await db.from('flashfood_mobile_order_items').insert(items.map(x=>({...x,order_id:order.id})))
      if(itemError){
        // Never dispatch a partial order.
        await db.from('flashfood_mobile_orders').update({status:'cancelled'}).eq('id',order.id)
        throw itemError
      }
      if(status==='placed'&&modality==='domicilio'){
        const {error:assignError}=await db.rpc('flashfood_mobile_assign_driver',{p_order_id:order.id})
        if(assignError)console.error('dispatch pending',assignError.message)
      }
      return send({ok:true,order,requires_payment:method==='tarjeta',requires_verification:method==='transferencia'})
    }

    if(action==='status'){
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const {data:order,error:readError}=await db.from('flashfood_mobile_orders').select('*').eq('id',body.order_id).maybeSingle()
      if(readError)throw readError
      if(!order)return fail('Pedido no encontrado',404)
      if(order.customer_id!==userId&&!admin&&(!driver||order.assigned_driver_id!==driver.id))return fail('No autorizado',403)
      let position=null
      if(['accepted','picked_up'].includes(order.status)&&order.assigned_driver_id){
        const {data,error:locationError}=await db.from('flashfood_mobile_driver_positions')
          .select('latitude,longitude,accuracy_m,recorded_at').eq('driver_id',order.assigned_driver_id).eq('order_id',order.id).maybeSingle()
        if(locationError)throw locationError
        position=data
      }
      return send({ok:true,order,position})
    }

    if(action==='driver_orders'){
      if(!driverRole||!driver)return fail('No autorizado',403)
      const {data,error}=await db.from('flashfood_mobile_orders').select('*').eq('assigned_driver_id',driver.id)
        .in('status',['assigned','accepted','picked_up']).order('created_at',{ascending:true})
      if(error)throw error
      return send({ok:true,orders:data||[]})
    }

    if(action==='driver_transition'){
      if(!driverRole||!driver?.active||!driver.verified)return fail('Perfil de repartidor sin habilitar',403)
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const next=String(body.status||'')
      if(!['accepted','picked_up','delivered'].includes(next))return fail('Transición inválida')
      const previous=next==='accepted'?'assigned':next==='picked_up'?'accepted':'picked_up'
      const {data:updated,error}=await db.from('flashfood_mobile_orders').update({
        status:next,updated_at:new Date().toISOString(),
      }).eq('id',body.order_id).eq('assigned_driver_id',driver.id).eq('status',previous).select('*').maybeSingle()
      if(error)throw error
      if(!updated)return fail('Pedido no asignado o transición de estado inválida',409)
      if(next==='delivered'){
        await db.from('flashfood_mobile_driver_positions').delete().eq('driver_id',driver.id)
        await db.from('flashfood_drivers').update({availability:'available',updated_at:new Date().toISOString()}).eq('id',driver.id)
      }
      return send({ok:true,order:updated})
    }

    if(action==='driver_location'){
      if(!driverRole||!driver?.active||!driver.verified)return fail('Repartidor no autorizado',403)
      if(!uuid(body.order_id)||!originOK(body.latitude,body.longitude))return fail('Ubicación inválida')
      const {data:order,error:readError}=await db.from('flashfood_mobile_orders').select('id')
        .eq('id',body.order_id).eq('assigned_driver_id',driver.id).in('status',['accepted','picked_up']).maybeSingle()
      if(readError)throw readError
      if(!order)return fail('La ubicación solo puede compartirse durante una entrega aceptada',403)
      const {error}=await db.from('flashfood_mobile_driver_positions').upsert({
        driver_id:driver.id,order_id:order.id,latitude:body.latitude,longitude:body.longitude,
        accuracy_m:money(body.accuracy_m)?body.accuracy_m:null,recorded_at:new Date().toISOString(),
      },{onConflict:'driver_id'})
      if(error)throw error
      return send({ok:true})
    }

    if(action==='dispatch_pending'){
      if(!admin)return fail('Solo Superadmin',403)
      const {data:pending,error}=await db.from('flashfood_mobile_orders').select('id')
        .eq('status','placed').eq('modality','domicilio').order('created_at',{ascending:true}).limit(50)
      if(error)throw error
      let count=0
      for(const order of pending||[]){
        const {data:assigned,error:assignError}=await db.rpc('flashfood_mobile_assign_driver',{p_order_id:order.id})
        if(assignError)throw assignError
        if(assigned)count++
      }
      return send({ok:true,assigned:count})
    }

    if(action==='verify_transfer'){
      if(!admin)return fail('Solo Superadmin puede verificar transferencias',403)
      if(!uuid(body.order_id)||body.approved!==true)return fail('Se requiere aprobación explícita y comprobación bancaria')
      const {data:order,error}=await db.from('flashfood_mobile_orders').update({
        status:'placed',payment_status:'paid',updated_at:new Date().toISOString(),
      }).eq('id',body.order_id).eq('payment_method','transferencia').eq('payment_status','awaiting_verification').eq('status','pending_payment').select('*').maybeSingle()
      if(error)throw error
      if(!order)return fail('Transferencia no pendiente',409)
      if(order.modality==='domicilio')await db.rpc('flashfood_mobile_assign_driver',{p_order_id:order.id})
      return send({ok:true,order})
    }

    if(action==='payment_link'){
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const {data:order,error}=await db.from('flashfood_mobile_orders').select('*')
        .eq('id',body.order_id).eq('customer_id',userId).eq('payment_method','tarjeta').maybeSingle()
      if(error)throw error
      if(!order)return fail('Pedido no encontrado',404)
      if(order.payment_status==='paid')return send({ok:true,paid:true})
      if(order.payphone_link)return send({ok:true,link:order.payphone_link})
      const token=Deno.env.get('PAYPHONE_TOKEN'),storeId=Deno.env.get('PAYPHONE_STORE_ID')
      if(!token||!storeId)return fail('Faltan credenciales PayPhone; configura los secretos primero',503)
      if(Deno.env.get('PAYPHONE_ENABLE_LIVE_CHARGES')!=='true')
        return fail('Cobro con tarjeta bloqueado hasta validar ambiente, impuestos y conciliación PayPhone.',503)
      const tx='F'+String(order.id).replaceAll('-','').slice(0,14)
      const amount=cents(Number(order.total))
      const response=await fetch('https://pay.payphonetodoesposible.com/api/Links',{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({amount,amountWithoutTax:amount,currency:'USD',storeId,
          clientTransactionId:tx,reference:'FlashFood '+String(order.id).slice(0,8),
          oneTime:true,isAmountEditable:false}),signal:AbortSignal.timeout(12000),
      })
      if(!response.ok)throw new Error('PayPhone rechazó la generación del enlace ('+response.status+')')
      const link=await response.json()
      if(typeof link!=='string'||!/^https:\/\//.test(link))throw new Error('Respuesta inesperada de PayPhone')
      const {error:updateError}=await db.from('flashfood_mobile_orders')
        .update({payphone_link:link,payphone_client_tx_id:tx}).eq('id',order.id)
      if(updateError)throw updateError
      return send({ok:true,link})
    }

    return fail('Acción no soportada',404)
  }catch(error){
    console.error('flashfood-mobile-orders',error)
    return fail(errorInfo(error),500)
  }
})
