import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
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
   const {data:old,error:oldErr}=await db.from('flashfood_business_access').select('id').eq('user_id',target.id).eq('business_id',businessId).eq('role',role).is('branch_id',branch).maybeSingle()
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
  if(action==='driver_profile'){
   if(!superadmin&&!activeRoles.includes('delivery'))return bad('No autorizado',403)
   const {data,error}=await db.from('flashfood_drivers').select('*').eq('user_id',caller).maybeSingle()
   if(error)throw error
   return respond({ok:true,driver:data})
  }
  return bad('Acción no soportada',404)
 }catch(e){console.error('flashfood-role-access',e);return bad(e instanceof Error?e.message:'Error de acceso',500)}
})
