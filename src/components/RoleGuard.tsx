import { useEffect,useState,type ReactNode } from 'react'
import { Link,Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { loadMyAccess,type RoleName } from '../services/roles'
export default function RoleGuard({role,children}:{role:RoleName;children:ReactNode}){
 const [status,setStatus]=useState<'checking'|'guest'|'allowed'|'denied'>('checking')
 useEffect(()=>{let live=true;void(async()=>{
  const {data,error}=await supabase.auth.getUser()
  if(!live)return
  if(error||!data.user){setStatus('guest');return}
  try{const access=await loadMyAccess();if(live)setStatus(access.superadmin || (access.roles.includes(role) && (role==='delivery'||access.access.some(g=>g.role===role&&g.active)))?'allowed':'denied')}
  catch{if(live)setStatus('denied')}
 })();return()=>{live=false}},[role])
 if(status==='checking')return <main className="p-8 text-center">Verificando permisos…</main>
 if(status==='guest')return <Navigate to="/login" replace/>
 if(status==='denied')return <main className="mx-auto max-w-lg p-8 text-center"><h1 className="text-xl font-bold">Acceso restringido</h1><p className="my-4 text-gray-500">No tienes permiso activo para este panel.</p><Link to="/perfil" className="text-orange-600">Volver a mi perfil</Link></main>
 return <>{children}</>
}
