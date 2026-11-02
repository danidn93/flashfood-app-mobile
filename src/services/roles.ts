import { supabase } from '../lib/supabase'
export type RoleName='superadmin'|'admin'|'empleado'|'delivery'
export type BusinessGrant={id:string;user_id:string;business_id:string;branch_id:string|null;role:'admin'|'empleado';active:boolean}
export type Business={id:string;nombre:string;activo:boolean;free_delivery:boolean;can_manage:boolean}
export async function roleRequest<T>(action:string,params:Record<string,unknown>={}):Promise<T>{
 const {data,error}=await supabase.functions.invoke('flashfood-role-access',{body:{action,...params}})
 if(error)throw new Error(error.message)
 if(!data?.ok)throw new Error(data?.error||'No se pudo procesar el permiso')
 return data as T
}
export const loadMyAccess=()=>roleRequest<{ok:true;roles:RoleName[];access:BusinessGrant[];superadmin:boolean}>('me')
export const loadBusinesses=()=>roleRequest<{ok:true;businesses:Business[]}>('businesses')
export const loadEmployees=(business_id:string)=>roleRequest<{ok:true;employees:Array<{id:string;email:string;name:string;role:string;active:boolean;branch_id:string|null}>}>('employees',{business_id})
export const assignBusinessRole=(email:string,business_id:string,role:'admin'|'empleado',active:boolean,branch_id:string|null=null,invite=false)=>roleRequest('set_business_access',{email,business_id,role,active,branch_id,invite})
export const saveFreeDelivery=(business_id:string,enabled:boolean)=>roleRequest('set_free_delivery',{business_id,enabled})
