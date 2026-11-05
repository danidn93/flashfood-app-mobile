import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check, MapPin, Pencil, Plus, Trash2, LocateFixed } from 'lucide-react'
import {
  direccionSeleccionada, eliminarDireccion, guardarDireccion, listarDirecciones,
  seleccionarDireccion, usuarioDirecciones, type DireccionEntrega,
} from '../services/direcciones'

type Formulario = { label: string; address_line: string; city: string; reference: string; latitude: number|null; longitude: number|null }
const empty: Formulario = { label: 'Casa', address_line: '', city: '', reference: '', latitude: null, longitude: null }

export default function DireccionesPage() {
  const navigate = useNavigate()
  const [lista, setLista] = useState<DireccionEntrega[]>([])
  const [seleccionada, setSeleccionada] = useState<string|null>(null)
  const [autenticado, setAutenticado] = useState<boolean|null>(null)
  const [form, setForm] = useState<Formulario|null>(null)
  const [editing, setEditing] = useState<string|null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  async function reload() {
    const user = await usuarioDirecciones()
    setAutenticado(Boolean(user))
    if (!user) return
    const [rows, selected] = await Promise.all([listarDirecciones(), direccionSeleccionada()])
    setLista(rows)
    setSeleccionada(selected?.id || null)
  }
  useEffect(() => {
    void reload().catch(e=>setError(e instanceof Error?e.message:'No se pudieron consultar las direcciones.'))
  }, [])
  const setField = <K extends keyof Formulario>(key: K, value: Formulario[K]) => setForm(old=> old?{...old,[key]:value}:old)
  const save = async () => {
    if (!form || busy) return
    if (form.label.trim().length < 1 || form.address_line.trim().length < 5 || form.city.trim().length < 2) {
      setError('Ingresa un nombre, una dirección completa y una ciudad.')
      return
    }
    setBusy(true);setError('')
    try {
      await guardarDireccion({
        label:form.label.trim(), address_line:form.address_line.trim(), city:form.city.trim(),
        reference:form.reference.trim(), latitude:form.latitude, longitude:form.longitude,
      }, editing || undefined)
      setForm(null);setEditing(null)
      await reload()
      setInfo('Dirección guardada y seleccionada.')
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo guardar la dirección.')}
    finally {setBusy(false)}
  }
  const select = async (id: string) => {
    setBusy(true);setError('')
    try {await seleccionarDireccion(id);await reload();navigate(-1)}
    catch(e){setError(e instanceof Error?e.message:'No se pudo seleccionar.')}
    finally{setBusy(false)}
  }
  const remove = async (id:string) => {
    if(!window.confirm('¿Eliminar esta dirección?'))return
    setBusy(true);setError('')
    try{await eliminarDireccion(id);await reload()}catch(e){setError(e instanceof Error?e.message:'No se pudo eliminar.')}
    finally{setBusy(false)}
  }
  const gps = () => {
    if(!navigator.geolocation){setError('Este dispositivo no permite obtener la ubicación.');return}
    setBusy(true);setError('')
    navigator.geolocation.getCurrentPosition(
      p=>{setField('latitude',p.coords.latitude);setField('longitude',p.coords.longitude);setBusy(false);setInfo('Ubicación capturada. Completa también la dirección escrita para facilitar la entrega.')},
      ()=>{setBusy(false);setError('No fue posible obtener tu ubicación. Revisa los permisos del dispositivo.')},
      {enableHighAccuracy:true,timeout:12000,maximumAge:30000},
    )
  }
  return <main className="mx-auto min-h-full max-w-2xl bg-[#F7F8FA] px-4 pb-36 pt-6">
    <div className="mb-6 flex items-center gap-3">
      <button type="button" onClick={()=>navigate(-1)} aria-label="Volver" className="rounded-full bg-white p-3"><ArrowLeft size={20}/></button>
      <div><h1 className="text-xl font-extrabold">Mis direcciones</h1><p className="text-sm text-gray-500">Selecciona dónde deseas recibir tus pedidos.</p></div>
    </div>
    {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {info && <p role="status" className="mb-3 rounded-xl bg-green-50 p-3 text-sm text-green-800">{info}</p>}
    {autenticado===false ? <section className="rounded-2xl bg-white p-5">
      <p className="mb-4 text-sm">Inicia sesión para guardar y seleccionar tus direcciones de entrega.</p>
      <button onClick={()=>navigate('/login')} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white">Iniciar sesión</button>
    </section> : <>
      <div className="space-y-3">
        {lista.map(a=><article key={a.id} className={`rounded-2xl border bg-white p-4 ${a.id===seleccionada?'border-orange-500':'border-gray-100'}`}>
          <div className="flex items-start gap-3">
            <MapPin className="mt-1 shrink-0 text-orange-500" size={21}/>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b>{a.label}</b>{a.id===seleccionada&&<span className="rounded-full bg-orange-50 px-2 py-1 text-xs text-orange-700">Seleccionada</span>}</div>
              <p className="mt-1 text-sm">{a.address_line}</p><p className="text-xs text-gray-500">{a.city}{a.reference?' · '+a.reference:''}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button disabled={busy} onClick={()=>void select(a.id)} className="inline-flex items-center gap-1 rounded-xl bg-orange-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-40"><Check size={16}/>Usar dirección</button>
            <button disabled={busy} onClick={()=>{setEditing(a.id);setForm({label:a.label,address_line:a.address_line,city:a.city,reference:a.reference,latitude:a.latitude,longitude:a.longitude});setInfo('')}} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm"><Pencil size={16}/>Editar</button>
            <button disabled={busy} onClick={()=>void remove(a.id)} className="inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-sm text-red-600"><Trash2 size={16}/>Eliminar</button>
          </div>
        </article>)}
      </div>
      {!form && <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-orange-300 bg-white p-4 font-bold text-orange-600" onClick={()=>{setForm({...empty});setEditing(null);setInfo('')}}><Plus size={20}/>Añadir dirección</button>}
      {form && <section className="mt-5 space-y-4 rounded-2xl bg-white p-5 shadow-sm">
        <h2 className="font-extrabold">{editing?'Editar dirección':'Nueva dirección'}</h2>
        <label className="block text-sm font-medium">Nombre de la dirección<input value={form.label} maxLength={60} onChange={e=>setField('label',e.target.value)} className="mt-2 w-full rounded-xl border p-3" placeholder="Casa, trabajo..."/></label>
        <label className="block text-sm font-medium">Ciudad<input value={form.city} maxLength={100} onChange={e=>setField('city',e.target.value)} className="mt-2 w-full rounded-xl border p-3" placeholder="Milagro"/></label>
        <label className="block text-sm font-medium">Dirección completa<input value={form.address_line} maxLength={250} onChange={e=>setField('address_line',e.target.value)} className="mt-2 w-full rounded-xl border p-3" placeholder="Calles, número, barrio o urbanización"/></label>
        <label className="block text-sm font-medium">Referencia adicional<textarea value={form.reference} maxLength={400} rows={3} onChange={e=>setField('reference',e.target.value)} className="mt-2 w-full rounded-xl border p-3" placeholder="Casa de dos pisos, portón negro..."/></label>
        <button type="button" disabled={busy} onClick={gps} className="flex items-center gap-2 rounded-xl border border-orange-200 px-4 py-3 text-sm font-bold text-orange-600"><LocateFixed size={18}/>{form.latitude!==null?'Ubicación GPS guardada':'Usar mi ubicación GPS (opcional)'}</button>
        <p className="text-xs text-gray-500">El GPS guarda coordenadas; debes completar las calles manualmente. La cobertura del delivery se comprobará al confirmar el pedido.</p>
        <div className="flex gap-2"><button type="button" onClick={()=>{setForm(null);setEditing(null)}} className="flex-1 rounded-xl border p-3">Cancelar</button><button type="button" disabled={busy} onClick={()=>void save()} className="flex-1 rounded-xl bg-orange-500 p-3 font-bold text-white disabled:opacity-50">{busy?'Guardando...':'Guardar dirección'}</button></div>
      </section>}
      {lista.length===0&&!form&&<p className="mt-4 text-center text-sm text-gray-500">Aún no tienes direcciones registradas.</p>}
    </>}
  </main>
}
