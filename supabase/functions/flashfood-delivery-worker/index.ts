import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import {pushToDevices} from '../_shared/flashfoodMerchantNotify.ts'
const json=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
})
// Invoke via Supabase Cron with Authorization: Bearer <service role key>.
// Deploy --no-verify-jwt only after setting the private Cron authorization header.
Deno.serve(async req=>{
 if(req.method!=='POST')return json({ok:false,error:'Método no permitido'},405)
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
 const url=Deno.env.get('SUPABASE_URL')||''
 if(!service||!url||req.headers.get('authorization')!=='Bearer '+service)
   return json({ok:false,error:'No autorizado'},401)
 try{
  const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
  const {data:tick,error:tickError}=await db.rpc('flashfood_tick_delivery_offers')
  if(tickError)throw tickError
  const now=new Date().toISOString()
  const {data:pending,error:offerError}=await db.from('flashfood_delivery_offers')
   .select('id,order_id,driver_id').eq('status','pending').is('notified_at',null)
   .gt('expires_at',now).order('offered_at',{ascending:true}).limit(100)
  if(offerError)throw offerError
  let sent=0
  for(const offer of pending||[]){
   const {data:driver,error:driverError}=await db.from('flashfood_drivers')
     .select('auth_user_id').eq('id',offer.driver_id).maybeSingle()
   if(driverError){console.error('Driver notification lookup',driverError.message);continue}
   if(!driver?.auth_user_id)continue
   try{
    await pushToDevices(db,[driver.auth_user_id],offer.order_id,
      'Nueva entrega FlashFood','Tienes 60 segundos para aceptar este pedido.','delivery_offer')
    const {error:markError}=await db.from('flashfood_delivery_offers')
      .update({notified_at:new Date().toISOString()}).eq('id',offer.id)
      .eq('status','pending').is('notified_at',null)
    if(markError)throw markError
    sent++
   }catch(e){console.error('Notificación de oferta pendiente:',e instanceof Error?e.message:'Error')}
  }
  return json({ok:true,offered:tick||0,notified:sent})
 }catch(e){
  console.error('flashfood-delivery-worker',e instanceof Error?e.message:'Error')
  return json({ok:false,error:'No se pudo ejecutar el despachador automático'},500)
 }
})
