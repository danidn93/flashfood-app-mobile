import {useCallback,useEffect,useState} from 'react'
import {MessageCircle,Send,RefreshCw} from 'lucide-react'
import {supabase} from '../../lib/supabase'
import {roleRequest} from '../../services/roles'
type Msg={id:string;sender_role:string;sender_name:string;message:string;created_at:string}
export default function FlashFoodOrderChat({orderId,merchant=false}:{orderId:string;merchant?:boolean}){
 const [messages,setMessages]=useState<Msg[]>([])
 const [stage,setStage]=useState('')
 const [text,setText]=useState('')
 const [busy,setBusy]=useState(false)
 const [canSend,setCanSend]=useState(false)
 const [error,setError]=useState('')
 const request=useCallback(async(action:string,params:Record<string,unknown>)=>{
  if(merchant)return roleRequest<{messages?:Msg[];can_send?:boolean;stage?:string}>('merchant_'+action,params)
  const {data,error:callError}=await supabase.functions.invoke('flashfood-mobile-orders',{
   body:{action:'chat_'+action,...params}
  })
  if(callError)throw new Error(callError.message)
  if(!data?.ok)throw new Error(data?.error||'No se pudo consultar el chat')
  return data
 },[merchant])
 const refresh=useCallback(async()=>{
  try{
   const data=await request('chat_list'.replace('chat_',''),{order_id:orderId})
   setMessages(data.messages||[])
   setStage(data.stage||'')
   setCanSend(data.can_send===true)
   setError('')
  }catch(e){setError(e instanceof Error?e.message:'No se pudo cargar el chat')}
 },[request,orderId])
 useEffect(()=>{
  queueMicrotask(()=>{void refresh()})
  const timer=window.setInterval(()=>{if(document.visibilityState==='visible')void refresh()},10000)
  return ()=>window.clearInterval(timer)
 },[refresh])
 const send=async()=>{
  if(!text.trim()||!canSend||busy)return
  setBusy(true);setError('')
  try{
   await request('send',{order_id:orderId,message:text.trim()})
   setText('')
   await refresh()
  }catch(e){setError(e instanceof Error?e.message:'No se pudo enviar el mensaje')}
  finally{setBusy(false)}
 }
 return <div className="rounded-2xl border bg-white p-4">
  <div className="flex items-center justify-between gap-3">
   <h3 className="flex items-center gap-2 font-bold"><MessageCircle size={18}/>Chat del pedido</h3>
   <button type="button" onClick={()=>void refresh()} aria-label="Actualizar chat" className="rounded-lg border p-2"><RefreshCw size={15}/></button>
  </div>
  {error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
  <div className="mt-3 max-h-72 space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-3">
   {!messages.length&&<p className="text-sm text-slate-500">Aún no hay mensajes.</p>}
   {messages.map(m=><div key={m.id} className="rounded-xl border bg-white p-3">
    <p className="text-xs font-semibold text-orange-700">{m.sender_name} · {m.sender_role} · {new Date(m.created_at).toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'})}</p>
    <p className="mt-1 whitespace-pre-wrap break-words text-sm">{m.message}</p>
   </div>)}
  </div>
  <p className="mt-2 text-xs text-slate-500">{stage==='retirando'||stage==='reparto'
    ? 'El repartidor atiende esta conversación y conserva el historial.'
    : 'El restaurante atiende hasta que un repartidor acepta.'}</p>
  {canSend?<div className="mt-3 flex gap-2">
    <input aria-label="Nuevo mensaje" maxLength={1500} value={text} onChange={e=>setText(e.target.value)}
      onKeyDown={e=>{if(e.key==='Enter')void send()}} className="min-w-0 flex-1 rounded-xl border px-3 py-2" placeholder="Escribe un mensaje..."/>
    <button type="button" disabled={busy||!text.trim()} onClick={()=>void send()} className="rounded-xl bg-orange-500 px-4 py-2 text-white disabled:opacity-40"><Send size={18}/></button>
  </div>:<p className="mt-3 text-xs text-slate-500">Esta conversación es de solo lectura para tu perfil.</p>}
 </div>
}
