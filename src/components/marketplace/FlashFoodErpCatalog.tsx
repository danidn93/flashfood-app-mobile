import {useCallback,useEffect,useState} from 'react'
import {RefreshCw,Store,AlertCircle} from 'lucide-react'
import {supabase} from '../../lib/supabase'
type Branch={erp_branch_id:string;sucursal_id:string;published:boolean;accepting_orders:boolean;last_synced_at:string}
type Business={id:string;nombre:string;nombre_comercial:string|null;flashfood_catalogo_habilitado:boolean;local_id:string|null;synced_at:string|null;branches:Branch[]}
async function request(action:string,params:Record<string,unknown>={}):Promise<Record<string,unknown>>{
 const {data,error}=await supabase.functions.invoke('flashfood-catalog-sync',{body:{action,...params}})
 if(error)throw new Error(error.message)
 if(!data?.ok)throw new Error(data?.error||'Error de sincronización')
 return data as Record<string,unknown>
}
export default function FlashFoodErpCatalog(){
 const [businesses,setBusinesses]=useState<Business[]>([])
 const [loading,setLoading]=useState(false)
 const [busy,setBusy]=useState<string|null>(null)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const refresh=useCallback(async()=>{
  setLoading(true);setError('')
  try{
   const result=await request('list')
   setBusinesses(Array.isArray(result.businesses)?result.businesses as Business[]:[])
  }catch(e){setError(e instanceof Error?e.message:'No se pudo consultar el catálogo')}
  finally{setLoading(false)}
 },[])
 useEffect(()=>{queueMicrotask(()=>{void refresh()})},[refresh])
 const sync=async(id:string)=>{
  setBusy(id);setError('');setNotice('')
  try{
   const result=await request('sync',{business_id:id})
   setNotice(result.disabled?'El negocio fue retirado del catálogo público.':'Catálogo sincronizado correctamente con Multicomercios.')
   await refresh()
  }catch(e){setError(e instanceof Error?e.message:'Falló la sincronización')}
  finally{setBusy(null)}
 }
 const update=async(b:Branch,published:boolean,accepting_orders:boolean)=>{
  setBusy(b.erp_branch_id);setError('');setNotice('')
  try{
   await request('branch_update',{branch_id:b.erp_branch_id,published,accepting_orders})
   setNotice('Visibilidad de sucursal actualizada.')
   await refresh()
  }catch(e){setError(e instanceof Error?e.message:'No se pudo modificar la sucursal')}
  finally{setBusy(null)}
 }
 return <div className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-xl font-extrabold">Catálogo de Multicomercios</h2>
    <p className="mt-1 text-sm text-slate-500">Los precios, productos y existencias se leen del ERP. Solo se sincronizan negocios autorizados.</p>
   </div>
   <button disabled={loading||!!busy} onClick={()=>void refresh()} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm font-semibold"><RefreshCw size={16}/>Actualizar</button>
  </div>
  {error&&<div role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18}/>{error}</div>}
  {notice&&<p role="status" className="rounded-xl bg-slate-100 p-3 text-sm">{notice}</p>}
  {!businesses.length&&!loading&&<p className="rounded-xl border bg-white p-4 text-sm text-slate-500">No hay negocios ERP accesibles desde el puente.</p>}
  {businesses.map(b=><section key={b.id} className="rounded-2xl border bg-white p-4 shadow-sm">
   <div className="flex flex-wrap items-center justify-between gap-4">
    <div className="flex items-start gap-3"><Store size={22} className="mt-1 text-orange-500"/><div>
     <h3 className="font-bold">{b.nombre_comercial||b.nombre}</h3>
     <p className="text-xs text-slate-500">ERP: {b.id}</p>
     <p className="mt-1 text-xs">{b.flashfood_catalogo_habilitado?'Autorizado desde Multicomercios':'Deshabilitado en Multicomercios'} · {b.synced_at?'Última sincronización: '+new Date(b.synced_at).toLocaleString('es-EC'):'Sin sincronizar'}</p>
    </div></div>
    <button type="button" disabled={!!busy||loading} onClick={()=>void sync(b.id)} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
     {busy===b.id?'Sincronizando…':b.flashfood_catalogo_habilitado?'Sincronizar catálogo':'Retirar del catálogo'}
    </button>
   </div>
   {b.branches.length>0&&<div className="mt-4 space-y-2 border-t pt-4">{b.branches.map(branch=><div key={branch.erp_branch_id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
    <div className="min-w-0"><p className="text-sm font-semibold">Sucursal ERP: {branch.erp_branch_id.slice(0,8)}</p><p className="text-xs text-slate-500">FlashFood: {branch.sucursal_id.slice(0,8)}</p></div>
    <div className="flex gap-3">
     <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={branch.published} disabled={!!busy} onChange={e=>void update(branch,e.target.checked,e.target.checked?branch.accepting_orders:false)}/>Visible</label>
     <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={branch.accepting_orders} disabled={!!busy||!branch.published} onChange={e=>void update(branch,branch.published,e.target.checked)}/>Acepta pedidos</label>
    </div>
   </div>)}</div>}
  </section>)}
  <p className="text-xs text-slate-500">La sincronización es manual: ejecútala nuevamente cuando cambien precios o inventarios. Antes de habilitar entregas a domicilio, configura las coordenadas reales de cada sucursal.</p>
 </div>
}
