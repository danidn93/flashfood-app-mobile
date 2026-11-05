import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike, CheckCircle2, CircleOff, LocateFixed, MapPin, RefreshCw, ShieldAlert } from 'lucide-react'
import { roleRequest } from '../services/roles'

type Driver = {
 id:string; full_name:string; phone:string|null; vehicle_type:string|null
 availability:'offline'|'available'|'busy'; active:boolean; verified:boolean
}
const statusText = { offline:'Desconectado', available:'Disponible para entregas', busy:'Ocupado en una entrega' }
export default function DriverPage(){
 const [driver,setDriver]=useState<Driver|null>(null)
 const [loading,setLoading]=useState(true)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [gps,setGps]=useState<{lat:number;lng:number;accuracy:number}|null>(null)
 const reload=useCallback(async()=>{
  setLoading(true);setError('')
  try{
   const result=await roleRequest<{driver:Driver|null}>('driver_profile')
   setDriver(result.driver)
  }catch(e){setError(e instanceof Error?e.message:'No se pudo cargar el perfil')}
  finally{setLoading(false)}
 },[])
 useEffect(()=>{void reload()},[reload])
 const change=async(next:'available'|'offline')=>{
  if(saving)return
  setSaving(true);setError('');setNotice('')
  try{
   const result=await roleRequest<{driver:Driver}>('driver_set_availability',{availability:next})
   setDriver(result.driver)
   setNotice(next==='available'?'Ya puedes recibir solicitudes cuando se habilite el despacho.':'Te has desconectado.')
  }catch(e){setError(e instanceof Error?e.message:'No se pudo actualizar tu disponibilidad')}
  finally{setSaving(false)}
 }
 const locate=()=>{
  if(!navigator.geolocation){setError('Tu dispositivo no admite geolocalización.');return}
  setSaving(true);setError('')
  navigator.geolocation.getCurrentPosition(
   p=>{setGps({lat:p.coords.latitude,lng:p.coords.longitude,accuracy:p.coords.accuracy});setSaving(false)},
   ()=>{setError('No se pudo acceder al GPS. Comprueba los permisos de ubicación.');setSaving(false)},
   {enableHighAccuracy:true,timeout:15000,maximumAge:0},
  )
 }
 return <main className="mx-auto max-w-3xl space-y-5 px-4 pb-36 pt-7">
  <header className="flex items-center gap-3"><div className="rounded-2xl bg-orange-100 p-3"><Bike className="text-orange-600"/></div><div><h1 className="text-2xl font-extrabold">Panel del repartidor</h1><p className="text-sm text-gray-500">FlashFood Delivery</p></div></header>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-700">{notice}</p>}
  {loading?<p className="flex items-center gap-2"><RefreshCw className="animate-spin"/>Consultando perfil...</p>:driver?<>
   <section className="rounded-2xl bg-white p-5 shadow-sm">
    <div className="flex justify-between gap-3"><div><h2 className="text-lg font-extrabold">{driver.full_name}</h2><p className="text-sm text-gray-500">{driver.vehicle_type||'Vehículo pendiente de configurar'} · {driver.phone||'Sin teléfono'}</p></div><button title="Actualizar" onClick={()=>void reload()} className="self-start rounded-xl bg-gray-100 p-2"><RefreshCw size={19}/></button></div>
    <div className="mt-5 flex items-center gap-2 text-sm font-semibold">{driver.availability==='available'?<CheckCircle2 className="text-green-600"/>:<CircleOff className="text-gray-400"/>}{statusText[driver.availability]||driver.availability}</div>
    {(!driver.active||!driver.verified)&&<p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><ShieldAlert className="shrink-0"/>{!driver.active?'Tu perfil está desactivado. ':'Tu cuenta aún no ha sido verificada. '}El Superadmin debe habilitarte antes de conectarte.</p>}
    <div className="mt-5 grid grid-cols-2 gap-3">
     <button type="button" disabled={saving||!driver.active||!driver.verified||driver.availability==='busy'||driver.availability==='available'} onClick={()=>void change('available')} className="rounded-xl bg-green-600 px-3 py-3 font-bold text-white disabled:opacity-40">Conectarme</button>
     <button type="button" disabled={saving||driver.availability==='offline'} onClick={()=>void change('offline')} className="rounded-xl bg-gray-800 px-3 py-3 font-bold text-white disabled:opacity-40">Desconectarme</button>
    </div>
   </section>
   <section className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-bold">Mi ubicación</h2><p className="mt-1 text-sm text-gray-500">Consulta puntual del GPS. No se comparte ni registra continuamente en el servidor.</p>
    <button disabled={saving} type="button" onClick={locate} className="mt-4 flex items-center gap-2 rounded-xl border border-orange-200 px-4 py-3 font-semibold text-orange-600"><LocateFixed size={19}/>Obtener ubicación actual</button>
    {gps&&<p className="mt-3 flex items-start gap-2 text-sm text-gray-600"><MapPin size={17}/>Lat {gps.lat.toFixed(6)}, Lng {gps.lng.toFixed(6)} · precisión aproximada {Math.round(gps.accuracy)} m</p>}
   </section>
   <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950"><h2 className="font-bold">Entregas</h2><p className="mt-2">La disponibilidad ya puede actualizarse. La recepción, aceptación, asignación y finalización de pedidos se habilitarán cuando exista el despacho real conectado al checkout. Aún no hay pedidos asignados en esta pantalla.</p></section>
  </>:<p className="rounded-xl bg-amber-50 p-4 text-sm">Tu usuario tiene rol de repartidor, pero todavía no existe un perfil vinculado. Solicita al Superadmin que complete tu registro.</p>}
  <Link to="/perfil" className="inline-block text-sm font-bold text-orange-600">Volver a mi perfil</Link>
 </main>
}
