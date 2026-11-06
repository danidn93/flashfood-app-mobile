import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { syncFlashFoodOrderToErp } from '../_shared/flashfoodErpBridge.ts'
import { notifyFlashFoodMerchant, pushToDevices } from '../_shared/flashfoodMerchantNotify.ts'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const send = (data: Record<string, unknown>, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const fail = (error: string, status = 400) => send({ ok: false, error }, status)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(v)
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100)
const dollars = (value: number) => cents(value) / 100
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 100000
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
type ExistingOrder = Record<string,unknown> & {payment_method?:string;status?:string;payment_review_status?:string;payment_status?:string;mobile_modality?:string;fulfillment?:string;delivery_address?:unknown;driver_id?:string;mobile_branch_id?:string;mobile_local_id?:string;products_total?:number;platform_surcharge?:number;grand_total?:number;customer_note?:string}
const toMobile=(o:ExistingOrder)=>{
 const pm=o.payment_method==='payphone'?'tarjeta':o.payment_method==='cash'?'efectivo':
  o.payment_method==='transfer'?'transferencia':'local'
 const status=o.status==='in_transit'?'picked_up':o.status==='pending'
  ? ((pm==='tarjeta'||pm==='transferencia')&&o.payment_status!=='paid'?'pending_payment':'placed') : o.status
 return {...o,status,payment_method:pm,
  payment_status:o.payment_review_status==='awaiting_verification'?'awaiting_verification':o.payment_status,
  modality:o.mobile_modality|| (o.fulfillment==='delivery'?'domicilio':'retirar'),
  branch_id:o.mobile_branch_id,business_id:o.mobile_local_id,
  address_snapshot:o.delivery_address,assigned_driver_id:o.driver_id,
  subtotal:o.products_total,service_fee:o.platform_surcharge,
  total:o.grand_total,note:o.customer_note}
}

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

    if(action==='capabilities'){
      const cards=Boolean(Deno.env.get('PAYPHONE_TOKEN')&&Deno.env.get('PAYPHONE_STORE_ID')&&
        Deno.env.get('PAYPHONE_RESPONSE_URL')&&Deno.env.get('PAYPHONE_ENABLE_LIVE_CHARGES')==='true')
      return send({ok:true,payphone_enabled:cards})
    }

    if(action==='list'){
      const q=admin&&body.scope==='all'
        ? db.from('flashfood_orders').select('*').order('created_at',{ascending:false}).limit(100)
        : driverRole&&body.scope==='driver'&&driver
        ? db.from('flashfood_orders').select('*').eq('driver_id',driver.id).order('created_at',{ascending:false}).limit(100)
        : db.from('flashfood_orders').select('*').eq('customer_id',userId).order('created_at',{ascending:false}).limit(100)
      const {data,error}=await q
      if(error)throw error
      return send({ok:true,orders:(data||[]).filter(x=>x.mobile_branch_id).map(toMobile)})
    }

    if(action==='chat_list'||action==='chat_send'){
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const {data:order,error:orderErr}=await db.from('flashfood_orders')
       .select('id,customer_id,driver_id,status,fulfillment,mobile_local_id,mobile_branch_id').eq('id',body.order_id).maybeSingle()
      if(orderErr)throw orderErr
      if(!order)return fail('Pedido inexistente',404)
      const isCustomer=order.customer_id===userId
      const isRider=driverRole&&!!driver&&order.driver_id===driver.id&&order.fulfillment==='delivery'
      if(!isCustomer&&!isRider)return fail('No tienes permiso para consultar este chat',403)
      const {data:progress,error:progressErr}=await db.from('flashfood_order_progress')
       .select('stage').eq('order_id',order.id).maybeSingle()
      if(progressErr)throw progressErr
      if(action==='chat_list'){
        const {data,error}=await db.from('flashfood_order_chat')
         .select('id,sender_role,sender_name,message,created_at').eq('order_id',order.id)
         .order('created_at',{ascending:true}).limit(200)
        if(error)throw error
        return send({ok:true,messages:data||[],stage:progress?.stage||'recibido',can_send:!['entregado','cancelado'].includes(progress?.stage||'')})
      }
      if(!progress||['entregado','cancelado'].includes(progress.stage))return fail('El chat está cerrado',409)
      if(isRider&& !['retirando','reparto'].includes(progress.stage))return fail('El repartidor todavía no tiene asignada la conversación',403)
      if(isCustomer&&order.status==='cancelled')return fail('Pedido cancelado',409)
      const message=typeof body.message==='string'?body.message.trim():''
      if(!message||message.length>1500)return fail('El mensaje debe tener entre 1 y 1500 caracteres',400)
      const {data:inserted,error:insertErr}=await db.from('flashfood_order_chat').insert({
       order_id:order.id,sender_id:userId,sender_role:isCustomer?'cliente':'delivery',
       sender_name:isCustomer?'Cliente':'Repartidor',message,
      }).select('id,sender_role,sender_name,message,created_at').single()
      if(insertErr)throw insertErr
      try{
       const recipientIds:string[]=[]
       if(isRider)recipientIds.push(order.customer_id)
       else if(['retirando','reparto'].includes(progress.stage)&&order.driver_id){
         const {data:assigned}=await db.from('flashfood_drivers').select('auth_user_id').eq('id',order.driver_id).maybeSingle()
         if(assigned?.auth_user_id)recipientIds.push(assigned.auth_user_id)
       }else if(order.mobile_local_id){
         const {data:grants}=await db.from('flashfood_business_access')
          .select('user_id,branch_id').eq('business_id',order.mobile_local_id).eq('active',true)
         recipientIds.push(...(grants||[]).filter(g=>!g.branch_id||g.branch_id===order.mobile_branch_id).map(g=>g.user_id))
       }
       if(recipientIds.length)await pushToDevices(db,[...new Set(recipientIds)],order.id,
         'Nuevo mensaje en FlashFood','Tienes un mensaje sobre tu pedido.','order_chat')
      }catch(err){console.error('Chat guardado; notificación pendiente:',errorInfo(err))}
      return send({ok:true,message:inserted})
    }

    if(action==='offer_list'){
      if(!driverRole||!driver||!driver.active||!driver.verified)return fail('Perfil no autorizado',403)
      const {data,error}=await db.from('flashfood_delivery_offers')
       .select('id,order_id,expires_at,status').eq('driver_id',driver.id)
       .eq('status','pending').gt('expires_at',new Date().toISOString())
       .order('offered_at',{ascending:false}).limit(5)
      if(error)throw error
      return send({ok:true,offers:data||[]})
    }
    if(action==='offer_reply'){
      if(!driverRole||!driver||!driver.active||!driver.verified||!uuid(body.offer_id)
        ||typeof body.accept!=='boolean')return fail('Solicitud inválida',403)
      const {data,error}=await db.rpc('flashfood_reply_delivery_offer',{
        p_offer_id:body.offer_id,p_driver_id:driver.id,p_accept:body.accept})
      if(error)throw error
      if(data?.result==='rejected'&&data.order_id){
        const {error:dispatchError}=await db.rpc('flashfood_offer_nearest',{p_order_id:data.order_id})
        if(dispatchError)console.error('Reasignación pendiente',dispatchError.message)
      }
      return send({ok:true,...data})
    }
    if(action==='driver_presence'){
      if(!driverRole||!driver||!driver.active||!driver.verified)return fail('Repartidor no autorizado',403)
      if(!originOK(body.latitude,body.longitude))return fail('Ubicación inválida',400)
      const {error}=await db.from('flashfood_driver_live_locations').upsert({
       driver_id:driver.id,latitude:body.latitude,longitude:body.longitude,
       recorded_at:new Date().toISOString()},{onConflict:'driver_id'})
      if(error)throw error
      return send({ok:true})
    }
    if(action==='workflow_status'){
      if(!uuid(body.order_id))return fail('Pedido inválido',400)
      const {data:order,error:readError}=await db.from('flashfood_orders')
       .select('id,customer_id,driver_id,mobile_local_id').eq('id',body.order_id).maybeSingle()
      if(readError)throw readError
      if(!order||(!admin&&order.customer_id!==userId&&order.driver_id!==driver?.id))
        return fail('No autorizado',403)
      const {data:progress,error:progressError}=await db.from('flashfood_order_progress')
       .select('stage,updated_at').eq('order_id',order.id).maybeSingle()
      if(progressError)throw progressError
      return send({ok:true,stage:progress?.stage||'recibido',updated_at:progress?.updated_at||null})
    }
    if(action==='create'){
      if(!uuid(body.idempotency_key)||!uuid(body.branch_id))return fail('Solicitud de pedido inválida')
      const {data:existing,error:existingError}=await db.from('flashfood_orders')
        .select('*').eq('customer_id',userId).eq('idempotency_key',body.idempotency_key).maybeSingle()
      if(existingError)throw existingError
      if(existing)return send({ok:true,order:toMobile(existing),reused:true})
      const modality=String(body.modalidad||'')
      const method=String(body.payment_method||'')
      if(!['domicilio','retirar','servir'].includes(modality))return fail('Modalidad inválida')
      if(!['tarjeta','transferencia','efectivo','local'].includes(method))return fail('Método de pago inválido')
      if(modality==='domicilio'&&method==='local')return fail('Selecciona pago por tarjeta, transferencia o efectivo')
      if(modality!=='domicilio'&&method!=='local')return fail('El retiro o consumo debe pagarse en el establecimiento')
      const rawBilling=body.billing&&typeof body.billing==='object'&&!Array.isArray(body.billing)
        ? body.billing as Record<string,unknown> : {}
      const billingName=typeof rawBilling.nombre==='string'?rawBilling.nombre.trim().slice(0,250):''
      const billingId=typeof rawBilling.identificacion==='string'?rawBilling.identificacion.replace(/\s/g,'').slice(0,32):''
      const billingEmail=typeof rawBilling.correo==='string'?rawBilling.correo.trim().toLowerCase().slice(0,254):''
      const billingPhone=typeof rawBilling.telefono==='string'?rawBilling.telefono.trim().slice(0,30):''
      const hasBuyerData=Boolean(billingName||billingId||billingEmail||billingPhone)
      if(hasBuyerData&&(
        billingName.length<3|| !/^(\d{10}|\d{13})$/.test(billingId) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(billingEmail)
      ))return fail('Completa nombre, cédula/RUC y correo válido para facturación, o deja los datos vacíos para consumidor final.')
      const invoiceBilling={consumer_final:!hasBuyerData,nombre:billingName,
        identificacion:billingId,correo:billingEmail,telefono:billingPhone}
      const note=typeof body.note==='string'?body.note.trim().slice(0,500):''
      const tip=modality==='domicilio'&&money(body.tip)?dollars(body.tip as number):0
      const submitted=body.items
      if(!Array.isArray(submitted)||submitted.length===0||submitted.length>50)return fail('El carrito no contiene productos válidos')
      const {data:catalog,error:catalogError}=await db.rpc('flashfood_catalogo_restaurantes',{p_app_codigo:'flashfood_mobile'})
      if(catalogError)throw catalogError
      const {data:erpCatalog,error:erpCatalogError}=await db.rpc('flashfood_erp_public_restaurants')
      if(erpCatalogError)throw erpCatalogError
      const {data:mirrorIds,error:mirrorError}=await db.rpc('flashfood_erp_mirror_branch_ids')
      if(mirrorError)throw mirrorError
      const mirrored=new Set(Array.isArray(mirrorIds)?mirrorIds:[])
      const permitted=[...(Array.isArray(catalog)?catalog.filter(x=>!mirrored.has(x.sucursal_id)):[]),
        ...(Array.isArray(erpCatalog)?erpCatalog:[])]
      const branch=permitted.find(x=>x.sucursal_id===body.branch_id)
      if(!branch||!branch.acepta_pedidos||!branch.abierto)return fail('La sucursal está cerrada o no admite pedidos',409)
      const {data:erpLink,error:erpLinkError}=await db.from('flashfood_erp_catalog_branches')
        .select('erp_branch_id').eq('sucursal_id',branch.sucursal_id).maybeSingle()
      if(erpLinkError)throw erpLinkError

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
        const {data:coordsBranch,error:coordsBranchError}=await db.from('sucursales').select('lat,lng')
          .eq('id',branch.sucursal_id).maybeSingle()
        if(coordsBranchError)throw coordsBranchError
        const {data:coordsConfig,error:coordsConfigError}=await db.from('configuracion').select('lat,lng')
          .eq('sucursal_id',branch.sucursal_id).maybeSingle()
        if(coordsConfigError)throw coordsConfigError
        const latitude=originOK(coordsBranch?.lat,coordsBranch?.lng)?coordsBranch!.lat:coordsConfig?.lat
        const longitude=originOK(coordsBranch?.lat,coordsBranch?.lng)?coordsBranch!.lng:coordsConfig?.lng
        if(!originOK(address.latitude,address.longitude)||!originOK(latitude,longitude))
          return fail('Se requieren coordenadas de dirección y sucursal',422)
        const {data:hasDriver,error:availableError}=await db.rpc('flashfood_delivery_disponible')
        if(availableError)throw availableError
        if(!hasDriver)return fail('No hay repartidores disponibles',409)
        const routing=await road({lat:latitude,lng:longitude},{lat:address.latitude,lng:address.longitude})
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
      if(!money(body.expected_total)||Math.abs(cents(body.expected_total as number)-cents(total))>1)
        return fail('El precio o la tarifa cambiaron. Actualiza el carrito antes de confirmar.',409)
      const paymentStatus='pending'
      const methodDb=method==='tarjeta'?'payphone':method==='efectivo'?'cash':method==='transferencia'?'transfer':'merchant'
      const {data:order,error:orderError}=await db.from('flashfood_orders').insert({
        customer_id:userId,idempotency_key:body.idempotency_key,source_system:erpLink?'multicomercios':'restaurant_erp',
        source_branch_id:erpLink?.erp_branch_id||branch.sucursal_id,fulfillment:modality==='domicilio'?'delivery':'pickup',
        mobile_local_id:branch.local_id,mobile_branch_id:branch.sucursal_id,mobile_modality:modality,
        address_id:addressId,delivery_address:addressSnapshot,status:'pending',payment_method:methodDb,
        payment_status:paymentStatus,payment_review_status:method==='transferencia'?'awaiting_verification':'none',
        products_total:subtotal,delivery_fee:fee,tip,platform_surcharge:service,grand_total:total,
        route_km:km,route_duration_minutes:minutes,customer_note:note,
      }).select('*').single()
      if(orderError){
        if(orderError.code==='23505'){
          const {data:duplicate}=await db.from('flashfood_orders').select('*')
            .eq('customer_id',userId).eq('idempotency_key',body.idempotency_key).maybeSingle()
          if(duplicate)return send({ok:true,order:toMobile(duplicate),reused:true})
        }
        throw orderError
      }
      const {error:itemError}=await db.from('flashfood_order_items').insert(items.map(x=>({
        order_id:order.id,source_product_id:x.product_id,source_presentation_id:x.presentation_id,
        product_name_snapshot:x.name,presentation_name_snapshot:x.presentation_name,
        quantity:x.quantity,unit_price:x.unit_price,note:x.note,
      })))
      if(itemError){
        // Never dispatch a partial order.
        await db.from('flashfood_orders').update({status:'cancelled'}).eq('id',order.id)
        throw itemError
      }
      const {error:billingError}=await db.rpc('flashfood_attach_order_billing',{
        p_order_id:order.id,p_billing:invoiceBilling,
      })
      if(billingError){
        // No rider was assigned and no payment started. Remove partial order and its items.
        const {error:cleanupError}=await db.from('flashfood_orders').delete().eq('id',order.id)
        if(cleanupError)console.error('No se pudo revertir pedido fiscal incompleto:',cleanupError.code)
        throw new Error('No se pudo guardar la información de facturación del pedido: '+billingError.message)
      }
      // El despacho comienza únicamente cuando el restaurante marca el pedido como listo.
      if(method!=='tarjeta'&&method!=='transferencia'){
        try{await notifyFlashFoodMerchant(db,order.id)}
        catch(err){console.error('Alerta comercial pendiente:',err instanceof Error?err.message:'Error')}
        try{
          const sync=await syncFlashFoodOrderToErp(db,order.id,true)
          if(!sync.synced)console.warn('Pedido pendiente sincronización ERP:',sync.reason)
        }catch(error){console.error('Aviso ERP pendiente:',error instanceof Error?error.message:'Error')}
      }
      const {error:progressError}=await db.from('flashfood_order_progress')
       .upsert({order_id:order.id,stage:'recibido'},{onConflict:'order_id',ignoreDuplicates:true})
      if(progressError)console.error('No se pudo inicializar el flujo del pedido',progressError.message)
      return send({ok:true,order:toMobile(order),requires_payment:method==='tarjeta',requires_verification:method==='transferencia'})
    }

    if(action==='status'){
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const {data:order,error:readError}=await db.from('flashfood_orders').select('*').eq('id',body.order_id).maybeSingle()
      if(readError)throw readError
      if(!order)return fail('Pedido no encontrado',404)
      if(order.customer_id!==userId&&!admin&&(!driver||order.driver_id!==driver.id))return fail('No autorizado',403)
      let position=null
      if(['assigned','accepted','in_transit'].includes(order.status)&&order.driver_id){
        const {data,error:locationError}=await db.from('flashfood_driver_positions')
          .select('latitude,longitude,accuracy_m,recorded_at').eq('driver_id',order.driver_id).eq('order_id',order.id).maybeSingle()
        if(locationError)throw locationError
        position=data
      }
      return send({ok:true,order:toMobile(order),position})
    }

    if(action==='driver_identity'){
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const {data:order,error:orderError}=await db.from('flashfood_orders')
        .select('id,customer_id,driver_id,mobile_modality,status').eq('id',body.order_id).maybeSingle()
      if(orderError)throw orderError
      if(!order||order.customer_id!==userId||!order.driver_id||order.mobile_modality!=='domicilio'
        ||['cancelled','pending'].includes(order.status))return fail('Repartidor no disponible para este pedido',404)
      const {data:assigned,error:assignedError}=await db.from('flashfood_drivers')
        .select('full_name,vehicle_type,vehicle_plate,photo_storage_path').eq('id',order.driver_id).maybeSingle()
      if(assignedError)throw assignedError
      if(!assigned)return fail('Repartidor no encontrado',404)
      let photo_url:null|string=null
      if(assigned.photo_storage_path){
        const {data:signed,error:signError}=await db.storage.from('flashfood-driver-photos')
          .createSignedUrl(assigned.photo_storage_path,120)
        if(signError)console.error('driver identity signed url',signError.message)
        else photo_url=signed?.signedUrl||null
      }
      return send({ok:true,driver:{name:assigned.full_name,vehicle_type:assigned.vehicle_type,
        vehicle_plate:assigned.vehicle_plate,photo_url}})
    }
    if(action==='driver_orders'){
      if(!driverRole||!driver)return fail('No autorizado',403)
      const {data,error}=await db.from('flashfood_orders').select('*').eq('driver_id',driver.id)
        .in('status',['assigned','accepted','in_transit']).order('created_at',{ascending:true})
      if(error)throw error
      return send({ok:true,orders:(data||[]).map(toMobile)})
    }

    if(action==='driver_transition'){
      if(!driverRole||!driver?.active||!driver.verified)return fail('Perfil de repartidor sin habilitar',403)
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const next=String(body.status||'')
      if(!['picked_up','delivered'].includes(next))return fail('Transición inválida')
      const previous=next==='picked_up'?'assigned':'in_transit'
      const {data:current,error:currentError}=await db.from('flashfood_orders')
        .select('id,payment_method,payment_status').eq('id',body.order_id).eq('driver_id',driver.id).eq('status',previous).maybeSingle()
      if(currentError)throw currentError
      if(!current)return fail('Pedido no asignado o transición inválida',409)
      if(next==='delivered'&&current.payment_method==='cash'&&body.cash_collected!==true)
        return fail('Debes confirmar que recibiste el efectivo antes de cerrar la entrega',409)
      const changes:Record<string,unknown>={status:next==='picked_up'?'in_transit':next,updated_at:new Date().toISOString()}
      if(next==='delivered'&&current.payment_method==='cash')changes.payment_review_status='awaiting_verification'
      const {data:updated,error}=await db.from('flashfood_orders').update(changes)
        .eq('id',body.order_id).eq('driver_id',driver.id).eq('status',previous).select('*').maybeSingle()
      if(error)throw error
      if(!updated)return fail('Pedido no asignado o transición de estado inválida',409)
      const stage=next==='picked_up'?'reparto':'entregado'
      const {error:stageError}=await db.from('flashfood_order_progress').update({stage,updated_at:new Date().toISOString(),updated_by:userId}).eq('order_id',body.order_id)
      if(stageError)throw stageError
      await db.from('flashfood_order_stage_events').insert({order_id:body.order_id,stage,actor_id:userId})
      if(next==='delivered'){
        await db.from('flashfood_driver_positions').delete().eq('driver_id',driver.id)
        await db.from('flashfood_drivers').update({availability:'available',updated_at:new Date().toISOString()}).eq('id',driver.id)
      }
      return send({ok:true,order:toMobile(updated)})
    }

    if(action==='driver_location'){
      if(!driverRole||!driver?.active||!driver.verified)return fail('Repartidor no autorizado',403)
      if(!uuid(body.order_id)||!originOK(body.latitude,body.longitude))return fail('Ubicación inválida')
      const {data:order,error:readError}=await db.from('flashfood_orders').select('id')
        .eq('id',body.order_id).eq('driver_id',driver.id).in('status',['assigned','accepted','in_transit']).maybeSingle()
      if(readError)throw readError
      if(!order)return fail('La ubicación solo puede compartirse durante una entrega aceptada',403)
      const {error}=await db.from('flashfood_driver_positions').upsert({
        driver_id:driver.id,order_id:order.id,latitude:body.latitude,longitude:body.longitude,
        accuracy_m:money(body.accuracy_m)?body.accuracy_m:null,recorded_at:new Date().toISOString(),
      },{onConflict:'driver_id'})
      if(error)throw error
      return send({ok:true})
    }

    if(action==='dispatch_pending'){
      if(!admin)return fail('Solo Superadmin',403)
      const {data:pending,error}=await db.from('flashfood_order_progress').select('order_id')
        .eq('stage','asignando').order('updated_at',{ascending:true}).limit(50)
      if(error)throw error
      let count=0
      for(const order of pending||[]){
        const {data:assigned,error:assignError}=await db.rpc('flashfood_offer_nearest',{p_order_id:order.order_id})
        if(assignError)throw assignError
        if(assigned){
          count++
          const {data:card}=await db.from('flashfood_orders').select('payment_method,payment_status')
            .eq('id',order.id).maybeSingle()
          if(card?.payment_method==='payphone'&&card.payment_status==='paid'){
            const {error:ledgerError}=await db.rpc('flashfood_stage_card_obligations',{p_order_id:order.id})
            if(ledgerError)console.error('Obligación repartidor pendiente',ledgerError.message)
          }
        }
      }
      return send({ok:true,assigned:count})
    }

    if(action==='verify_transfer'){
      if(!admin)return fail('Solo Superadmin puede verificar transferencias',403)
      if(!uuid(body.order_id)||body.approved!==true)return fail('Se requiere aprobación explícita y comprobación bancaria')
      const {data:order,error}=await db.from('flashfood_orders').update({
        payment_status:'paid',payment_review_status:'none',updated_at:new Date().toISOString(),
      }).eq('id',body.order_id).eq('payment_method','transfer').eq('payment_status','pending').eq('payment_review_status','awaiting_verification').eq('status','pending').select('*').maybeSingle()
      if(error)throw error
      if(!order)return fail('Transferencia no pendiente',409)
      // El restaurante controla "Listo"; no asignar un repartidor todavía.
      try{await notifyFlashFoodMerchant(db,order.id)}
      catch(err){console.error('Alerta comercial pendiente:',err)}
      try{
        const sync=await syncFlashFoodOrderToErp(db,order.id,true)
        if(!sync.synced)console.warn('Aviso ERP pendiente:',sync.reason)
      }catch(error){console.error('Aviso ERP pendiente:',error)}
      return send({ok:true,order:toMobile(order)})
    }

    if(action==='verify_cash'){
      if(!admin)return fail('Solo Superadmin puede conciliar efectivo',403)
      if(!uuid(body.order_id)||body.approved!==true)return fail('Confirma el efectivo recibido contra la caja',400)
      const {data:order,error}=await db.from('flashfood_orders').update({
        payment_status:'paid',payment_review_status:'none',updated_at:new Date().toISOString(),
      }).eq('id',body.order_id).eq('payment_method','cash').eq('status','delivered')
        .eq('payment_review_status','awaiting_verification').select('*').maybeSingle()
      if(error)throw error
      if(!order)return fail('Efectivo no pendiente de conciliación',409)
      return send({ok:true,order:toMobile(order)})
    }


    if(action==='settlement_list'){
      if(!admin)return fail('Solo Superadmin puede consultar liquidaciones',403)
      const {data,error}=await db.from('flashfood_financial_obligations')
        .select('id,order_id,debtor_type,creditor_type,creditor_id,amount,settled_amount,status,erp_business_id,erp_branch_id,erp_synced_at,created_at')
        .order('created_at',{ascending:false}).limit(300)
      if(error)throw error
      return send({ok:true,rows:(data||[]).filter(x=>x.debtor_type==='platform').map(x=>({...x,beneficiary_type:x.creditor_type,merchant_local_id:x.creditor_type==='merchant'?x.creditor_id:null,driver_id:x.creditor_type==='driver'?x.creditor_id:null,amount_due:x.amount,amount_paid:x.settled_amount,status:x.status==='settled'?'paid':x.status}))})
    }

    if(action==='settlement_transfer'){
      if(!admin)return fail('Solo Superadmin puede registrar transferencias',403)
      if(!uuid(body.obligation_id)||!money(body.amount)||!body.amount||typeof body.reference!=='string'
         ||body.reference.trim().length<3||typeof body.transfer_date!=='string'
         ||!/^\d{4}-\d{2}-\d{2}$/.test(body.transfer_date))return fail('Ingresa importe, fecha y referencia bancaria válidos')
      const {data:row,error}=await db.rpc('flashfood_record_transfer',{
        p_obligation_id:body.obligation_id,p_amount:body.amount,
        p_reference:body.reference.trim(),p_date:body.transfer_date,p_actor:userId,
      })
      if(error)throw error
      if(row?.creditor_type==='merchant'){
        try{
          const sync=await syncFlashFoodOrderToErp(db,row.order_id,false)
          if(!sync.synced)console.warn('Pago pendiente reflejar en ERP:',sync.reason)
        }catch(err){console.error('Reintentar sincronización ERP',err)}
      }
      return send({ok:true,row})
    }

    if(action==='settlement_sync'){
      if(!admin)return fail('Solo Superadmin',403)
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const {data:order,error}=await db.from('flashfood_orders')
        .select('id,payment_method,payment_status,fulfillment').eq('id',body.order_id).maybeSingle()
      if(error)throw error
      if(!order)return fail('Pedido no encontrado',404)
      if(order.payment_method==='payphone'&&order.payment_status==='paid'){
        const {error:stageError}=await db.rpc('flashfood_stage_card_obligations',{p_order_id:order.id})
        if(stageError)throw stageError
      }
      const result=await syncFlashFoodOrderToErp(db,order.id,true)
      if(!result.synced)return fail(result.reason||'No se pudo sincronizar',409)
      return send({ok:true})
    }

    if(action==='payment_link'){
      if(!uuid(body.order_id))return fail('Pedido inválido')
      const {data:order,error}=await db.from('flashfood_orders').select('*')
        .eq('id',body.order_id).eq('customer_id',userId).eq('payment_method','payphone').maybeSingle()
      if(error)throw error
      if(!order)return fail('Pedido no encontrado',404)
      if(order.payment_status==='paid')return send({ok:true,paid:true})
      if(order.payphone_link)return send({ok:true,link:order.payphone_link})
      const token=Deno.env.get('PAYPHONE_TOKEN'),storeId=Deno.env.get('PAYPHONE_STORE_ID')
      if(!token||!storeId)return fail('Faltan credenciales PayPhone; configura los secretos primero',503)
      if(Deno.env.get('PAYPHONE_ENABLE_LIVE_CHARGES')!=='true')
        return fail('Cobro con tarjeta bloqueado hasta validar ambiente, impuestos y conciliación PayPhone.',503)
      const tx='F'+String(order.id).replaceAll('-','').slice(0,14)
      const amount=cents(Number(order.grand_total))
      const responseUrl=Deno.env.get('PAYPHONE_RESPONSE_URL')
      if(!responseUrl||!/^https:\/\//.test(responseUrl))return fail('Configura PAYPHONE_RESPONSE_URL con la URL pública de retorno de PayPhone.',503)
      const response=await fetch('https://pay.payphonetodoesposible.com/api/button/Prepare',{
        method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
        body:JSON.stringify({amount,amountWithoutTax:amount,amountWithTax:0,tax:0,
          currency:'USD',storeId,clientTransactionId:tx,responseUrl,
          reference:'FlashFood '+String(order.id).slice(0,8),timeZone:-5}),
        signal:AbortSignal.timeout(12000),
      })
      if(!response.ok)throw new Error('PayPhone rechazó la preparación del cobro ('+response.status+')')
      const prepared=await response.json()
      const link=prepared?.payWithCard
      if(typeof link!=='string'||!/^https:\/\//.test(link))throw new Error('Respuesta inesperada de PayPhone: falta payWithCard')
      const {error:updateError}=await db.from('flashfood_orders')
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
