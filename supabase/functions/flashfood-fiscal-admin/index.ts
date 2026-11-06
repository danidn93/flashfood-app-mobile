import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (value: Record<string,unknown>, status=200) =>
  new Response(JSON.stringify(value),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})
const fail = (message:string,status=400)=>json({ok:false,error:message},status)
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
const txt=(value:unknown,max=200)=>typeof value==='string'?value.trim().slice(0,max):''
const base64=(buf:Uint8Array)=>btoa(String.fromCharCode(...buf))
const toHex=(buf:ArrayBuffer)=>Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('')
const readKey=async()=>{
  const hex=Deno.env.get('FLASHFOOD_FISCAL_ENCRYPTION_KEY')||''
  if(!/^[a-f0-9]{64}$/i.test(hex))throw new Error('No se ha configurado FLASHFOOD_FISCAL_ENCRYPTION_KEY (32 bytes hex).')
  const raw=new Uint8Array(hex.match(/.{2}/g)!.map(v=>parseInt(v,16)))
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt'])
}
const encrypt=async(password:string)=>{
  const iv=crypto.getRandomValues(new Uint8Array(12))
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},await readKey(),new TextEncoder().encode(password))
  return {iv:base64(iv),ciphertext:base64(new Uint8Array(encrypted))}
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers:cors})
  if(req.method!=='POST')return fail('Método no permitido',405)
  try{
    const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if(!url||!anon||!service)return fail('Configuración Supabase incompleta',503)
    const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'')
    if(!token)return fail('Requiere sesión',401)
    const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:auth,error:authError}=await authClient.auth.getUser(token)
    if(authError||!auth.user)return fail('Sesión inválida',401)
    const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:roles,error:rolesError}=await db.from('flashfood_user_roles').select('id')
      .eq('user_id',auth.user.id).eq('role','superadmin').eq('active',true).limit(1)
    if(rolesError)throw rolesError
    if(!roles?.length)return fail('Solo Superadmin puede configurar los datos fiscales.',403)
    const contentType=req.headers.get('Content-Type')||''
    if(contentType.includes('multipart/form-data')){
      const form=await req.formData()
      if(form.get('action')!=='upload_certificate')return fail('Acción inválida')
      const file=form.get('certificate'),password=form.get('password')
      if(!(file instanceof File)||typeof password!=='string'||password.length<1||password.length>256)
        return fail('Selecciona un certificado .p12/.pfx y escribe su contraseña')
      if(!/\.(p12|pfx)$/i.test(file.name)||file.size>3145728||file.size<100)
        return fail('Solo certificados PKCS#12 de hasta 3 MB')
      const {data:profile,error:profileError}=await db.from('flashfood_platform_fiscal_profile')
        .select('ruc,certificate_storage_path').eq('singleton',true).maybeSingle()
      if(profileError)throw profileError
      if(!profile)return fail('Guarda primero la configuración fiscal de FlashFood',409)
      const bytes=new Uint8Array(await file.arrayBuffer())
      // Password never logged, never returned, never stored in plaintext.
      const digest=toHex(await crypto.subtle.digest('SHA-256',bytes))
      const encrypted=await encrypt(password)
      const path=`platform/${profile.ruc}/${crypto.randomUUID()}.p12`
      const {error:uploadError}=await db.storage.from('flashfood-fiscal-private')
        .upload(path,bytes,{contentType:'application/octet-stream',upsert:false})
      if(uploadError)throw uploadError
      const {error:saveError}=await db.from('flashfood_platform_fiscal_profile').update({
        certificate_storage_path:path,certificate_sha256:digest,
        certificate_password_ciphertext:encrypted.ciphertext,certificate_password_iv:encrypted.iv,
        certificate_uploaded_at:new Date().toISOString(),activo:false,
        updated_at:new Date().toISOString(),updated_by:auth.user.id,
      }).eq('singleton',true)
      if(saveError){
        await db.storage.from('flashfood-fiscal-private').remove([path])
        throw saveError
      }
      // Delete previous object only after successfully saving new metadata.
      if(profile.certificate_storage_path&&profile.certificate_storage_path!==path)
        await db.storage.from('flashfood-fiscal-private').remove([profile.certificate_storage_path])
      return json({ok:true,sha256:digest,certificate_uploaded:true,
        message:'Certificado guardado cifrado y desactivado. La emisión permanece bloqueada hasta validación SRI.'})
    }
    const payload=await req.json().catch(()=>({})) as Record<string,unknown>
    const action=txt(payload.action,60)
    if(action==='profile'){
      const {data,error}=await db.from('flashfood_platform_fiscal_profile')
        .select('ruc,razon_social,nombre_comercial,direccion_matriz,establecimiento,punto_emision,ambiente,obligado_contabilidad,contribuyente_especial,activo,certificate_sha256,certificate_uploaded_at')
        .eq('singleton',true).maybeSingle()
      if(error)throw error
      return json({ok:true,profile:data})
    }
    if(action==='save_profile'){
      const ruc=txt(payload.ruc,13),razon=txt(payload.razon_social,200),direccion=txt(payload.direccion_matriz,500)
      const establecimiento=txt(payload.establecimiento,3),punto=txt(payload.punto_emision,3)
      if(!/^\d{13}$/.test(ruc)||razon.length<3||!direccion||!/^\d{3}$/.test(establecimiento)||!/^\d{3}$/.test(punto))
        return fail('Verifica RUC, razón social, dirección y códigos de emisión.')
      const ambiente=payload.ambiente==='produccion'?'produccion':'pruebas'
      const {data:current,error:currentError}=await db.from('flashfood_platform_fiscal_profile')
        .select('ruc').eq('singleton',true).maybeSingle()
      if(currentError)throw currentError
      if(current&&current.ruc!==ruc)return fail('El RUC existente no puede cambiarse sin un procedimiento de rotación fiscal.',409)
      const row={
        singleton:true,ruc,razon_social:razon,nombre_comercial:txt(payload.nombre_comercial,200)||null,
        direccion_matriz:direccion,establecimiento,punto_emision:punto,
        ambiente,obligado_contabilidad:payload.obligado_contabilidad===true,
        contribuyente_especial:txt(payload.contribuyente_especial,100)||null,
        activo:false,updated_by:auth.user.id,updated_at:new Date().toISOString(),
      }
      const {error}=await db.from('flashfood_platform_fiscal_profile')
        .upsert(row,{onConflict:'singleton'})
      if(error)throw error
      return json({ok:true,message:'Datos fiscales guardados. Emisión desactivada hasta pruebas del SRI.'})
    }
    if(action==='invoice_queue'){
      const {data,error}=await db.from('flashfood_invoices')
        .select('id,order_id,issuer_type,source_local_id,remote_erp_business_id,remote_erp_sale_id,sri_status,attempt_count,last_error,created_at')
        .order('created_at',{ascending:false}).limit(100)
      if(error)throw error
      return json({ok:true,rows:(data||[]).map(item=>({...item,status:item.sri_status}))})
    }
    if(action==='branch_list'){
      const {data:catalog,error:catalogError}=await db.rpc('flashfood_catalogo_restaurantes',{p_app_codigo:'flashfood_mobile'})
      if(catalogError)throw catalogError
      const {data:links,error:linksError}=await db.from('flashfood_erp_branch_links').select('*')
      if(linksError)throw linksError
      const mapped=new Map((links||[]).map(x=>[x.flashfood_branch_id,x]))
      return json({ok:true,rows:(Array.isArray(catalog)?catalog:[]).map(item=>({
        flashfood_branch_id:item.sucursal_id,
        flashfood_local_id:item.local_id,
        name:item.sucursal||item.nombre||item.restaurante||String(item.sucursal_id).slice(0,8),
        erp_business_id:mapped.get(item.sucursal_id)?.erp_business_id||'',
        erp_branch_id:mapped.get(item.sucursal_id)?.erp_branch_id||'',
      }))})
    }
    if(action==='branch_save'){
      if(!uuid(payload.branch_id)||!uuid(payload.local_id)||!uuid(payload.erp_business_id)||!uuid(payload.erp_branch_id))
        return fail('Todos los identificadores de negocio y sucursal deben ser UUID válidos')
      const {data:catalog,error:catalogError}=await db.rpc('flashfood_catalogo_restaurantes',{p_app_codigo:'flashfood_mobile'})
      if(catalogError)throw catalogError
      const valid=(Array.isArray(catalog)?catalog:[]).some(x=>x.sucursal_id===payload.branch_id&&x.local_id===payload.local_id)
      if(!valid)return fail('La sucursal no corresponde a ese local en FlashFood')
      const {data:merchant,error:merchantError}=await db.from('flashfood_merchant_fiscal_settings')
        .select('negocio_origen_id,origen,facturacion_flashfood_habilitada')
        .eq('local_id',payload.local_id).maybeSingle()
      if(merchantError)throw merchantError
      if(!merchant?.facturacion_flashfood_habilitada||merchant.origen!=='multicomercios'
        ||merchant.negocio_origen_id!==payload.erp_business_id)
        return fail('Primero habilita el negocio con el UUID correcto de Multicomercios')
      const {error}=await db.from('flashfood_erp_branch_links').upsert({
        flashfood_branch_id:payload.branch_id,flashfood_local_id:payload.local_id,
        erp_business_id:payload.erp_business_id,erp_branch_id:payload.erp_branch_id,
        updated_at:new Date().toISOString(),updated_by:auth.user.id,
      },{onConflict:'flashfood_branch_id'})
      if(error)throw error
      return json({ok:true})
    }
    if(action==='merchant_list'){
      const {data:locals,error:localsError}=await db.from('locales').select('id,nombre').order('nombre').limit(1000)
      if(localsError)throw localsError
      const {data:settings,error:settingsError}=await db.from('flashfood_merchant_fiscal_settings').select('*')
      if(settingsError)throw settingsError
      const byLocal=new Map((settings||[]).map(x=>[x.local_id,x]))
      return json({ok:true,rows:(locals||[]).map(x=>({...x,
        facturacion_flashfood_habilitada:byLocal.get(x.id)?.facturacion_flashfood_habilitada||false,
        origen:byLocal.get(x.id)?.origen||'local',
        negocio_origen_id:byLocal.get(x.id)?.negocio_origen_id||null,
      }))})
    }
    if(action==='merchant_save'){
      if(!uuid(payload.local_id))return fail('Local inválido')
      const {data:local,error:localError}=await db.from('locales').select('id').eq('id',payload.local_id).maybeSingle()
      if(localError)throw localError
      if(!local)return fail('Local no encontrado',404)
      const origen=payload.origen==='multicomercios'?'multicomercios':'local'
      if(origen==='multicomercios'&&!uuid(payload.negocio_origen_id))return fail('Indica el ID del negocio en Multicomercios')
      const {error}=await db.from('flashfood_merchant_fiscal_settings').upsert({
        local_id:payload.local_id,
        facturacion_flashfood_habilitada:payload.enabled===true,
        origen,negocio_origen_id:origen==='multicomercios'?payload.negocio_origen_id:null,
        updated_by:auth.user.id,updated_at:new Date().toISOString(),
      },{onConflict:'local_id'})
      if(error)throw error
      return json({ok:true})
    }
    return fail('Acción no soportada',404)
  }catch(error){
    const message=error instanceof Error?error.message:'Operación fallida'
    console.error('flashfood-fiscal-admin',message)
    return fail(message,500)
  }
})
