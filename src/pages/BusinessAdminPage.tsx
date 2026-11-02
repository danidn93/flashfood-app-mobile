import { useState, type ReactNode } from 'react'
import { ArrowLeft, ClipboardList, Package, Settings, Store, Users, Save } from 'lucide-react'
import { useNavigate } from 'react-router-dom'

type Tab = 'dashboard' | 'orders' | 'products' | 'employees' | 'settings'
type Props = {
  businessName: string
  businessId: string
  freeDelivery: boolean
  onSaveFreeDelivery: (businessId: string, enabled: boolean) => Promise<void>
  employeeTools?: ReactNode
}
const items = [
  { id: 'dashboard', label: 'Resumen', icon: Store },
  { id: 'orders', label: 'Pedidos', icon: ClipboardList },
  { id: 'products', label: 'Productos', icon: Package },
  { id: 'employees', label: 'Empleados', icon: Users },
  { id: 'settings', label: 'Configuración', icon: Settings },
] as const
export default function BusinessAdminPage({ businessName, businessId, freeDelivery, onSaveFreeDelivery, employeeTools }: Props) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('dashboard')
  const [enabled, setEnabled] = useState(freeDelivery)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function save() {
    setSaving(true); setMessage(''); setError('')
    try { await onSaveFreeDelivery(businessId, enabled); setMessage('Configuración guardada correctamente.') }
    catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la configuración.') }
    finally { setSaving(false) }
  }
  return (
    <div className="min-h-full bg-slate-50 pb-28 text-slate-900 lg:flex">
      <aside className="bg-slate-950 p-5 text-white lg:min-h-full lg:w-72 lg:shrink-0">
        <div className="mb-6 flex items-center gap-3"><img src="/flashfood-logo.png" alt="FlashFood" className="h-12 w-12 shrink-0 rounded-xl object-contain"/><div><strong className="block text-lg">FlashFood</strong><span className="text-xs text-slate-400">Administración de negocio</span></div></div>
        <p className="mb-4 break-words text-sm text-slate-300">{businessName}</p>
        <nav className="flex gap-2 overflow-x-auto lg:flex-col">{items.map(({id,label,icon:Icon}) => <button key={id} onClick={() => setTab(id)} className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-3 text-left text-sm ${tab === id ? 'bg-orange-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}><Icon size={18}/>{label}</button>)}</nav>
        <button onClick={() => navigate('/perfil')} className="mt-6 flex items-center gap-2 text-sm text-slate-300"><ArrowLeft size={17}/>Volver a mi perfil</button>
      </aside>
      <main className="min-w-0 flex-1 p-5 md:p-8">
        <h1 className="mb-6 text-2xl font-extrabold">{items.find(x => x.id === tab)?.label}</h1>
        {tab === 'settings' ? <section className="max-w-2xl rounded-2xl border bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold">Delivery gratis para clientes</h2>
          <p className="mt-2 text-sm text-slate-600">Si está activo, el cliente verá envío GRATIS. El negocio asume el costo real del delivery, que se registra para liquidar al repartidor. La propina y el recargo por tarjeta siguen a cargo del cliente.</p>
          <label className="mt-6 flex items-center justify-between gap-4 rounded-xl bg-slate-50 p-4">
            <span className="font-semibold">Ofrecer delivery gratis</span>
            <input type="checkbox" role="switch" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="h-6 w-6 accent-orange-500" />
          </label>
          <p className="mt-3 text-xs text-slate-500">Se aplicará a pedidos nuevos. Los pedidos confirmados conservan sus importes originales.</p>
          {error && <p role="alert" className="mt-4 text-sm text-red-600">{error}</p>}
          {message && <p role="status" className="mt-4 text-sm text-green-700">{message}</p>}
          <button onClick={() => void save()} disabled={saving || enabled === freeDelivery} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-semibold text-white disabled:opacity-50"><Save size={18}/>{saving ? 'Guardando…' : 'Guardar configuración'}</button>
        </section> : tab === 'employees' && employeeTools ? employeeTools : <section className="max-w-2xl rounded-2xl border bg-white p-6 shadow-sm"><p className="font-semibold">{items.find(x => x.id === tab)?.label} de {businessName}</p><p className="mt-2 text-sm text-slate-600">Este módulo se conectará a las operaciones autorizadas del negocio. No se muestran datos simulados.</p></section>}
      </main>
    </div>
  )
}
