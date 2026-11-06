import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, RefreshCw, Send, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
type Obligation={
 id:string;order_id:string;beneficiary_type:'merchant'|'driver';
 merchant_local_id:string|null;driver_id:string|null;erp_business_id:string|null;
 amount_due:number;amount_paid:number;status:'pending'|'partial'|'paid';
 erp_synced_at:string|null;created_at:string
}
const usd=(v:number)=>new Intl.NumberFormat('es-EC',{style:'currency',currency:'USD'}).format(v)
const today=()=>new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'})
export default function FlashFoodSettlements(){
 const [rows,setRows]=useState<Obligation[]>([])
 const [busy,setBusy]=useState('')
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [current,setCurrent]=useState<Obligation|null>(null)
 const [amount,setAmount]=useState('')
 const [reference,setReference]=useState('')
 const [date,setDate]=useState(today())
 const call=async(action:string,args:Record<string,unknown>={})=>{
  const {data,error:callError}=await supabase.functions.invoke('flashfood-mobile-orders',{body:{action,...args}})
  if(callError)throw new Error(callError.message)
  if(!data?.ok)throw new Error(data?.error||'No se completó la operación')
  return data
 }
 const refresh=useCallback(async()=>{
  try{const data=await call('settlement_list');setRows(data.rows||[]);setError('')}
  catch(e){setError(e instanceof Error?e.message:'No se pudieron consultar liquidaciones')}
 },[])
 useEffect(()=>{queueMicrotask(()=>{void refresh()})},[refresh])
 const totals=useMemo(()=>rows.reduce((a,x)=>{
  const key=x.beneficiary_type==='merchant'?'merchants':'drivers'
  a[key]+=Number(x.amount_due)-Number(x.amount_paid)
  return a
 },{merchants:0,drivers:0}),[rows])
 const pay=async()=>{
  if(!current||busy)return
  const n=Number(amount),remaining=Math.round((Number(current.amount_due)-Number(current.amount_paid))*100)/100
  if(!Number.isFinite(n)||n<=0||Math.round(n*100)!==n*100||n>remaining||reference.trim().length<3||!date){
   setError('Ingresa importe válido dentro del saldo pendiente, referencia bancaria y fecha.');return
  }
  if(!window.confirm('¿Confirmas que realizaste realmente la transferencia bancaria por '+usd(n)+'?'))return
  setBusy(current.id);setError('');setNotice('')
  try{
   await call('settlement_transfer',{obligation_id:current.id,amount:n,reference:reference.trim(),transfer_date:date})
   setCurrent(null);setAmount('');setReference('')
   setNotice('Transferencia registrada. Si el ERP no estaba conectado, podrás reintentar la sincronización.')
   await refresh()
  }catch(e){setError(e instanceof Error?e.message:'No se pudo registrar la transferencia')}
  finally{setBusy('')}
 }
 const sync=async(o:Obligation)=>{
  setBusy(o.id);setError('');setNotice('')
  try{
   await call('settlement_sync',{order_id:o.order_id})
   setNotice('Saldo y aviso sincronizados con Multicomercios.')
   await refresh()
  }catch(e){setError(e instanceof Error?e.message:'No se pudo sincronizar con el ERP')}
  finally{setBusy('')}
 }
 return <section className="space-y-5">
  <header><h2 className="text-xl font-extrabold">Liquidaciones FlashFood</h2>
    <p className="mt-1 text-sm text-slate-500">Obligaciones por compras cobradas mediante tarjeta. Ningún importe se considera transferido hasta registrarlo con referencia.</p></header>
  {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-green-50 p-4 text-sm text-green-700">{notice}</p>}
  <div className="grid gap-3 sm:grid-cols-2">
   <div className="rounded-2xl border bg-white p-5"><Wallet className="text-orange-500"/><p className="mt-3 text-sm text-slate-500">Pendiente a negocios</p><p className="mt-1 text-2xl font-extrabold">{usd(totals.merchants)}</p></div>
   <div className="rounded-2xl border bg-white p-5"><Wallet className="text-orange-500"/><p className="mt-3 text-sm text-slate-500">Pendiente a repartidores</p><p className="mt-1 text-2xl font-extrabold">{usd(totals.drivers)}</p></div>
  </div>
  <div className="rounded-2xl border bg-white p-4">
   <div className="mb-4 flex items-center justify-between"><h3 className="font-extrabold">Obligaciones y abonos</h3><button onClick={()=>void refresh()} aria-label="Actualizar liquidaciones"><RefreshCw size={19}/></button></div>
   <div className="space-y-3">
    {!rows.length&&<p className="text-sm text-slate-500">No hay obligaciones de tarjeta registradas.</p>}
    {rows.map(o=>{
     const remaining=Math.round((Number(o.amount_due)-Number(o.amount_paid))*100)/100
     return <article key={o.id} className="rounded-xl border p-4">
      <div className="flex flex-wrap justify-between gap-2">
       <div><p className="font-bold">{o.beneficiary_type==='merchant'?'Negocio':'Repartidor'} · {o.status==='paid'?'Pagado':o.status==='partial'?'Abono parcial':'Pendiente'}</p>
        <p className="mt-1 text-xs text-slate-500">Pedido {o.order_id.slice(0,8)} · {o.merchant_local_id||o.driver_id}</p></div>
       <div className="text-right"><p className="text-lg font-extrabold">{usd(remaining)}</p><p className="text-xs text-slate-500">De {usd(Number(o.amount_due))} · transferido {usd(Number(o.amount_paid))}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
       {remaining>0&&<button onClick={()=>{setCurrent(o);setAmount(remaining.toFixed(2));setReference('');setDate(today())}} disabled={!!busy} className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-40">Registrar transferencia</button>}
       {o.beneficiary_type==='merchant'&&<button onClick={()=>void sync(o)} disabled={!!busy} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-40"><Send size={15}/>Sincronizar ERP</button>}
       {o.status==='paid'&&<span className="inline-flex items-center gap-1 text-sm text-emerald-700"><CheckCircle2 size={16}/>Completamente pagado</span>}
      </div>
     </article>
    })}
   </div>
  </div>
  {current&&<div className="fixed inset-0 z-[500] flex items-center justify-center bg-black/60 p-4">
   <div className="w-full max-w-md space-y-4 rounded-2xl bg-white p-6"><h3 className="text-lg font-extrabold">Registrar transferencia efectuada</h3>
    <p className="text-sm text-slate-500">Se registra un abono, no una orden bancaria. Confirma el movimiento en tu banco antes de guardar.</p>
    <label className="block text-sm">Importe (USD)<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label>
    <label className="block text-sm">Referencia de transferencia<input value={reference} onChange={e=>setReference(e.target.value)} maxLength={120} className="mt-1 w-full rounded-xl border p-3"/></label>
    <label className="block text-sm">Fecha<input type="date" value={date} max={today()} onChange={e=>setDate(e.target.value)} className="mt-1 w-full rounded-xl border p-3"/></label>
    <div className="flex gap-3"><button disabled={!!busy} onClick={()=>setCurrent(null)} className="flex-1 rounded-xl border p-3">Cancelar</button>
     <button disabled={!!busy} onClick={()=>void pay()} className="flex-1 rounded-xl bg-orange-500 p-3 font-bold text-white disabled:opacity-50">Confirmar pago</button></div>
   </div>
  </div>}
 </section>
}
