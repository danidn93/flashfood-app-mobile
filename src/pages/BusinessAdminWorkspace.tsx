import { useEffect,useState } from 'react'
import { Link } from 'react-router-dom'
import { Store,Users,RefreshCw } from 'lucide-react'
import BusinessAdminPage from './BusinessAdminPage'
import { loadBusinesses,loadEmployees,assignBusinessRole,saveFreeDelivery,type Business } from '../services/roles'
export default function BusinessAdminWorkspace(){
 const [businesses,setBusinesses]=useState<Business[]>([])
 const [current,setCurrent]=useState('')
 const [loading,setLoading]=useState(true),[error,setError]=useState('')
 const [employees,setEmployees]=useState<Array<{id:string;email:string;name:string;role:string;active:boolean;branch_id:string|null}>>([])
 const [email,setEmail]=useState(''),[invite,setInvite]=useState(false),[saving,setSaving]=useState(false),[message,setMessage]=useState('')
 async function refresh(){
  const r=await loadBusinesses()
  setBusinesses(r.businesses.filter(b=>b.can_manage));setCurrent(old=>r.businesses.some(b=>b.id===old&&b.can_manage)?old:r.businesses.find(b=>b.can_manage)?.id||'')
 }
 useEffect(()=>{void refresh().catch(e=>setError(String(e))).finally(()=>setLoading(false))},[])
 useEffect(()=>{if(current)void loadEmployees(current).then(r=>setEmployees(r.employees)).catch(e=>setError(String(e)))},[current])
 const selected=businesses.find(b=>b.id===current)
 async function addEmployee(){
  if(!selected)return
  setSaving(true);setError('');setMessage('')
  try{await assignBusinessRole(email,selected.id,'empleado',true,null,invite);setMessage('Empleado asignado correctamente');setEmail('');setEmployees((await loadEmployees(selected.id)).employees)}
  catch(e){setError(e instanceof Error?e.message:'No se pudo asignar empleado')}finally{setSaving(false)}
 }
 async function changeEmployee(e:{email:string;active:boolean}){
  if(!selected)return
  setSaving(true);setError('')
  try{await assignBusinessRole(e.email,selected.id,'empleado',!e.active);setEmployees((await loadEmployees(selected.id)).employees)}
  catch(err){setError(String(err))}finally{setSaving(false)}
 }
 const employeeTools = (<section className="mx-auto mt-6 max-w-3xl rounded-2xl border bg-white p-5">
   <h2 className="flex items-center gap-2 text-lg font-bold"><Users size={20}/> Gestión de empleados</h2>
   <p className="mt-2 text-sm text-gray-500">Puedes asociar una cuenta existente por correo o invitar a una nueva. Los empleados solo recibirán acceso al negocio seleccionado.</p>
   <div className="mt-4 flex flex-wrap gap-2"><input className="min-w-0 flex-1 rounded-xl border p-3" type="email" value={email} placeholder="correo@ejemplo.com" onChange={e=>setEmail(e.target.value)}/><button className="rounded-xl bg-orange-500 px-5 py-3 font-semibold text-white disabled:opacity-50" disabled={saving||!email.includes('@')} onClick={()=>void addEmployee()}>Asignar empleado</button></div>
   <label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={invite} onChange={e=>setInvite(e.target.checked)}/> Enviar invitación si no tiene cuenta</label>
   {message&&<p className="mt-3 text-sm text-green-700">{message}</p>}
   {error&&<p className="mt-3 text-sm text-red-600">{error}</p>}
   <div className="mt-4 space-y-2">{employees.filter(e=>e.role==='empleado').map(e=><div key={e.id} className="flex items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="truncate font-semibold">{e.name||e.email}</p><p className="truncate text-xs text-gray-500">{e.email}</p></div><button disabled={saving} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void changeEmployee(e)}>{e.active?'Desactivar':'Reactivar'}</button></div>)}</div>
  </section>)
 if(loading)return <main className="p-8 text-center"><RefreshCw className="inline animate-spin"/> Cargando negocios…</main>
 if(error&&!businesses.length)return <main className="p-8 text-red-600">{error}<Link to="/perfil" className="ml-3 underline">Volver</Link></main>
 if(!selected)return <main className="mx-auto max-w-lg p-8"><h1 className="text-xl font-bold">Sin negocios asignados</h1><p className="my-4 text-sm">El Superadmin debe asignarte un negocio antes de administrarlo.</p><Link to="/perfil" className="text-orange-600">Volver a perfil</Link></main>
 return <div className="pb-24">
  <section className="border-b bg-white px-5 py-4"><label className="flex items-center gap-2 text-sm font-semibold"><Store size={17}/> Negocio
   <select className="rounded-lg border p-2" value={current} onChange={e=>setCurrent(e.target.value)}>{businesses.map(b=><option key={b.id} value={b.id}>{b.nombre}</option>)}</select>
  </label></section>
  <BusinessAdminPage employeeTools={employeeTools} key={selected.id} businessId={selected.id} businessName={selected.nombre} freeDelivery={selected.free_delivery} onSaveFreeDelivery={async(id,enabled)=>{await saveFreeDelivery(id,enabled);setBusinesses(old=>old.map(b=>b.id===id?{...b,free_delivery:enabled}:b))}} />

 </div>
}
