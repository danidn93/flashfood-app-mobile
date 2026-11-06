import {useCallback,useEffect,useState} from 'react'
import {Bell,Check,RefreshCw,ShoppingBag} from 'lucide-react'
import {roleRequest} from '../../services/roles'
import FlashFoodOrderChat from './FlashFoodOrderChat'
type Order={id:string;order_number:number;mobile_branch_id:string;status:string;fulfillment:string;payment_method:string;payment_status:string;products_total:number;created_at:string}
type Alert={id:string;order_id:string;title:string;message:string;read_at:string|null;created_at:string}
const usd=(n:number)=>new Intl.NumberFormat('es-EC',{currency:'USD',style:'currency'}).format(n)
export default function FlashFoodMerchantOrders({businessId}:{businessId:string}){
 const [orders,setOrders]=useState<Order[]>([])
 const [alerts,setAlerts]=useState<Alert[]>([])
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(false)
 const [selected,setSelected]=useState('')
 const [progress,setProgress]=useState<Record<string,string>>({})
 const [saving,setSaving]=useState(false)
 const refresh=useCallback(async()=>{
  setLoading(true)
  try{
   const [o,a]=await Promise.all([
    roleRequest<{orders:Order[]}>('merchant_orders',{business_id:businessId}),
    roleRequest<{alerts:Alert[]}>('merchant_alerts',{business_id:businessId})
   ])
   setOrders(o.orders||[]);setAlerts(a.alerts||[]);setError('')
   const stages:Record<string,string>={}
   await Promise.all((o.orders||[]).map(async order=>{
     try{
       const result=await roleRequest<{stage:string}>('merchant_chat_list',{order_id:order.id})
       stages[order.id]=result.stage||'recibido'
     }catch{stages[order.id]='recibido'}
   }))
   setProgress(stages)
  }catch(e){setError(e instanceof Error?e.message:'No se pudieron consultar los pedidos')}
  finally{setLoading(false)}
 },[businessId])
 useEffect(()=>{
  queueMicrotask(()=>{void refresh()})
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},15000)
  return ()=>window.clearInterval(timer)
 },[refresh])
 const markRead=async(id:string)=>{
  try{
   await roleRequest('merchant_alert_read',{alert_id:id})
   setAlerts(old=>old.map(a=>a.id===id?{...a,read_at:new Date().toISOString()}:a))
  }catch(e){setError(e instanceof Error?e.message:'No se pudo marcar la alerta')}
 }
 const advance=async(orderId:string,stage:string)=>{
   setSaving(true);setError('')
   try{
     await roleRequest('merchant_stage',{order_id:orderId,stage})
     await refresh()
   }catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar la preparación')}
   finally{setSaving(false)}
 }
 const stageName:Record<string,string>={recibido:'Recibido',preparando:'Preparando',listo:'Listo',
  asignando:'En asignación de delivery',retirando:'Retirando el pedido',reparto:'En reparto',
  entregado:'Entregado',cancelado:'Cancelado'}
 return <section className="space-y-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-extrabold">Pedidos FlashFood</h2><p className="text-sm text-slate-500">Compras de tus sucursales, actualizadas cada 15 segundos</p></div><button type="button" disabled={loading} onClick={()=>void refresh()} className="rounded-xl border bg-white p-3" aria-label="Actualizar pedidos"><RefreshCw size={18} className={loading?'animate-spin':''}/></button></div>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  <div className="rounded-2xl border bg-white p-4"><h3 className="flex items-center gap-2 font-bold"><Bell size={18}/>Avisos de compras {alerts.filter(a=>!a.read_at).length>0?`· ${alerts.filter(a=>!a.read_at).length} nuevos`:''}</h3>
   {!alerts.length&&<p className="mt-2 text-sm text-slate-500">No hay avisos pendientes.</p>}
   <div className="mt-3 space-y-2">{alerts.slice(0,12).map(a=><div key={a.id} className="flex justify-between gap-3 rounded-xl bg-slate-50 p-3"><div><p className="font-semibold">{a.title}</p><p className="text-sm text-slate-600">{a.message}</p><p className="mt-1 text-xs text-slate-400">{new Date(a.created_at).toLocaleString('es-EC')}</p></div>{!a.read_at&&<button type="button" aria-label="Marcar como leído" onClick={()=>void markRead(a.id)} className="self-start rounded-lg border bg-white p-2"><Check size={16}/></button>}</div>)}</div>
  </div>
  <div className="rounded-2xl border bg-white p-4"><h3 className="flex items-center gap-2 font-bold"><ShoppingBag size={18}/>Compras registradas</h3>
   {!orders.length&&<p className="mt-3 text-sm text-slate-500">Todavía no hay compras de FlashFood.</p>}
   <div className="mt-3 space-y-2">{orders.map(o=><div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><div><p className="text-xs text-slate-400">Pedido #{o.order_number} · {new Date(o.created_at).toLocaleString('es-EC')}</p><p className="mt-1 font-semibold">{stageName[progress[o.id]]||'Recibido'} · {o.fulfillment==='delivery'?'Domicilio':'Retiro'}</p><p className="text-xs text-slate-500">Pago: {o.payment_method} / {o.payment_status}</p></div>
 <div className="flex flex-wrap items-center gap-2"><strong>{usd(Number(o.products_total))}</strong>
 {['recibido','preparando'].includes(progress[o.id]||'recibido')&&<button disabled={saving} onClick={()=>void advance(o.id,progress[o.id]==='preparando'?'listo':'preparando')} className="rounded-lg bg-orange-500 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{progress[o.id]==='preparando'?'Marcar listo':'Iniciar preparación'}</button>}
 <button onClick={()=>setSelected(old=>old===o.id?'':o.id)} className="rounded-lg border px-3 py-2 text-xs">{selected===o.id?'Cerrar chat':'Abrir chat'}</button>
 </div>{selected===o.id&&<div className="w-full"><FlashFoodOrderChat orderId={o.id} merchant/></div>}</div>)}</div>
  </div>
 </section>
}
