import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Truck, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
type Order={id:string;status:string;payment_method:string;payment_status:string;total:number;modality:string;created_at:string;assigned_driver_id:string|null}
const money=(n:number)=>new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(n)
export default function FlashFoodMobileOperations(){
 const [orders,setOrders]=useState<Order[]>([])
 const [loading,setLoading]=useState(false)
 const [action,setAction]=useState('')
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const call=async(action:string,args:Record<string,unknown>={})=>{
  const {data,error:callError}=await supabase.functions.invoke('flashfood-mobile-orders',{body:{action,...args}})
  if(callError)throw new Error(callError.message)
  if(!data?.ok)throw new Error(data?.error||'No se pudo completar la operación')
  return data
 }
 const load=useCallback(async()=>{
  setLoading(true);setError('')
  try{const data=await call('list',{scope:'all'});setOrders(data.orders||[])}
  catch(e){setError(e instanceof Error?e.message:'No se pudo consultar pedidos')}
  finally{setLoading(false)}
 },[])
 useEffect(()=>{void load()},[load])
 const dispatch=async()=>{
  setAction('dispatch');setError('');setNotice('')
  try{const r=await call('dispatch_pending');setNotice('Pedidos asignados: '+r.assigned);await load()}
  catch(e){setError(e instanceof Error?e.message:'No se pudo despachar')}
  finally{setAction('')}
 }
 const approve=async(id:string)=>{
  if(!window.confirm('Confirma que verificaste la transferencia directamente en tu banco. ¿Aprobar este pago?'))return
  setAction(id);setError('');setNotice('')
  try{await call('verify_transfer',{order_id:id,approved:true});setNotice('Transferencia verificada y pedido habilitado.');await load()}
  catch(e){setError(e instanceof Error?e.message:'No se pudo aprobar')}
  finally{setAction('')}
 }
 return <section className="mt-5 rounded-2xl border bg-white p-5">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div><h2 className="text-lg font-bold">Operaciones FlashFood Mobile</h2><p className="text-xs text-gray-500">Pedidos creados por la app, despacho y conciliación manual</p></div>
   <div className="flex gap-2">
    <button disabled={loading||!!action} onClick={()=>void load()} className="rounded-xl border p-3" aria-label="Actualizar"><RefreshCw size={17}/></button>
    <button disabled={loading||!!action} onClick={()=>void dispatch()} className="flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-bold text-white disabled:opacity-40"><Truck size={17}/>Despachar pendientes</button>
   </div>
  </div>
  {error&&<p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="mt-3 rounded-xl bg-green-50 p-3 text-sm text-green-700">{notice}</p>}
  <div className="mt-4 space-y-2">
   {!orders.length&&!loading&&<p className="text-sm text-gray-500">No hay pedidos de la app registrados.</p>}
   {orders.map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
    <div><p className="text-xs text-gray-400">{o.id.slice(0,8)} · {new Date(o.created_at).toLocaleString('es-EC')}</p>
     <p className="font-bold">{o.status} · {o.modality} · {money(Number(o.total))}</p>
     <p className="text-xs text-gray-500">Pago: {o.payment_method} / {o.payment_status} · {o.assigned_driver_id?'Repartidor asignado':'Sin repartidor'}</p>
    </div>
    {o.payment_method==='transferencia'&&o.payment_status==='awaiting_verification'&&<button disabled={!!action} onClick={()=>void approve(o.id)} className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Wallet size={16}/>Verifiqué transferencia</button>}
   </div>)}
  </div>
  <p className="mt-4 text-xs text-amber-700">PayPhone requiere confirmación externa comprobada. No marcar pagos con tarjeta como pagados sin conciliación con el proveedor.</p>
 </section>
}
