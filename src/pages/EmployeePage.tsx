import { Link } from 'react-router-dom'
import { UserCog } from 'lucide-react'
import { useEffect,useState } from 'react'
import { loadBusinesses,type Business } from '../services/roles'
import FlashFoodMerchantOrders from '../components/marketplace/FlashFoodMerchantOrders'
export default function EmployeePage(){
 const [list,setList]=useState<Business[]>([]),[error,setError]=useState('')
 const [current,setCurrent]=useState('')
 useEffect(()=>{queueMicrotask(()=>{void loadBusinesses().then(r=>{setList(r.businesses);setCurrent(v=>v||r.businesses[0]?.id||'')}).catch(e=>setError(String(e)))})},[])
 return <main className="mx-auto max-w-3xl px-5 pb-32 pt-8"><h1 className="flex items-center gap-3 text-2xl font-bold"><UserCog className="text-orange-500"/>Panel de empleado</h1>
 {error&&<p className="mt-5 text-red-600">{error}</p>}
 <div className="mt-6"><label className="block text-sm font-semibold">Negocio asignado<select className="mt-2 w-full rounded-xl border bg-white p-3" value={current} onChange={e=>setCurrent(e.target.value)}>{list.map(b=><option key={b.id} value={b.id}>{b.nombre}</option>)}</select></label>{current&&<div className="mt-5"><FlashFoodMerchantOrders key={current} businessId={current}/></div>}</div>
 {!list.length&&!error&&<p className="mt-6 text-sm text-gray-500">No hay negocios asignados a tu cuenta.</p>}
 <p className="mt-5 text-sm text-gray-500">Solo verás pedidos y avisos de los negocios y sucursales autorizados.</p><Link className="mt-4 inline-block text-orange-600" to="/perfil">Volver a mi perfil</Link>
 </main>
}
