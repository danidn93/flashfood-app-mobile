import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

// Notification delivery is best effort; durable alerts are stored before attempting push.
// Server-side membership checks prevent notifying employees of unrelated branches.
export async function notifyFlashFoodMerchant(db:SupabaseClient,orderId:string):Promise<number>{
 const {data:order,error:orderError}=await db.from('flashfood_orders')
   .select('id,mobile_local_id,mobile_branch_id,status').eq('id',orderId).maybeSingle()
 if(orderError)throw orderError
 if(!order||!['pending','assigned','accepted','in_transit','delivered','picked_up'].includes(order.status))return 0
 const {data:grants,error:accessError}=await db.from('flashfood_business_access')
   .select('user_id,role,branch_id').eq('business_id',order.mobile_local_id).eq('active',true)
 if(accessError)throw accessError
 const recipients=[...new Set((grants||[]).filter(g=>
   ['admin','empleado'].includes(g.role)&&(!g.branch_id||g.branch_id===order.mobile_branch_id))
   .map(g=>g.user_id))]
 if(!recipients.length)return 0
 const {data:already,error:existingError}=await db.from('flashfood_mobile_merchant_alerts')
   .select('user_id').eq('order_id',order.id)
 if(existingError)throw existingError
 const prior=new Set((already||[]).map(x=>x.user_id))
 const pending=recipients.filter(id=>!prior.has(id))
 if(!pending.length)return 0
 const {error:writeError}=await db.from('flashfood_mobile_merchant_alerts')
  .upsert(pending.map(userId=>({
    order_id:order.id,user_id:userId,business_id:order.mobile_local_id,branch_id:order.mobile_branch_id,
    title:'Nuevo pedido FlashFood',
    message:'Hay un pedido nuevo para atender en la sucursal.',
  })),{onConflict:'order_id,user_id',ignoreDuplicates:true})
 if(writeError)throw writeError
 try{await pushToDevices(db,pending,order.id)}catch(e){
  console.error('Push merchant pendiente; alerta interna guardada:',e instanceof Error?e.message:'Error')
 }
 return pending.length
}
type Device={id:string;user_id:string;token:string;platform:'ios'|'android'}
const url64=(input:Uint8Array)=>btoa(String.fromCharCode(...input)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'')
const encode=(value:unknown)=>url64(new TextEncoder().encode(JSON.stringify(value)))
const keyBytes=(pem:string)=>Uint8Array.from(atob(pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g,'')),c=>c.charCodeAt(0))

async function pushToDevices(db:SupabaseClient,userIds:string[],orderId:string):Promise<void>{
 const {data,error}=await db.from('flashfood_push_devices')
  .select('id,user_id,token,platform').eq('active',true).in('user_id',userIds).limit(250)
 if(error)throw error
 const devices=(data||[]) as Device[]
 if(!devices.length)return
 if(devices.length>200)throw new Error('Demasiados dispositivos: se requiere despachador por lotes.')
 const ios=devices.some(x=>x.platform==='ios'),android=devices.some(x=>x.platform==='android')
 let firebaseToken='',firebaseProject='',apnsToken=''
 if(android){
  const raw=Deno.env.get('FLASHFOOD_FIREBASE_SERVICE_ACCOUNT')
  if(!raw)throw new Error('Falta cuenta de servicio Firebase')
  const account=JSON.parse(raw) as Record<string,string>
  if(!account.client_email||!account.private_key||!account.project_id)throw new Error('Configuración Firebase incompleta')
  firebaseProject=account.project_id
  const key=await crypto.subtle.importKey('pkcs8',keyBytes(account.private_key),
    {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign'])
  const now=Math.floor(Date.now()/1000)
  const part=encode({alg:'RS256',typ:'JWT'})+'.'+encode({
    iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',
    aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600,
  })
  const sign=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,new TextEncoder().encode(part))
  const response=await fetch('https://oauth2.googleapis.com/token',{
    method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:part+'.'+url64(new Uint8Array(sign))}),
    signal:AbortSignal.timeout(12000),
  })
  const result=await response.json()
  if(!response.ok||!result.access_token)throw new Error('No se pudo obtener token de Firebase')
  firebaseToken=result.access_token
 }
 if(ios){
  const raw=Deno.env.get('FLASHFOOD_APNS_PRIVATE_KEY')
  const team=Deno.env.get('FLASHFOOD_APNS_TEAM_ID')
  const kid=Deno.env.get('FLASHFOOD_APNS_KEY_ID')
  if(!raw||!team||!kid)throw new Error('APNs no está configurado')
  const key=await crypto.subtle.importKey('pkcs8',keyBytes(raw.replace(/\\n/g,'\n')),
    {name:'ECDSA',namedCurve:'P-256'},false,['sign'])
  const part=encode({alg:'ES256',kid})+'.'+encode({iss:team,iat:Math.floor(Date.now()/1000)})
  const sign=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,new TextEncoder().encode(part))
  apnsToken=part+'.'+url64(new Uint8Array(sign))
 }
 const title='Nuevo pedido FlashFood',message='Hay una compra nueva en tu negocio. Revisa los pedidos.'
 const host=Deno.env.get('FLASHFOOD_APNS_ENVIRONMENT')==='production'
   ? 'https://api.push.apple.com':'https://api.sandbox.push.apple.com'
 const bundle=Deno.env.get('FLASHFOOD_APNS_BUNDLE_ID')||'com.flashfood.mobile'
 for(const device of devices){
  try{
   const response=device.platform==='android'
     ? await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(firebaseProject)+'/messages:send',{
       method:'POST',headers:{Authorization:'Bearer '+firebaseToken,'Content-Type':'application/json'},
       body:JSON.stringify({message:{token:device.token,notification:{title,body:message},
         data:{type:'merchant_order',order_id:orderId}}}),
       signal:AbortSignal.timeout(10000),
      })
     : await fetch(host+'/3/device/'+encodeURIComponent(device.token),{
       method:'POST',headers:{authorization:'bearer '+apnsToken,'apns-topic':bundle,
         'apns-push-type':'alert','apns-priority':'10','content-type':'application/json'},
       body:JSON.stringify({aps:{alert:{title,body:message},sound:'default'},
         type:'merchant_order',order_id:orderId}),
       signal:AbortSignal.timeout(10000),
      })
   if(!response.ok){
    const msg=(await response.text()).slice(0,120)
    console.error('Push order',response.status,msg)
    if(response.status===404||response.status===410)
      await db.from('flashfood_push_devices').update({active:false}).eq('id',device.id)
   }
  }catch(err){console.error('Fallo push merchant:',err instanceof Error?err.message:'Error')}
 }
}
