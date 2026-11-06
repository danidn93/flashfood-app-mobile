import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}
const respond=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json','Cache-Control':'no-store'}})
const fail=(message:string,status=400)=>respond({ok:false,error:message},status)
const uuid=(x:unknown):x is string=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
const config=()=>{
 const endpoint=Deno.env.get('MULTICOMERCIOS_BRIDGE_URL')||''
 const token=Deno.env.get('MULTICOMERCIOS_BRIDGE_TOKEN')||''
 if(!/^https:\/\//.test(endpoint)||token.length<48)throw new Error('Configura el puente seguro hacia Multicomercios')
 return {endpoint,token}
}
async function erp(action:'catalog_businesses'|'catalog_export',businessId?:string){
 const {endpoint,token}=config()
 const response=await fetch(endpoint,{
  method:'POST',headers:{authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({action,business_id:businessId}),signal:AbortSignal.timeout(30000),
 })
 const data=await response.json().catch(()=>({})) as Record<string,unknown>
 if(!response.ok||data.ok!==true)throw new Error(String(data.error||'No se pudo consultar catálogo ERP'))
 return data
}
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers})
 if(req.method!=='POST')return fail('Método no permitido',405)
 try{
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if(!url||!anon||!service)return fail('Secrets Supabase incompletos',503)
  const jwt=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'')
  if(!jwt)return fail('Inicia sesión como Superadmin',401)
  const {data:auth,error:authError}=await createClient(url,anon).auth.getUser(jwt)
  if(authError||!auth.user)return fail('Sesión inválida',401)
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:roles,error:roleError}=await db.from('flashfood_user_roles')
   .select('id').eq('user_id',auth.user.id).eq('role','superadmin').eq('active',true).limit(1)
  if(roleError)throw roleError
  if(!roles?.length)return fail('Solo Superadmin puede sincronizar catálogos',403)
  const body=await req.json().catch(()=>({})) as Record<string,unknown>
  const action=String(body.action||'list')
  if(action==='list'){
   const [remote,local]=await Promise.all([
    erp('catalog_businesses'),
    db.from('flashfood_erp_catalog_businesses')
     .select('erp_business_id,local_id,last_synced_at'),
   ])
   if(local.error)throw local.error
   const {data:branches,error:branchesError}=await db.from('flashfood_erp_catalog_branches')
    .select('erp_business_id,erp_branch_id,sucursal_id,published,accepting_orders,last_synced_at')
   if(branchesError)throw branchesError
   const synced=new Map((local.data||[]).map(b=>[b.erp_business_id,b]))
   return respond({ok:true,businesses:(Array.isArray(remote.businesses)?remote.businesses:[]).map((item)=>{
    const b=item as Record<string,unknown>,id=String(b.id)
    return {...b,local_id:synced.get(id)?.local_id||null,
      synced_at:synced.get(id)?.last_synced_at||null,
      branches:(branches||[]).filter(x=>x.erp_business_id===id)}
   })})
  }
  if(action==='sync'){
   if(!uuid(body.business_id))return fail('ID ERP inválido')
   // Always check the current opt-in at the ERP before importing; no unapproved source.
   const remote=await erp('catalog_businesses')
   const enabled=(Array.isArray(remote.businesses)?remote.businesses:[])
     .find((b)=>b && typeof b==='object' && (b as Record<string,unknown>).id===body.business_id) as Record<string,unknown>|undefined
   if(!enabled)return fail('Negocio no disponible en ERP',404)
   if(enabled.flashfood_catalogo_habilitado!==true){
    const {data:existing,error:findError}=await db.from('flashfood_erp_catalog_businesses')
      .select('erp_business_id').eq('erp_business_id',body.business_id).maybeSingle()
    if(findError)throw findError
    if(existing){
      const {error}=await db.from('flashfood_erp_catalog_branches')
       .update({published:false,accepting_orders:false,last_synced_at:new Date().toISOString()})
       .eq('erp_business_id',body.business_id)
      if(error)throw error
    }
    return respond({ok:true,disabled:true,branches:0,product_links:0})
   }
   const payload=await erp('catalog_export',body.business_id)
   const {data,error}=await db.rpc('flashfood_erp_import_catalog',{p_payload:payload})
   if(error)throw error
   return respond({ok:true,result:data})
  }
  if(action==='branch_update'){
   if(!uuid(body.branch_id)||typeof body.published!=='boolean'||typeof body.accepting_orders!=='boolean')
    return fail('Datos de publicación inválidos')
   if(body.accepting_orders===true&&body.published!==true)
    return fail('No se pueden aceptar pedidos de una sucursal oculta')
   const {data,error}=await db.from('flashfood_erp_catalog_branches')
    .update({published:body.published,accepting_orders:body.accepting_orders,last_synced_at:new Date().toISOString()})
    .eq('erp_branch_id',body.branch_id).select('erp_branch_id,published,accepting_orders').maybeSingle()
   if(error)throw error
   if(!data)return fail('Sucursal ERP no encontrada',404)
   return respond({ok:true,branch:data})
  }
  return fail('Acción no soportada',404)
 }catch(error){
  console.error('flashfood-catalog-sync',error instanceof Error?error.message:'Error')
  return fail(error instanceof Error?error.message:'Error de sincronización',500)
 }
})
