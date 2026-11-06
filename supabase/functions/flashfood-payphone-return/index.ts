import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { syncFlashFoodOrderToErp } from '../_shared/flashfoodErpBridge.ts'
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c))
const page=(title:string,message:string,status=200)=>new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · FlashFood</title></head><body style="font-family:system-ui,sans-serif;background:#fafafa;padding:32px;max-width:520px;margin:auto"><h1>${esc(title)}</h1><p>${esc(message)}</p><p>Regresa a FlashFood y revisa el estado del pedido en «Mis pedidos».</p></body></html>`,{status,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}})
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)
Deno.serve(async req=>{
  if(req.method!=='GET')return page('Método no permitido','La página de retorno solo acepta GET.',405)
  try{
    const url=new URL(req.url)
    const id=url.searchParams.get('id')
    const clientTxId=url.searchParams.get('clientTransactionId')
    if(!id||!/^\d{1,18}$/.test(id)||!clientTxId||!/^[a-zA-Z0-9-]{1,30}$/.test(clientTxId))
      return page('Confirmación incompleta','El proveedor no devolvió los identificadores necesarios.',400)
    const supabaseUrl=Deno.env.get('SUPABASE_URL')
    const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const token=Deno.env.get('PAYPHONE_TOKEN')
    if(!supabaseUrl||!secret||!token)return page('Servicio no disponible','La conciliación de PayPhone todavía no está configurada.',503)
    const db=createClient(supabaseUrl,secret,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:order,error:readError}=await db.from('flashfood_mobile_orders').select('*')
      .eq('payphone_client_tx_id',clientTxId).eq('payment_method','tarjeta').maybeSingle()
    if(readError)throw readError
    if(!order||!uuid(order.id))return page('Pedido no encontrado','La transacción no coincide con un pedido creado en FlashFood.',404)
    if(order.payment_status==='paid')return page('Pago confirmado','Tu pedido ya figura como pagado.')
    const response=await fetch('https://pay.payphonetodoesposible.com/api/button/V2/Confirm',{
      method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({id:Number(id),clientTxId:clientTxId}),signal:AbortSignal.timeout(12000),
    })
    if(!response.ok)return page('Pago sin confirmar','PayPhone todavía no pudo confirmar el resultado. Revisa el pedido más tarde.',502)
    const result=await response.json()
    const amount=Math.round(Number(order.total)*100)
    if(result.clientTransactionId!==clientTxId||Number(result.amount)!==amount||
      result.transactionStatus!=='Approved'||Number(result.statusCode)!==3||
      String(result.currency||'USD')!=='USD'||String(result.transactionId)!==String(id)){
      return page('Pago no aprobado','La confirmación de PayPhone no coincide con el pedido o aún no está aprobada.',409)
    }
    const {data:updated,error:updateError}=await db.from('flashfood_mobile_orders').update({
      payment_status:'paid',status:'placed',payphone_transaction_id:String(result.transactionId),
      updated_at:new Date().toISOString(),
    }).eq('id',order.id).eq('payment_status','pending').eq('status','pending_payment').select('id,modality').maybeSingle()
    if(updateError)throw updateError
    if(updated){
      if(updated.modality==='domicilio'){
        const {error:dispatchError}=await db.rpc('flashfood_mobile_assign_driver',{p_order_id:updated.id})
        if(dispatchError)console.error('Pago aprobado; despacho pendiente',dispatchError.message)
      }
      try{
        const {error:ledgerError}=await db.rpc('flashfood_stage_card_settlements',{p_order_id:updated.id})
        if(ledgerError)throw ledgerError
        const sync=await syncFlashFoodOrderToErp(db,updated.id,true)
        if(!sync.synced)console.warn('Pendiente sincronizar pedido al ERP:',sync.reason)
      }catch(error){
        // Provider payment remains approved even if async settlement integration fails.
        console.error('Conciliación financiera pendiente:',error instanceof Error?error.message:'Error')
      }
    }
    return page('Pago confirmado','PayPhone confirmó el pago y el pedido fue registrado.')
  }catch(error){
    console.error('payphone return',error)
    return page('Confirmación pendiente','No pudimos verificar el pago en este momento. No intentes pagar nuevamente hasta revisar tu pedido.',503)
  }
})
