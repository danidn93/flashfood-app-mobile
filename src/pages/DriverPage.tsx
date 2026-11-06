import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike, CheckCircle2, CircleOff, LocateFixed, MapPin, RefreshCw, ShieldAlert } from 'lucide-react'
import { roleRequest } from '../services/roles'
import { supabase } from '../lib/supabase'

type Driver={id:string;full_name:string;phone:string|null;vehicle_type:string|null;availability:'offline'|'available'|'busy';active:boolean;verified:boolean}
type Order={id:string;payment_method:string;status:'assigned'|'accepted'|'picked_up';address_snapshot:Record<string,unknown>|null;route_km:number|null;total:number;created_at:string}
const statusText={offline:'Desconectado',available:'Disponible',busy:'Ocupado'}
const next:Record<string,{status:'accepted'|'picked_up'|'delivered';label:string}>={assigned:{status:'accepted',label:'Aceptar entrega'},accepted:{status:'picked_up',label:'Marcar como recogido'},picked_up:{status:'delivered',label:'Marcar como entregado'}}
export default function DriverPage(){
 const [driver,setDriver]=useState<Driver|null>(null)
 const [orders,setOrders]=useState<Order[]>([])
 const [loading,setLoading]=useState(true)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [gps,setGps]=useState<{lat:number;lng:number;accuracy:number}|null>(null)
 const reload=useCallback(async()=>{
  setLoading(true)
  try{
   const [profile,assignments]=await Promise.all([
    roleRequest<{driver:Driver|null}>('driver_profile'),
    supabase.functions.invoke('flashfood-mobile-orders',{body:{action:'driver_orders'}}),
   ])
   if(assignments.error)throw new Error(assignments.error.message)
   if(!assignments.data?.ok)throw new Error(assignments.data?.error||'No fue posible consultar entregas')
   setDriver(profile.driver)
   setOrders(assignments.data.orders as Order[])
   setError('')
  }catch(e){setError(e instanceof Error?e.message:'No se pudo cargar el panel')}
  finally{setLoading(false)}
 },[])
 useEffect(()=>{
  queueMicrotask(()=>{void reload()})
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void reload()},20000)
  return ()=>window.clearInterval(timer)
 },[reload])
 const call=async(action:string,args:Record<string,unknown>)=>{
  const {data,error:callError}=await supabase.functions.invoke('flashfood-mobile-orders',{body:{action,...args}})
  if(callError)throw new Error(callError.message)
  if(!data?.ok)throw new Error(data?.error||'Operación rechazada')
  return data
 }
 const change=async(availability:'available'|'offline')=>{
  setSaving(true);setError('');setNotice('')
  try{
   const result=await roleRequest<{driver:Driver}>('driver_set_availability',{availability})
   setDriver(result.driver);setNotice(availability==='available'?'Estás disponible para nuevas entregas.':'Te has desconectado.')
  }catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar el estado')}
  finally{setSaving(false)}
 }
 const transition=async(o:Order)=>{
  setSaving(true);setError('');setNotice('')
  try{
   await call('driver_transition',{order_id:o.id,status:next[o.status].status, cash_collected:next[o.status].status==='delivered' && o.payment_method==='efectivo'})
   setNotice('Estado de la entrega actualizado.')
   await reload()
  }catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar el pedido')}
  finally{setSaving(false)}
 }
 const active=orders.find(o=>o.status==='accepted'||o.status==='picked_up')
 const activeId=active?.id
 // Foreground-only tracking. Stop immediately when hidden, unmounted or no accepted delivery.
 useEffect(()=>{
  if(!activeId||!navigator.geolocation)return
  let watch:number|null=null
  let last=0
  const start=()=>{
   if(document.visibilityState!=='visible'||watch!==null)return
   watch=navigator.geolocation.watchPosition(p=>{
    const now=Date.now()
    if(now-last<15000)return
    last=now
    const c=p.coords
    setGps({lat:c.latitude,lng:c.longitude,accuracy:c.accuracy})
    void supabase.functions.invoke('flashfood-mobile-orders',{body:{
     action:'driver_location',order_id:activeId,latitude:c.latitude,longitude:c.longitude,accuracy_m:c.accuracy,
    }}).then(({error:callError,data})=>{
      if(callError||!data?.ok)console.warn('GPS no enviado:',callError?.message||data?.error)
    })
   },e=>setError('GPS: '+e.message),{enableHighAccuracy:true,maximumAge:5000,timeout:15000})
  }
  const stop=()=>{if(watch!==null){navigator.geolocation.clearWatch(watch);watch=null}}
  const visibility=()=>{if(document.visibilityState==='visible')start();else stop()}
  document.addEventListener('visibilitychange',visibility)
  start()
  return ()=>{stop();document.removeEventListener('visibilitychange',visibility)}
 },[activeId])
 const locate=()=>{
  if(!navigator.geolocation){setError('Ubicación no disponible');return}
  navigator.geolocation.getCurrentPosition(p=>setGps({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy}),e=>setError(e.message),{enableHighAccuracy:true,timeout:12000})
 }
 return <main className="mx-auto max-w-3xl space-y-5 px-4 pb-36 pt-7">
  <header className="flex items-center gap-3"><div className="rounded-2xl bg-orange-100 p-3"><Bike className="text-orange-600"/></div><div><h1 className="text-2xl font-extrabold">Panel del repartidor</h1><p className="text-sm text-gray-500">Entregas FlashFood</p></div></header>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-700">{notice}</p>}
  {loading&&!driver?<p className="flex items-center gap-2"><RefreshCw className="animate-spin"/>Cargando...</p>:driver?<>
   <section className="rounded-2xl bg-white p-5 shadow-sm">
    <div className="flex justify-between gap-3"><div><h2 className="text-lg font-extrabold">{driver.full_name}</h2><p className="text-sm text-gray-500">{driver.vehicle_type||'Vehículo pendiente de configurar'} · {driver.phone||'Sin teléfono'}</p></div><button onClick={()=>void reload()} className="rounded-xl bg-gray-100 p-2" aria-label="Actualizar"><RefreshCw size={19}/></button></div>
    <div className="mt-5 flex items-center gap-2 text-sm font-semibold">{driver.availability==='available'?<CheckCircle2 className="text-green-600"/>:<CircleOff className="text-gray-400"/>}{statusText[driver.availability]}</div>
    {(!driver.active||!driver.verified)&&<p className="mt-4 flex gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert className="shrink-0"/>El Superadmin debe activar y verificar tu perfil.</p>}
    <div className="mt-5 grid grid-cols-2 gap-3">
     <button disabled={saving||!driver.active||!driver.verified||driver.availability!=='offline'} onClick={()=>void change('available')} className="rounded-xl bg-green-600 px-3 py-3 font-bold text-white disabled:opacity-40">Conectarme</button>
     <button disabled={saving||driver.availability!=='available'} onClick={()=>void change('offline')} className="rounded-xl bg-gray-800 px-3 py-3 font-bold text-white disabled:opacity-40">Desconectarme</button>
    </div>
   </section>
   <section className="space-y-3">
    <h2 className="text-lg font-extrabold">Mis entregas activas</h2>
    {!orders.length&&<p className="rounded-xl bg-white p-5 text-sm text-gray-500">Todavía no tienes entregas asignadas.</p>}
    {orders.map(o=>{
     const step=next[o.status]
     const dest=o.address_snapshot
     const coords=dest&&typeof dest.latitude==='number'&&typeof dest.longitude==='number'?dest:null
     const maps=coords?`https://www.google.com/maps/dir/?api=1&destination=${coords.latitude},${coords.longitude}&travelmode=driving`:null
     return <article key={o.id} className="rounded-2xl border border-orange-100 bg-white p-5">
      <p className="text-xs text-gray-500">Pedido #{o.id.slice(0,8)} · {o.status}</p>
      <p className="mt-2 font-bold">{String(dest?.address_line||'Dirección por confirmar')}</p>
      <p className="mt-1 text-sm text-gray-500">{String(dest?.city||'')} · {String(dest?.reference||'')}</p>
      <div className="mt-4 flex flex-wrap gap-2">
       {maps&&<a href={maps} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 font-bold text-orange-600"><MapPin size={17}/>Navegar</a>}
       <button disabled={saving} onClick={()=>void transition(o)} className="rounded-xl bg-orange-500 px-4 py-3 font-bold text-white disabled:opacity-40">{step.status==='delivered'&&o.payment_method==='efectivo'?'Entregado y efectivo recibido':step.label}</button>
      </div>
     </article>
    })}
   </section>
   <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-bold">GPS durante la entrega</h2>
    <p className="mt-1 text-sm text-gray-500">{active?'Se comparte mientras este pedido esté aceptado y la app permanezca visible.':'No se comparte ubicación: no tienes entregas aceptadas.'}</p>
    <button type="button" onClick={locate} className="mt-4 flex items-center gap-2 rounded-xl border border-orange-200 px-4 py-3 font-semibold text-orange-600"><LocateFixed size={18}/>Ver mi ubicación</button>
    {gps&&<p className="mt-3 text-xs text-gray-500">Lat {gps.lat.toFixed(6)}, Lng {gps.lng.toFixed(6)} · precisión {Math.round(gps.accuracy)} m</p>}
   </section>
  </>:<p className="rounded-xl bg-amber-50 p-4 text-sm">No tienes perfil de repartidor vinculado. Solicita al Superadmin que complete tu alta.</p>}
  <Link to="/perfil" className="inline-block font-bold text-orange-600">Volver a perfil</Link>
 </main>
}
