import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike, MapPin, RefreshCw, ShoppingBag } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Order={
 id:string;created_at:string;status:string;payment_status:string;payment_method:string;
 total:number;delivery_fee:number;branch_id:string;modality:string;
 route_km:number|null;assigned_driver_id:string|null;address_snapshot:Record<string,unknown>|null
}
type Position={latitude:number;longitude:number;accuracy_m:number|null;recorded_at:string}
const labels:Record<string,string>={
 pending_payment:'Pendiente de pago',placed:'Recibido',assigned:'Repartidor asignado',
 accepted:'Repartidor aceptó',picked_up:'En camino',delivered:'Entregado',cancelled:'Cancelado',
}
const format=(x:number)=>new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(x)
export default function PedidosPage(){
 const [orders,setOrders]=useState<Order[]>([])
 const [error,setError]=useState('')
 const [loading,setLoading]=useState(false)
 const [tracking,setTracking]=useState<Record<string,Position>>({})
 const refresh=useCallback(async()=>{
  setLoading(true)
  try{
   const {data,error:callError}=await supabase.functions.invoke('flashfood-mobile-orders',{body:{action:'list'}})
   if(callError)throw new Error(callError.message)
   if(!data?.ok)throw new Error(data?.error||'No se pudieron consultar los pedidos')
   const rows=data.orders as Order[]
   setOrders(rows)
   const active=rows.filter(x=>['accepted','picked_up'].includes(x.status))
   const positions:Record<string,Position>={}
   await Promise.all(active.map(async x=>{
    const result=await supabase.functions.invoke('flashfood-mobile-orders',{body:{action:'status',order_id:x.id}})
    if(result.data?.ok && result.data.position)positions[x.id]=result.data.position
   }))
   setTracking(positions)
   setError('')
  }catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar el historial')}
  finally{setLoading(false)}
 },[])
 useEffect(()=>{
  queueMicrotask(()=>{void refresh()})
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},20000)
  return ()=>window.clearInterval(timer)
 },[refresh])
 return <main className="mx-auto max-w-3xl px-4 pb-36 pt-7">
  <div className="mb-6 flex items-center justify-between gap-3">
   <div><h1 className="text-2xl font-extrabold">Mis pedidos</h1><p className="text-sm text-gray-500">Estado de compras y entregas</p></div>
   <button type="button" disabled={loading} onClick={()=>void refresh()} className="rounded-xl bg-white p-3" aria-label="Actualizar pedidos"><RefreshCw size={19} className={loading?'animate-spin':''}/></button>
  </div>
  {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
  {!orders.length&&!loading&&<div className="rounded-2xl bg-white p-8 text-center"><ShoppingBag className="mx-auto text-orange-500"/><p className="mt-3 font-bold">Todavía no tienes pedidos.</p><Link to="/" className="mt-4 inline-block font-semibold text-orange-600">Explorar restaurantes</Link></div>}
  <div className="space-y-3">
  {orders.map(o=>{
   const p=tracking[o.id]
   const nav=p?`https://www.google.com/maps/search/?api=1&query=${p.latitude},${p.longitude}`:null
   return <article key={o.id} className="rounded-2xl bg-white p-5 shadow-sm">
    <div className="flex justify-between gap-3"><div><p className="text-xs text-gray-400">Pedido {o.id.slice(0,8).toUpperCase()}</p><h2 className="mt-1 font-extrabold">{labels[o.status]||o.status}</h2></div><span className="text-lg font-extrabold">{format(Number(o.total))}</span></div>
    <p className="mt-2 text-xs text-gray-500">{new Date(o.created_at).toLocaleString('es-EC')} · {o.modality==='domicilio'?'Entrega a domicilio':'Retiro o consumo'}</p>
    {o.payment_status!=='paid'&&<p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Pago: {o.payment_method==='transferencia'?'Transferencia pendiente de verificación':o.payment_method==='tarjeta'?'Confirmación PayPhone pendiente':'Cobro pendiente al recibir o retirar'}</p>}
    {o.modality==='domicilio'&&<p className="mt-3 flex items-center gap-2 text-sm"><Bike size={16} className="text-orange-500"/>{o.assigned_driver_id?'Repartidor asignado':'Pendiente de asignación'}</p>}
    {o.address_snapshot&&<p className="mt-2 flex items-start gap-2 text-sm text-gray-600"><MapPin size={16} className="shrink-0 text-orange-500"/>{String(o.address_snapshot.address_line||'')} · {String(o.address_snapshot.city||'')}</p>}
    {p&&<div className="mt-3 rounded-xl bg-orange-50 p-3 text-sm"><p className="font-bold text-orange-800">Última ubicación compartida</p><p className="mt-1 text-xs text-orange-900">{new Date(p.recorded_at).toLocaleString('es-EC')} · precisión aprox. {Math.round(p.accuracy_m||0)} m</p>{nav&&<a href={nav} target="_blank" rel="noreferrer" className="mt-2 inline-block font-bold text-orange-700">Ver ubicación en el mapa</a>}</div>}
   </article>
  })}
  </div>
  <p className="mt-5 text-xs text-gray-400">El seguimiento depende de que el repartidor haya aceptado el pedido y tenga abierta la aplicación con permiso de ubicación.</p>
 </main>
}
