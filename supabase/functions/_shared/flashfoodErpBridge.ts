// Internal server-to-server synchronization. Never import into client-side code.
// No secrets, no buyer fiscal data and no delivery GPS are sent to the ERP.
type Db = any
export async function syncFlashFoodOrderToErp(db: Db, orderId: string, notify = false):
 Promise<{synced:boolean;reason?:string}> {
  const {data:o,error:e}=await db.from('flashfood_mobile_orders')
    .select('id,business_id,branch_id,subtotal,payment_method,payment_status,status')
    .eq('id',orderId).maybeSingle()
  if(e)throw e
  if(!o)return {synced:false,reason:'Pedido inexistente'}
  if(!['placed','assigned','accepted','picked_up','delivered'].includes(o.status))
    return {synced:false,reason:'Pedido no confirmado'}
  const {data:setting,error:settingError}=await db.from('flashfood_merchant_fiscal_settings')
    .select('origen,facturacion_flashfood_habilitada,negocio_origen_id')
    .eq('local_id',o.business_id).maybeSingle()
  if(settingError)throw settingError
  if(!setting?.facturacion_flashfood_habilitada||setting.origen!=='multicomercios')
    return {synced:false,reason:'Sin vínculo ERP habilitado'}
  const {data:link,error:linkError}=await db.from('flashfood_erp_branch_links')
    .select('erp_business_id,erp_branch_id').eq('flashfood_branch_id',o.branch_id)
    .eq('flashfood_local_id',o.business_id).maybeSingle()
  if(linkError)throw linkError
  if(!link||link.erp_business_id!==setting.negocio_origen_id)
    return {synced:false,reason:'Falta configurar sucursal Multicomercios'}
  const bridgeUrl=Deno.env.get('MULTICOMERCIOS_BRIDGE_URL')
  const bridgeToken=Deno.env.get('MULTICOMERCIOS_BRIDGE_TOKEN')
  if(!bridgeUrl||!/^https:\/\//i.test(bridgeUrl)||!bridgeToken||bridgeToken.length<48)
    return {synced:false,reason:'No se ha configurado el puente de Multicomercios'}
  const {data:obligation,error:obligationError}=await db.from('flashfood_settlement_obligations')
    .select('id,amount_due,amount_paid').eq('order_id',orderId).eq('beneficiary_type','merchant').maybeSingle()
  if(obligationError)throw obligationError
  // Only orders charged by the platform generate debt. Other methods show 0 pending.
  const due=obligation?Number(obligation.amount_due):0
  const paid=obligation?Number(obligation.amount_paid):0
  const result=await fetch(bridgeUrl,{
    method:'POST',headers:{'Authorization':'Bearer '+bridgeToken,'Content-Type':'application/json'},
    body:JSON.stringify({
      action:'order_upsert',order_id:o.id,business_id:link.erp_business_id,
      branch_id:link.erp_branch_id,amount_due:due,amount_paid:paid,notify,
    }),signal:AbortSignal.timeout(15000),
  })
  const response=await result.json().catch(()=>({}))
  if(!result.ok||response.ok!==true)
    return {synced:false,reason:'El ERP rechazó la sincronización: '+String(response.error||result.status)}
  if(obligation){
    const {error:markError}=await db.from('flashfood_settlement_obligations')
      .update({erp_branch_id:link.erp_branch_id,erp_business_id:link.erp_business_id,erp_synced_at:new Date().toISOString()})
      .eq('id',obligation.id)
    if(markError)throw markError
  }
  return {synced:true}
}
