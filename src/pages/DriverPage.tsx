import { useEffect,useState } from 'react'
import { Link } from 'react-router-dom'
import { Bike,RefreshCw } from 'lucide-react'
import { roleRequest } from '../services/roles'
type Driver=Record<string,unknown>|null
export default function DriverPage(){
 const [driver,setDriver]=useState<Driver>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
 useEffect(()=>{void roleRequest<{driver:Driver}>('driver_profile').then(r=>setDriver(r.driver)).catch(e=>setError(e instanceof Error?e.message:'No se pudo cargar')).finally(()=>setLoading(false))},[])
 return <main className="mx-auto max-w-3xl px-5 pb-32 pt-8"><header className="mb-6 flex items-center gap-3"><Bike className="text-orange-500"/><h1 className="text-2xl font-bold">Panel de repartidor</h1></header>
 {loading&&<p className="flex gap-2"><RefreshCw className="animate-spin"/>Cargando…</p>}
 {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
 {!loading&&!error&&(driver?<div className="rounded-2xl bg-white p-5 shadow-sm"><h2 className="font-bold">Mi perfil de repartidor</h2><p className="mt-2 text-sm text-gray-500">Estado: {String(driver.availability??'Sin disponibilidad configurada')}</p><p className="text-sm text-gray-500">Activo: {driver.active===true?'Sí':'No'}</p></div>:<p className="rounded-xl bg-amber-50 p-4 text-sm">Tienes acceso al rol delivery, pero aún no hay perfil de repartidor vinculado a tu usuario. El Superadmin debe completar tu alta.</p>)}
 <p className="mt-6 text-sm text-gray-500">La aceptación de entregas y el GPS se habilitarán cuando estén conectadas las operaciones de despacho, para evitar asignaciones ficticias.</p><Link to="/perfil" className="mt-6 inline-block text-orange-600">Volver a mi perfil</Link>
 </main>
}
