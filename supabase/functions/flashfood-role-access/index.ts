import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import {pushToDevices} from '../_shared/flashfoodMerchantNotify.ts'
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const respond = (obj: Record<string,unknown>,status=200) => new Response(JSON.stringify(obj),{status,headers:{...headers,'Content-Type':'application/json'}})
const bad = (error:string,status=400) => respond({ok:false,error},status)
const validId = (s:unknown):s is string => typeof s==='string' && /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(s)
const emailText=(s:unknown) => typeof s==='string'?s.trim().toLowerCase():''
const allowedRoles=['superadmin','admin','empleado','delivery']
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers})
 if(req.method!=='POST')return bad('Método no permitido',405)
 try {
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!anon||!secret)return bad('Configuración de Supabase incompleta',500)
  const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'')
  if(!token)return bad('Sesión requerida',401)
  const {data:auth,error:authError}=await createClient(url,anon).auth.getUser(token)
  if(authError||!auth.user)return bad('Sesión inválida',401)
  const caller=auth.user.id
  const db=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
  const body=await req.json().catch(()=>({})) as Record<string,unknown>
  const action=String(body.action||'me')
  const {data:roles,error:rolesError}=await db.from('flashfood_user_roles').select('role').eq('user_id',caller).eq('active',true)
  if(rolesError)throw rolesError
  const activeRoles=[...new Set((roles||[]).map(r=>r.role).filter(r=>allowedRoles.includes(r)))]
  const superadmin=activeRoles.includes('superadmin')
  const {data:access,error:accessError}=await db.from('flashfood_business_access').select('*').eq('user_id',caller).eq('active',true)
  if(accessError)throw accessError
  const grants=access||[]
  const allowedAdmin=(businessId:string)=>superadmin||grants.some(g=>g.role==='admin'&&g.business_id===businessId)
  const allowedRead=(businessId:string)=>allowedAdmin(businessId)||grants.some(g=>g.role==='empleado'&&g.business_id===businessId)
  const ensureBusiness=async(id:string)=>{
   const {data,error}=await db.from('locales').select('id,nombre').eq('id',id).maybeSingle()
   if(error)throw error
   return data
  }
  const ensureBranch=async(id:string,businessId:string)=>{
   // Comprobar pertenencia de sucursal al negocio; nunca confiar en un ID enviado por el frontend.
   const {data,error}=await db.from('sucursales').select('id').eq('id',id).eq('local_id',businessId).maybeSingle()
   if(error)throw error
   return Boolean(data)
  }
  const resolveUser=async(email:string,invite=false)=>{
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Correo inválido')
   let page=1
   while(page<=100){
    const {data,error}=await db.auth.admin.listUsers({page,perPage:1000})
    if(error)throw error
    const found=data.users.find(u=>u.email?.toLowerCase()===email)
    if(found)return {id:found.id,created:false}
    if(data.users.length<1000)break
    page++
   }
   if(!invite)throw new Error('No existe una cuenta con ese correo. Invita al empleado primero.')
   const {data,error}=await db.auth.admin.inviteUserByEmail(email)
   if(error)throw error
   if(!data.user)throw new Error('No se pudo enviar invitación')
   return {id:data.user.id,created:true}
  }
  const upsertRole=async(userId:string,role:string,active:boolean)=>{
   const {data:old,error:readError}=await db.from('flashfood_user_roles').select('id').eq('user_id',userId).eq('role',role).maybeSingle()
   if(readError)throw readError
   const result=old?await db.from('flashfood_user_roles').update({active}).eq('id',old.id):await db.from('flashfood_user_roles').insert({user_id:userId,role,active})
   if(result.error)throw result.error
  }
  if(action==='me')return respond({ok:true,roles:activeRoles,access:grants,superadmin})
  if(action==='businesses'){
   const owned=superadmin?null:[...new Set(grants.map(g=>g.business_id))]
   if(owned&&owned.length===0)return respond({ok:true,businesses:[]})
   let q=db.from('locales').select('id,nombre,activo').order('nombre')
   if(owned)q=q.in('id',owned)
   const {data,error}=await q
   if(error)throw error
   const ids=(data||[]).map(b=>b.id)
   const {data:settings,error:sErr}=ids.length?await db.from('flashfood_business_settings').select('*').in('business_id',ids):{data:[],error:null}
   if(sErr)throw sErr
   return respond({ok:true,businesses:(data||[]).filter(b=>superadmin||allowedRead(b.id)).map(b=>({...b,free_delivery:Boolean(settings?.find(s=>s.business_id===b.id)?.free_delivery),can_manage:allowedAdmin(b.id)}))})
  }
  if(action==='merchant_orders'){
   const businessId=body.business_id
   if(!validId(businessId)||!allowedRead(businessId))return bad('Sin permiso sobre este negocio',403)
   const assignedBranches=grants.filter(g=>g.business_id===businessId&&g.active&&g.branch_id).map(g=>g.branch_id)
   const unrestricted=superadmin||grants.some(g=>g.business_id===businessId&&g.active&&g.role==='admin'&&!g.branch_id)
    ||grants.some(g=>g.business_id===businessId&&g.active&&g.role==='empleado'&&!g.branch_id)
   let query=db.from('flashfood_orders').select('id,order_number,mobile_branch_id,fulfillment,status,payment_method,payment_status,products_total,created_at,customer_note,scheduled_pickup_at')
    .eq('mobile_local_id',businessId).order('created_at',{ascending:false}).limit(100)
   if(!unrestricted){
    if(!assignedBranches.length)return respond({ok:true,orders:[]})
    query=query.in('mobile_branch_id',assignedBranches)
   }
   const {data,error}=await query
   if(error)throw error
   return respond({ok:true,orders:data||[]})
  }
  if(action==='merchant_stage'||action==='merchant_chat_list'||action==='merchant_chat_send'){
   if(!validId(body.order_id))return bad('Pedido inválido',400)
   const {data:order,error:orderError}=await db.from('flashfood_orders')
     .select('id,customer_id,mobile_local_id,mobile_branch_id,fulfillment,payment_method,payment_status,status')
     .eq('id',body.order_id).maybeSingle()
   if(orderError)throw orderError
   if(!order||!order.mobile_local_id||!allowedRead(order.mobile_local_id))
     return bad('No tienes permisos sobre este pedido',403)
   if(!superadmin&&!grants.some(g=>g.business_id===order.mobile_local_id&&g.active
     &&(!g.branch_id||g.branch_id===order.mobile_branch_id)))
     return bad('No tienes acceso a esta sucursal',403)
   const {data:progress,error:progressError}=await db.from('flashfood_order_progress')
     .select('stage').eq('order_id',order.id).maybeSingle()
   if(progressError)throw progressError
   const stage=progress?.stage||'recibido'
   if(action==='merchant_chat_list'){
     const {data,error}=await db.from('flashfood_order_chat')
      .select('id,sender_role,sender_name,message,created_at').eq('order_id',order.id)
      .order('created_at',{ascending:true}).limit(200)
     if(error)throw error
     return respond({ok:true,messages:data||[],stage,
       can_send:['recibido','preparando','listo','asignando'].includes(stage)})
   }
   if(action==='merchant_chat_send'){
     if(!['recibido','preparando','listo','asignando'].includes(stage)||order.status==='cancelled')
       return bad('La atención de este chat ya fue transferida o cerrada',409)
     const message=typeof body.message==='string'?body.message.trim():''
     if(!message||message.length>1500)return bad('Mensaje inválido',400)
     const {data,error}=await db.from('flashfood_order_chat').insert({
       order_id:order.id,sender_id:caller,sender_role:'restaurante',
       sender_name:'Restaurante',message,
     }).select('id,sender_role,sender_name,message,created_at').single()
     if(error)throw error
     try{await pushToDevices(db,[order.customer_id],order.id,
       'Nuevo mensaje en FlashFood','El restaurante te envió un mensaje sobre tu pedido.','order_chat')}
     catch(e){console.error('Chat guardado; push pendiente:',e instanceof Error?e.message:'Error')}
     return respond({ok:true,message:data})
   }
   const next=String(body.stage||'')
   const expected:Record<string,string>={recibido:'preparando',preparando:'listo',listo:'asignando'}
   if(expected[stage]!==next)return bad('El estado no sigue el flujo permitido',409)
   if(order.status==='cancelled'||(order.payment_method==='payphone'||order.payment_method==='transfer')
     &&order.payment_status!=='paid')return bad('No se puede preparar un pedido sin pago confirmado',409)
   if(!progress){
     const {error:initError}=await db.from('flashfood_order_progress')
       .insert({order_id:order.id,stage:'recibido'})
     if(initError&&initError.code!=='23505')throw initError
   }
   const {data:changed,error:changeError}=await db.from('flashfood_order_progress')
      .update({stage:next,updated_at:new Date().toISOString(),updated_by:caller})
      .eq('order_id',order.id).eq('stage',stage).select('order_id').maybeSingle()
   if(changeError)throw changeError
   if(!changed)return bad('El pedido fue actualizado por otra persona. Recarga.',409)
   await db.from('flashfood_order_stage_events').insert({order_id:order.id,stage:next,actor_id:caller})
   if(next==='listo'&&order.fulfillment==='delivery'){
     const {data:advance,error:advanceError}=await db.from('flashfood_order_progress')
       .update({stage:'asignando',updated_at:new Date().toISOString(),updated_by:caller})
       .eq('order_id',order.id).eq('stage','listo').select('order_id').maybeSingle()
     if(advanceError)throw advanceError
     if(!advance)return bad('El estado cambió. Actualiza el pedido.',409)
     await db.from('flashfood_order_stage_events').insert({order_id:order.id,stage:'asignando',actor_id:caller})
     const {data:offered,error:offerError}=await db.rpc('flashfood_offer_nearest',{p_order_id:order.id})
     if(offerError)throw offerError
     return respond({ok:true,stage:'asignando',dispatch:offered})
   }
   if(next==='asignando'){
     const {data:offered,error:offerError}=await db.rpc('flashfood_offer_nearest',{p_order_id:order.id})
     if(offerError)throw offerError
     return respond({ok:true,stage:next,dispatch:offered})
   }
   return respond({ok:true,stage:next})
  }
  if(action==='merchant_alerts'){
   const businessId=body.business_id
   if(!validId(businessId)||!allowedRead(businessId))return bad('Sin permiso sobre este negocio',403)
   const {data,error}=await db.from('flashfood_mobile_merchant_alerts')
    .select('id,order_id,title,message,read_at,created_at').eq('business_id',businessId)
    .eq('user_id',caller).order('created_at',{ascending:false}).limit(30)
   if(error)throw error
   return respond({ok:true,alerts:data||[]})
  }
  if(action==='merchant_alert_read'){
   if(!validId(body.alert_id))return bad('Alerta inválida')
   const {error}=await db.from('flashfood_mobile_merchant_alerts').update({read_at:new Date().toISOString()})
    .eq('id',body.alert_id).eq('user_id',caller)
   if(error)throw error
   return respond({ok:true})
  }
  if(action==='employees'){
   const businessId=body.business_id
   if(!validId(businessId)||!allowedAdmin(businessId))return bad('Sin permiso sobre este negocio',403)
   const {data,error}=await db.from('flashfood_business_access').select('id,user_id,business_id,branch_id,role,active,created_at').eq('business_id',businessId).order('created_at',{ascending:false})
   if(error)throw error
   const employees=await Promise.all((data||[]).map(async row=>{
    const {data:u,error:e}=await db.auth.admin.getUserById(row.user_id)
    return {...row,email:e?'':(u.user.email||''),name:e?'':String(u.user.user_metadata?.full_name||'')}
   }))
   return respond({ok:true,employees})
  }
  if(action==='set_business_access'){
   const businessId=body.business_id,role=body.role,active=body.active,branch=body.branch_id??null
   if(!validId(businessId)||!['admin','empleado'].includes(String(role))||typeof active!=='boolean')return bad('Asignación inválida')
   if(!allowedAdmin(businessId))return bad('Sin acceso al negocio',403)
   if(!superadmin&&role!=='empleado')return bad('Solo Superadmin asigna administradores',403)
   if(!await ensureBusiness(businessId))return bad('Negocio no encontrado',404)
   if(branch!==null&&(!validId(branch)||!await ensureBranch(branch,businessId)))return bad('Sucursal no corresponde a este negocio')
   const email=emailText(body.email)
   const target=await resolveUser(email,body.invite===true&&role==='empleado')
   if(target.id===caller&&!active)return bad('No puedes revocar tu propia asignación')
   // Restricción: el administrador solo puede cambiar permisos de empleado de su negocio.
   const {data:old,error:oldErr}=await db.from('flashfood_business_access').select('id').eq('user_id',target.id).eq('business_id',businessId).eq('role',role).is('branch_id',null).maybeSingle()
   if(oldErr)throw oldErr
   const payload={active,updated_at:new Date().toISOString()}
   const r=old?await db.from('flashfood_business_access').update(payload).eq('id',old.id):
    await db.from('flashfood_business_access').insert({user_id:target.id,business_id:businessId,branch_id:branch,role,active})
   if(r.error)throw r.error
   // Un rol global solo habilita la UI; nunca da acceso a otros negocios.
   if(active)await upsertRole(target.id,String(role),true)
   return respond({ok:true,user_id:target.id,invited:target.created})
  }
  if(action==='set_free_delivery'){
   const businessId=body.business_id
   if(!validId(businessId)||!allowedAdmin(businessId))return bad('Sin permiso para configurar este negocio',403)
   if(typeof body.enabled!=='boolean')return bad('Estado inválido')
   const {error}=await db.from('flashfood_business_settings').upsert({business_id:businessId,free_delivery:body.enabled,updated_by:caller,updated_at:new Date().toISOString()},{onConflict:'business_id'})
   if(error)throw error
   return respond({ok:true})
  }
  if(action==='driver_update_profile'){
   if(!activeRoles.includes('delivery'))return bad('Requiere rol de repartidor',403)
   const {data:existing,error:existingError}=await db.from('flashfood_drivers').select('id,photo_storage_path').eq('auth_user_id',caller).maybeSingle()
   if(existingError)throw existingError
   if(!existing)return bad('El Superadmin debe registrar primero al repartidor',404)
   const vehicle=typeof body.vehicle_type==='string'?body.vehicle_type.trim():''
   const plate=typeof body.vehicle_plate==='string'?body.vehicle_plate.trim().toUpperCase():''
   if(!vehicle||vehicle.length>60||!/^[A-Z0-9-]{4,12}$/.test(plate))
     return bad('Ingresa tipo de vehículo y placa válidos',400)
   const {data:updated,error:updateError}=await db.from('flashfood_drivers')
    .update({vehicle_type:vehicle,vehicle_plate:plate,updated_at:new Date().toISOString()})
    .eq('id',existing.id).select('*').single()
   if(updateError)throw updateError
   return respond({ok:true,driver:updated})
  }
  if(action==='driver_upload_photo'){
   if(!activeRoles.includes('delivery'))return bad('Requiere rol de repartidor',403)
   const {data:existing,error:existingError}=await db.from('flashfood_drivers')
      .select('id,photo_storage_path').eq('auth_user_id',caller).maybeSingle()
   if(existingError)throw existingError
   if(!existing)return bad('El Superadmin debe registrar primero al repartidor',404)
   const base64=typeof body.image_base64==='string'?body.image_base64:''
   const mime=typeof body.mime_type==='string'?body.mime_type:''
   if(!['image/jpeg','image/png','image/webp'].includes(mime)||base64.length>4200000||base64.length<120
      ||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return bad('Foto no válida. Usa JPG, PNG o WebP de hasta 3 MB')
   const raw=Uint8Array.from(atob(base64),c=>c.charCodeAt(0))
   if(raw.byteLength>3145728)return bad('La foto supera 3 MB')
   const extension=mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'
   const path=caller+'/'+crypto.randomUUID()+'.'+extension
   const {error:uploadError}=await db.storage.from('flashfood-driver-photos')
      .upload(path,raw,{contentType:mime,upsert:false})
   if(uploadError)throw uploadError
   const {data:updated,error:updateError}=await db.from('flashfood_drivers')
      .update({photo_storage_path:path,updated_at:new Date().toISOString()})
      .eq('id',existing.id).select('*').single()
   if(updateError){await db.storage.from('flashfood-driver-photos').remove([path]);throw updateError}
   if(existing.photo_storage_path&&existing.photo_storage_path!==path)
     await db.storage.from('flashfood-driver-photos').remove([existing.photo_storage_path])
   return respond({ok:true,driver:updated})
  }
  if(action==='driver_set_availability'){
   if(!activeRoles.includes('delivery'))return bad('Requiere rol de repartidor activo',403)
   const target=body.availability
   if(target!=='available'&&target!=='offline')return bad('Disponibilidad inválida')
   const {data:driver,error:readError}=await db.from('flashfood_drivers').select('id,active,verified,availability,vehicle_type,vehicle_plate,photo_storage_path').eq('auth_user_id',caller).maybeSingle()
   if(readError)throw readError
   if(!driver)return bad('No existe perfil vinculado a tu cuenta',404)
   if(target==='available'&&(!driver.active||!driver.verified))return bad('El Superadmin debe activar y verificar tu perfil antes de conectarte',403)
   if(target==='available'&&(!driver.photo_storage_path||!driver.vehicle_type||!driver.vehicle_plate))return bad('Sube tu foto y completa el tipo y placa del vehículo para conectarte',409)
   if(driver.availability==='busy')return bad('No puedes cambiar tu disponibilidad durante una entrega asignada',409)
   const {data,error}=await db.from('flashfood_drivers').update({availability:target,updated_at:new Date().toISOString()}).eq('id',driver.id).select('*').single()
   if(error)throw error
   return respond({ok:true,driver:data})
  }
  if(action==='driver_profile'){
   if(!superadmin&&!activeRoles.includes('delivery'))return bad('No autorizado',403)
   const {data,error}=await db.from('flashfood_drivers').select('*').eq('auth_user_id',caller).maybeSingle()
   if(error)throw error
   return respond({ok:true,driver:data})
  }
  return bad('Acción no soportada',404)
 }catch(e){
  const detail=e&&typeof e==='object'?e as Record<string,unknown>:{}
  const code=typeof detail.code==='string'?detail.code:''
  const message=e instanceof Error?e.message:typeof detail.message==='string'?detail.message:''
  console.error('flashfood-role-access',{code,message,details:detail.details,hint:detail.hint})
  if((code==='42P01'||code==='PGRST205'||code==='PGRST116') &&
     /flashfood_business_access|flashfood_business_settings|flashfood_user_roles/.test(message)){
    return bad('Falta una tabla de permisos de FlashFood en Supabase. Comprueba que ejecutaste la migración 20261102180000_flashfood_business_access.sql.',503)
  }
  if((code==='42P01'||code==='PGRST205') && /flashfood_/.test(message)){
    return bad('Falta una tabla de FlashFood requerida por esta operación. Revisa las migraciones en Supabase.',503)
  }
  if(code==='42501'||code==='PGRST301')return bad('La función no tiene permisos para consultar la base de datos. Revisa SUPABASE_SERVICE_ROLE_KEY.',503)
  if(message.includes('Invalid API key')||message.includes('invalid JWT'))return bad('Configuración de autenticación inválida en la Edge Function.',503)
  return bad('Error interno en los permisos de FlashFood. Revisa los logs de la función flashfood-role-access en Supabase.',500)
 }
})
