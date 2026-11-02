import { Link } from 'react-router-dom'
import { UserCog } from 'lucide-react'
import { useEffect,useState } from 'react'
import { loadBusinesses,type Business } from '../services/roles'
export default function EmployeePage(){
 const [list,setList]=useState<Business[]>([]),[error,setError]=useState('')
 useEffect(()=>{void loadBusinesses().then(r=>setList(r.businesses)).catch(e=>setError(String(e)))},[])
 return <main className="mx-auto max-w-3xl px-5 pb-32 pt-8"><h1 className="flex items-center gap-3 text-2xl font-bold"><UserCog className="text-orange-500"/>Panel de empleado</h1>
 {error&&<p className="mt-5 text-red-600">{error}</p>}
 <div className="mt-6 space-y-3">{list.map(b=><div key={b.id} className="rounded-2xl border bg-white p-5"><h2 className="font-bold">{b.nombre}</h2><p className="text-sm text-gray-500">Negocio asignado · Acceso operativo sujeto a los permisos de tu sucursal</p></div>)}</div>
 {!list.length&&!error&&<p className="mt-6 text-sm text-gray-500">No hay negocios asignados a tu cuenta.</p>}
 <p className="mt-5 text-sm text-gray-500">Los pedidos y tareas de empleados se conectarán a los permisos operativos existentes. No se mostrarán pedidos de otros negocios.</p><Link className="mt-4 inline-block text-orange-600" to="/perfil">Volver a mi perfil</Link>
 </main>
}
