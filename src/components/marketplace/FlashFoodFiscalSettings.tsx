import { useCallback, useEffect, useState } from 'react'
import { FileLock2, ShieldCheck, Upload, RefreshCw, Save } from 'lucide-react'
import { supabase } from '../../lib/supabase'

type Profile={
 ruc:string;razon_social:string;nombre_comercial:string|null;direccion_matriz:string;
 establecimiento:string;punto_emision:string;ambiente:'pruebas'|'produccion';
 obligado_contabilidad:boolean;contribuyente_especial:string|null;activo:boolean;
 certificate_uploaded_at:string|null;certificate_sha256:string|null
}
type Merchant={id:string;nombre:string;origen:'local'|'multicomercios';negocio_origen_id:string|null;facturacion_flashfood_habilitada:boolean}
const initial:Profile={ruc:'',razon_social:'',nombre_comercial:'',direccion_matriz:'',
 establecimiento:'001',punto_emision:'001',ambiente:'pruebas',obligado_contabilidad:false,
 contribuyente_especial:'',activo:false,certificate_uploaded_at:null,certificate_sha256:null}
export default function FlashFoodFiscalSettings(){
 const [profile,setProfile]=useState<Profile>(initial)
 const [merchants,setMerchants]=useState<Merchant[]>([])
 const [cert,setCert]=useState<File|null>(null)
 const [password,setPassword]=useState('')
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const invoke=async(action:string,params:Record<string,unknown>={})=>{
  const {data,error:callError}=await supabase.functions.invoke('flashfood-fiscal-admin',{body:{action,...params}})
  if(callError)throw new Error(callError.message)
  if(!data?.ok)throw new Error(data?.error||'No se pudo completar')
  return data
 }
 const refresh=useCallback(async()=>{
  try{
   const [fiscal,partners]=await Promise.all([invoke('profile'),invoke('merchant_list')])
   setProfile({...initial,...(fiscal.profile||{})})
   setMerchants(partners.rows||[])
  }catch(e){setError(e instanceof Error?e.message:'No se pudo consultar configuración fiscal')}
 },[])
 useEffect(()=>{queueMicrotask(()=>{void refresh()})},[refresh])
 const run=async(operation:()=>Promise<void>)=>{
  setBusy(true);setError('');setNotice('')
  try{await operation()}catch(e){setError(e instanceof Error?e.message:'Error de configuración')}
  finally{setBusy(false)}
 }
 const save=()=>run(async()=>{
  const result=await invoke('save_profile',{
   ruc:profile.ruc,razon_social:profile.razon_social,nombre_comercial:profile.nombre_comercial,
   direccion_matriz:profile.direccion_matriz,establecimiento:profile.establecimiento,
   punto_emision:profile.punto_emision,ambiente:profile.ambiente,
   obligado_contabilidad:profile.obligado_contabilidad,contribuyente_especial:profile.contribuyente_especial,
  })
  setNotice(String(result.message||'Datos fiscales guardados'))
  await refresh()
 })
 const upload=()=>run(async()=>{
  if(!cert||!password)throw new Error('Selecciona el certificado y escribe su contraseña')
  if(!/\.(p12|pfx)$/i.test(cert.name)||cert.size>3145728)throw new Error('Se admite un archivo PKCS#12 de hasta 3 MB')
  const form=new FormData()
  form.set('action','upload_certificate');form.set('certificate',cert);form.set('password',password)
  try{
   const {data,error:callError}=await supabase.functions.invoke('flashfood-fiscal-admin',{body:form})
   if(callError)throw new Error(callError.message)
   if(!data?.ok)throw new Error(data?.error||'Error al guardar el certificado')
   setCert(null);setPassword('')
   setNotice('Certificado guardado en almacenamiento privado. La emisión sigue desactivada hasta su validación.')
   await refresh()
  }finally{setPassword('')}
 })
 const updateMerchant=(id:string,key:keyof Merchant,value:unknown)=>{
  setMerchants(old=>old.map(x=>x.id===id?{...x,[key]:value}:x))
 }
 const saveMerchant=(m:Merchant)=>run(async()=>{
  await invoke('merchant_save',{local_id:m.id,enabled:m.facturacion_flashfood_habilitada,
   origen:m.origen,negocio_origen_id:m.negocio_origen_id})
  setNotice('Preferencias fiscales del comercio guardadas.')
  await refresh()
 })
 return <section className="space-y-5">
  <div className="rounded-2xl border bg-white p-5">
   <div className="mb-3 flex items-center gap-2"><FileLock2 className="text-orange-500"/><h2 className="text-lg font-extrabold">Facturación de FlashFood</h2></div>
   <p className="text-sm text-slate-600">Los certificados se almacenan en un bucket privado, y la contraseña se cifra en el servidor. Nunca se muestra ni se devuelve al navegador. La emisión sigue bloqueada hasta probar con el SRI.</p>
   {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
   {notice&&<p role="status" className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
   <div className="mt-5 grid gap-4 sm:grid-cols-2">
    {([
     ['ruc','RUC FlashFood'],['razon_social','Razón social'],['nombre_comercial','Nombre comercial'],
     ['direccion_matriz','Dirección matriz'],['establecimiento','Establecimiento (3 dígitos)'],['punto_emision','Punto de emisión (3 dígitos)'],
     ['contribuyente_especial','Resolución contribuyente especial (si aplica)'],
    ] as const).map(([field,label])=><label key={field} className="block text-sm font-semibold">{label}
     <input value={profile[field]||''} onChange={e=>setProfile(old=>({...old,[field]:e.target.value}))}
       maxLength={field==='ruc'?13:field==='establecimiento'||field==='punto_emision'?3:200}
       className="mt-1 w-full rounded-xl border px-3 py-3 font-normal" autoComplete="off"/>
    </label>)}
    <label className="block text-sm font-semibold">Ambiente SRI
     <select value={profile.ambiente} onChange={e=>setProfile(old=>({...old,ambiente:e.target.value as Profile['ambiente']}))} className="mt-1 w-full rounded-xl border px-3 py-3">
      <option value="pruebas">Pruebas</option><option value="produccion">Producción (emisión aún bloqueada)</option>
     </select>
    </label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={profile.obligado_contabilidad}
      onChange={e=>setProfile(old=>({...old,obligado_contabilidad:e.target.checked}))}/>Obligado a llevar contabilidad</label>
   </div>
   <button disabled={busy} onClick={()=>void save()} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50"><Save size={17}/>Guardar datos fiscales</button>
  </div>
  <div className="rounded-2xl border bg-white p-5">
   <h2 className="flex items-center gap-2 font-extrabold"><ShieldCheck className="text-orange-500"/>Firma electrónica</h2>
   <p className="mt-2 text-sm text-slate-600">{profile.certificate_uploaded_at?'Existe un certificado almacenado (cargado '+new Date(profile.certificate_uploaded_at).toLocaleDateString('es-EC')+').':'Todavía no hay certificado almacenado.'}</p>
   <p className="mt-1 text-xs text-amber-700">La firma se registra deshabilitada; cargarla no activa facturas en producción.</p>
   <div className="mt-4 grid gap-3 sm:grid-cols-2">
    <label className="block text-sm font-semibold">Certificado .p12 o .pfx
     <input type="file" accept=".p12,.pfx,application/x-pkcs12" onChange={e=>setCert(e.target.files?.[0]||null)}
      className="mt-2 block w-full text-sm"/>
    </label>
    <label className="block text-sm font-semibold">Contraseña del certificado
     <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
      autoComplete="new-password" className="mt-2 w-full rounded-xl border px-3 py-3"/>
    </label>
   </div>
   <button disabled={busy||!cert||!password||!profile.ruc} onClick={()=>void upload()}
    className="mt-4 inline-flex items-center gap-2 rounded-xl border border-orange-300 px-5 py-3 font-bold text-orange-600 disabled:opacity-40"><Upload size={17}/>Guardar certificado de forma segura</button>
  </div>
  <div className="rounded-2xl border bg-white p-5">
   <div className="flex justify-between gap-2"><h2 className="text-lg font-extrabold">Facturación por negocio</h2><button onClick={()=>void refresh()} aria-label="Actualizar comercios"><RefreshCw size={18}/></button></div>
   <p className="mt-2 text-sm text-slate-600">La habilitación es una preferencia de integración, no activa la emisión automáticamente. Multicomercios mantiene su propia base de datos, certificados y facturador.</p>
   <div className="mt-4 space-y-3">{merchants.map(m=><div key={m.id} className="rounded-xl border p-4">
    <p className="font-semibold">{m.nombre}</p>
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
     <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={m.facturacion_flashfood_habilitada}
      onChange={e=>updateMerchant(m.id,'facturacion_flashfood_habilitada',e.target.checked)}/>Adherido a facturación FlashFood</label>
     <label className="text-sm">Origen del facturador
      <select value={m.origen} onChange={e=>updateMerchant(m.id,'origen',e.target.value)}
       className="mt-1 w-full rounded-lg border p-2"><option value="local">Configuración propia</option><option value="multicomercios">ERP Multicomercios</option></select>
     </label>
     {m.origen==='multicomercios'&&<label className="text-sm sm:col-span-2">ID del negocio en Multicomercios
      <input value={m.negocio_origen_id||''} onChange={e=>updateMerchant(m.id,'negocio_origen_id',e.target.value)}
       className="mt-1 w-full rounded-lg border p-2" placeholder="UUID del negocio en xzngpapmyqkssdzbclpc"/>
     </label>}
    </div>
    <button disabled={busy} onClick={()=>void saveMerchant(m)} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Guardar configuración del negocio</button>
   </div>)}</div>
  </div>
 </section>
}
