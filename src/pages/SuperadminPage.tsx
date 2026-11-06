import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import FlashFoodMobileOperations from '../components/marketplace/FlashFoodMobileOperations'
import FlashFoodFiscalSettings from '../components/marketplace/FlashFoodFiscalSettings'
import FlashFoodSettlements from '../components/marketplace/FlashFoodSettlements'
import { assignBusinessRole, loadBusinesses, type Business } from '../services/roles'
import { AlertCircle, Bike, ClipboardList, CreditCard, LayoutDashboard, RefreshCw, Settings, Store, Users, Search, Menu, X, Save, Pencil, Building2, ShieldCheck, ArrowLeft, BellRing, Send } from 'lucide-react'

type Section = 'dashboard' | 'restaurants' | 'branches' | 'catalog' | 'orders' | 'drivers' | 'users' | 'roles' | 'availability' | 'settings' | 'notifications' | 'fiscal' | 'settlements'
type Row = Record<string, unknown>
type DeliveryConfig = {
  base_fee: number
  included_km: number
  additional_km_fee: number
  night_fee: number
  rain_fee: number
  night_start: string
  night_end: string
  rain_enabled: boolean
}
const defaultDelivery: DeliveryConfig = {
  base_fee: 2, included_km: 2, additional_km_fee: 0.25,
  night_fee: 0.50, rain_fee: 1, night_start: '22:00', night_end: '06:00', rain_enabled: false,
}
type Dashboard = { restaurants: number; branches: number; published_restaurants: number; published_branches: number; orders: number; drivers: number; users: number; gross_sales: number }
const menu = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'restaurants', label: 'Restaurantes', icon: Store },
  { id: 'branches', label: 'Sucursales', icon: Building2 },
  { id: 'catalog', label: 'Catálogo publicado', icon: Store },
  { id: 'availability', label: 'Activación marketplace', icon: ShieldCheck },
  { id: 'orders', label: 'Pedidos', icon: ClipboardList },
  { id: 'drivers', label: 'Repartidores', icon: Bike },
  { id: 'users', label: 'Usuarios', icon: Users },
  { id: 'notifications', label: 'Notificaciones', icon: BellRing },
  { id: 'roles', label: 'Roles', icon: ShieldCheck },
  { id: 'settings', label: 'Configuración', icon: Settings },
  { id: 'fiscal', label: 'Facturación SRI', icon: CreditCard },
  { id: 'settlements', label: 'Liquidaciones', icon: CreditCard },
] as const
const configs: Partial<Record<Section, { title: string; columns: string[]; entity?: string; fields?: Record<string, 'text' | 'bool' | 'json'> }>> = {
  restaurants: { title: 'Restaurantes registrados', columns: ['nombre', 'nombre_comercial', 'activo', 'id'], entity: 'restaurant', fields: { nombre: 'text', nombre_comercial: 'text', activo: 'bool' } },
  branches: { title: 'Sucursales registradas', columns: ['nombre', 'direccion', 'telefono', 'activo', 'id'], entity: 'branch', fields: { nombre: 'text', direccion: 'text', telefono: 'text', activo: 'bool' } },
  catalog: { title: 'Restaurantes publicados en la app', columns: ['restaurante', 'sucursal', 'direccion', 'abierto', 'acepta_pedidos'] },
  availability: { title: 'Disponibilidad para el marketplace', columns: ['source_business_id', 'source_branch_id', 'marketplace_enabled', 'accepting_orders'], entity: 'availability', fields: { marketplace_enabled: 'bool', accepting_orders: 'bool' } },
  orders: { title: 'Pedidos del marketplace', columns: ['order_number', 'status', 'payment_status', 'grand_total', 'created_at'] },
  drivers: { title: 'Repartidores', columns: ['full_name', 'phone', 'availability', 'verified', 'active'], entity: 'driver', fields: { full_name: 'text', phone: 'text', availability: 'text', verified: 'bool', active: 'bool' } },
  users: { title: 'Cuentas de usuarios', columns: ['name', 'email', 'phone', 'banned_until', 'id'], entity: 'user', fields: { name: 'text', phone: 'text', ban: 'bool' } },
  roles: { title: 'Roles asignados', columns: ['user_id', 'role', 'active', 'created_at'], entity: 'role' },
  notifications: { title: 'Campañas push', columns: ['title', 'audience', 'status', 'created_at'] },
  settings: { title: 'Configuración global', columns: ['key', 'value', 'updated_at'], entity: 'setting', fields: { value: 'json' } },
}
const labels: Record<string, string> = { nombre: 'Nombre', nombre_comercial: 'Nombre comercial', activo: 'Activo', direccion: 'Dirección', telefono: 'Teléfono', full_name: 'Nombre completo', phone: 'Teléfono', name: 'Nombre', email: 'Correo', active: 'Activo', verified: 'Verificado', availability: 'Disponibilidad', marketplace_enabled: 'Visible en marketplace', accepting_orders: 'Acepta pedidos', role: 'Rol', user_id: 'ID de usuario', order_number: 'Pedido', status: 'Estado', payment_status: 'Pago', grand_total: 'Total', created_at: 'Fecha', banned_until: 'Suspensión', source_business_id: 'Restaurante ID', source_branch_id: 'Sucursal ID', key: 'Clave', value: 'Valor', updated_at: 'Actualización', id: 'ID', ban: 'Suspender cuenta' }
const currency = (n: number) => new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD' }).format(n)
function show(value: unknown, key = ''): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  if (key === 'grand_total') return currency(Number(value))
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
export default function SuperadminPage() {
  const navigate = useNavigate()
  const [section, setSection] = useState<Section>('dashboard')
  const [rows, setRows] = useState<Row[]>([])
  const [dashboard, setDashboard] = useState<Dashboard | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [sidebar, setSidebar] = useState(false)
  const [edit, setEdit] = useState<Row | null>(null)
  const [changes, setChanges] = useState<Row>({})
  const [delivery, setDelivery] = useState<DeliveryConfig>(defaultDelivery)
  const [deliverySaved, setDeliverySaved] = useState(false)
  const [previewKm, setPreviewKm] = useState('5')
  const [previewNight, setPreviewNight] = useState(false)
  const [cardFee, setCardFee] = useState('15')
  const [cardSettingExists, setCardSettingExists] = useState(false)
  const [driverOpen, setDriverOpen] = useState(false)
  const [driverName, setDriverName] = useState('')
  const [driverEmail, setDriverEmail] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [driverInvite, setDriverInvite] = useState(false)
  const [createOpen,setCreateOpen]=useState(false)
  const [createName,setCreateName]=useState('')
  const [createEmail,setCreateEmail]=useState('')
  const [createRole,setCreateRole]=useState('cliente')
  const [createBusiness,setCreateBusiness]=useState('')
  const [roleEmail,setRoleEmail]=useState('')
  const [roleBusiness,setRoleBusiness]=useState('')
  const [roleInvite,setRoleInvite]=useState(false)
  const [businessChoices,setBusinessChoices]=useState<Business[]>([])
  const [roleUser, setRoleUser] = useState('')
  const [roleName, setRoleName] = useState('')
  const [roleActive, setRoleActive] = useState(true)
  const [pushTitle, setPushTitle] = useState('')
  const [pushMessage, setPushMessage] = useState('')
  const [pushAudience, setPushAudience] = useState('all')
  const [pushDevices, setPushDevices] = useState(0)
  const [pushConfirm, setPushConfirm] = useState<string | null>(null)

  const invoke = useCallback(async (action: string, args: Row = {}) => {
    const { data, error: callError } = await supabase.functions.invoke('flashfood-superadmin', { body: { action, ...args } })
    if (callError) throw new Error(callError.message)
    if (!data?.ok) throw new Error(data?.error || 'No se pudo completar la operación')
    return data
  }, [])
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (section === 'fiscal' || section === 'settlements') { setRows([]); return }
      const result = await invoke(section, { page })
      if (section === 'dashboard') setDashboard(result.dashboard as Dashboard)
      else if (section === 'notifications') {
        setRows(Array.isArray(result.rows) ? result.rows : [])
        setPushDevices(Number(result.devices || 0))
      }
      else if (section === 'settings') {
        const found = (result.rows as Row[] || []).find(r => r.key === 'card_surcharge_percent')
        setCardSettingExists(Boolean(found))
        setCardFee(String(typeof found?.value === 'number' ? found.value : 15))
        const savedDelivery = (result.rows as Row[] || []).find(r => r.key === 'delivery_global_tariff')
        setDeliverySaved(Boolean(savedDelivery))
        if (savedDelivery?.value && typeof savedDelivery.value === 'object' && !Array.isArray(savedDelivery.value)) {
          setDelivery({ ...defaultDelivery, ...(savedDelivery.value as Partial<DeliveryConfig>) })
        } else setDelivery(defaultDelivery)
      }
      else setRows(Array.isArray(result.rows) ? result.rows : [])
    } catch (e) { setError(e instanceof Error ? e.message : 'Error inesperado') }
    finally { setLoading(false) }
  }, [section, page, invoke])
  useEffect(() => { queueMicrotask(() => { void load() }) }, [load])
  const config = configs[section]
  const filtered = useMemo(() => rows.filter(row => JSON.stringify(row).toLowerCase().includes(query.toLowerCase())), [rows, query])
  const choose = (id: Section) => { setSection(id); setPage(1); setQuery(''); setEdit(null); setSidebar(false); setNotice('') }
  const startEdit = (row: Row) => {
    setEdit(row); setChanges({}); setError('')
    if (section === 'roles') { setRoleUser(String(row.user_id ?? '')); setRoleName(String(row.role ?? '')); setRoleActive(row.active === true) }
  }
  const save = async () => {
    if (!edit || !config) return
    setSaving(true); setError(''); setNotice('')
    try {
      if (section === 'roles') await invoke('set_role', { user_id: roleUser, role: roleName, active: roleActive })
      else if (section === 'users') await invoke('update_user', { id: edit.id, changes })
      else if (config.entity) await invoke('update', { entity: config.entity, id: edit.id, changes })
      setEdit(null); setNotice('Cambios guardados correctamente'); await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar') }
    finally { setSaving(false) }
  }
  const saveCardFee = async () => {
    const percent = Number(cardFee)
    if (!Number.isFinite(percent) || percent < 0 || percent > 25) { setError('El recargo debe estar entre 0 y 25 %.'); return }
    setSaving(true); setError(''); setNotice('')
    try { await invoke('save_card_surcharge', { percent }); setCardSettingExists(true); setNotice('Recargo de tarjeta guardado'); await load() }
    catch (e) { setError(e instanceof Error ? e.message : 'Error al guardar') }
    finally { setSaving(false) }
  }
  const saveDelivery = async () => {
    const fields: (keyof Pick<DeliveryConfig, 'base_fee' | 'included_km' | 'additional_km_fee' | 'night_fee' | 'rain_fee'>)[] =
      ['base_fee', 'included_km', 'additional_km_fee', 'night_fee', 'rain_fee']
    if (fields.some(field => !Number.isFinite(delivery[field]) || delivery[field] < 0)) {
      setError('Los valores de delivery deben ser números positivos o cero.'); return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      await invoke('save_global_delivery', { delivery })
      setDeliverySaved(true)
      setNotice('Tarifa global de delivery guardada correctamente')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Error al guardar delivery') }
    finally { setSaving(false) }
  }
  const setDeliveryNumber = (key: 'base_fee' | 'included_km' | 'additional_km_fee' | 'night_fee' | 'rain_fee', raw: string) => {
    setDelivery(old => ({ ...old, [key]: raw === '' ? 0 : Number(raw) }))
  }
  const previewExtra = Math.max(0, Number(previewKm || 0) - delivery.included_km)
  const previewTotal = delivery.base_fee + previewExtra * delivery.additional_km_fee +
    (previewNight ? delivery.night_fee : 0) + (delivery.rain_enabled ? delivery.rain_fee : 0)
  const registerDriver = async () => {
    if (driverName.trim().length < 3 || !driverEmail.includes('@')) {
      setError('Ingresa nombre y correo del repartidor')
      return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await invoke('driver_register', {
        full_name: driverName.trim(), email: driverEmail.trim().toLowerCase(),
        phone: driverPhone.trim(), invite: driverInvite,
      })
      setDriverOpen(false)
      setNotice(result.invited
        ? 'Repartidor invitado. Verifica su perfil y habilítalo cuando esté listo.'
        : 'Rol delivery asignado y perfil vinculado. Verifica y habilita al repartidor.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo registrar el repartidor') }
    finally { setSaving(false) }
  }
  const openCreateUser=()=>{
    setCreateOpen(true);setCreateName('');setCreateEmail('');setCreateRole('cliente');setCreateBusiness('');setError('')
    void loadBusinesses().then(r=>setBusinessChoices(r.businesses)).catch(e=>setError(e instanceof Error?e.message:'No se pudieron cargar los negocios'))
  }
  const submitCreateUser=async()=>{
    if(createName.trim().length<3||!createEmail.includes('@')){setError('Indica el nombre completo y correo del usuario');return}
    if((createRole==='admin'||createRole==='empleado')&&!createBusiness){setError('Selecciona el negocio del usuario');return}
    setSaving(true);setError('');setNotice('')
    try{
      await invoke('create_user',{name:createName.trim(),email:createEmail.trim().toLowerCase(),role:createRole,business_id:(createRole==='admin'||createRole==='empleado')?createBusiness:null})
      setCreateOpen(false);setNotice('Usuario invitado correctamente. Debe aceptar la invitación enviada a su correo.');await load()
    }catch(e){setError(e instanceof Error?e.message:'No se pudo crear el usuario')}
    finally{setSaving(false)}
  }
  const saveRoleByEmail=async()=>{
    if(!roleEmail.includes('@')||!roleName){setError('Indica correo y rol');return}
    setSaving(true);setError('');setNotice('')
    try{
      if(roleName==='admin'||roleName==='empleado'){
        if(!roleBusiness)throw new Error('Selecciona un negocio')
        await assignBusinessRole(roleEmail,roleBusiness,roleName,roleActive,null,roleInvite)
      }else await invoke('set_role_by_email',{email:roleEmail,role:roleName,active:roleActive,invite:roleInvite})
      setNotice('Rol asignado a '+roleEmail);await load()
    }catch(e){setError(e instanceof Error?e.message:'No se pudo asignar')}
    finally{setSaving(false)}
  }
  const createPushCampaign = async () => {
    if (pushTitle.trim().length < 3 || pushMessage.trim().length < 3) {
      setError('Indica un título y un mensaje de al menos 3 caracteres.')
      return
    }
    setSaving(true); setError(''); setNotice('')
    try {
      await invoke('notification_create', { title: pushTitle.trim(), message: pushMessage.trim(), audience: pushAudience })
      setPushTitle(''); setPushMessage('')
      setNotice('Campaña guardada como borrador.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar la campaña') }
    finally { setSaving(false) }
  }
  const sendPushCampaign = async (campaignId: string) => {
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await invoke('notification_send', { id: campaignId })
      setNotice(`Envío procesado: ${result.sent || 0} aceptadas por el servicio push, ${result.failed || 0} fallidas.`)
      setPushConfirm(null)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo enviar la campaña') }
    finally { setSaving(false) }
  }
  return <div className="flashfood-admin-screen overflow-hidden bg-slate-50 text-slate-900 lg:flex">
    {sidebar && <button className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={() => setSidebar(false)} aria-label="Cerrar menú" />}
    <aside className={`flashfood-admin-sidebar ${sidebar ? 'translate-x-0' : '-translate-x-full'} fixed bottom-0 left-0 z-40 flex w-72 flex-col bg-slate-950 p-5 text-white transition-transform lg:sticky lg:top-0 lg:h-full lg:translate-x-0`}>
      <div className="mb-8 flex items-center gap-3"><img src="/flashfood-logo.png" className="h-14 w-14 rounded-xl object-contain" alt="Logo FlashFood" /><div><div className="text-xl font-extrabold">FlashFood</div><div className="text-sm text-slate-400">Superadministración</div></div></div>
      <nav className="flex-1 space-y-1 overflow-y-auto">{menu.map(item => <button key={item.id} onClick={() => choose(item.id)} className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-sm font-semibold ${section === item.id ? 'bg-orange-500 text-white' : 'text-slate-300 hover:bg-slate-800'}`}><item.icon size={19}/>{item.label}</button>)}</nav>
      <button onClick={() => navigate('/perfil')} className="mt-3 flex items-center gap-2 rounded-xl p-3 text-slate-300 hover:bg-slate-800"><ArrowLeft size={18}/> Volver a mi perfil</button>
    </aside>
    <main className="h-full min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 md:p-8" style={{ paddingBottom: "calc(10rem + env(safe-area-inset-bottom, 0px))", WebkitOverflowScrolling: "touch" }}>
      <header className="mb-6 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><button className="rounded-xl bg-white p-3 shadow lg:hidden" onClick={() => setSidebar(true)} aria-label="Abrir menú"><Menu/></button><div><p className="text-sm text-slate-500">Panel global</p><h1 className="text-2xl font-extrabold">{menu.find(x => x.id === section)?.label}</h1></div></div><button onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-3 text-sm font-semibold disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/> Actualizar</button></header>
      {error && <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle size={18}/>{error}</div>}
      {notice && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-700">{notice}</div>}
      {section === 'notifications' ? <div className="space-y-6">
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-bold">Crear notificación</h2><p className="mt-1 text-sm text-slate-500">Primero guarda un borrador. Los envíos solo se realizan cuando existen dispositivos registrados y el servidor está configurado.</p></div>
            <span className="rounded-xl bg-orange-50 px-3 py-2 text-xs font-bold text-orange-700">Dispositivos activos: {pushDevices}</span>
          </div>
          <label className="block text-sm font-semibold">Título (3–100 caracteres)
            <input maxLength={100} value={pushTitle} onChange={e => setPushTitle(e.target.value)} placeholder="Ej. ¡Novedades en FlashFood!" className="mt-2 block w-full rounded-xl border p-3 font-normal" />
          </label>
          <label className="block text-sm font-semibold">Mensaje (3–500 caracteres)
            <textarea rows={4} maxLength={500} value={pushMessage} onChange={e => setPushMessage(e.target.value)} placeholder="Escribe el mensaje para tus usuarios..." className="mt-2 block w-full rounded-xl border p-3 font-normal" />
          </label>
          <label className="block text-sm font-semibold">Destinatarios
            <select value={pushAudience} onChange={e => setPushAudience(e.target.value)} className="mt-2 block w-full rounded-xl border p-3 font-normal">
              <option value="all">Todos los usuarios</option>
              <option value="customer">Clientes</option>
              <option value="merchant">Administradores de negocios</option>
              <option value="driver">Repartidores</option>
            </select>
          </label>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-bold text-slate-500">Vista previa</p>
            <p className="mt-2 font-bold">{pushTitle || 'Título de la notificación'}</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{pushMessage || 'El mensaje aparecerá aquí.'}</p>
          </div>
          <button type="button" disabled={saving || pushTitle.trim().length < 3 || pushMessage.trim().length < 3} onClick={() => void createPushCampaign()} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50">Guardar borrador</button>
        </section>
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <h2 className="border-b p-5 font-bold">Historial de campañas</h2>
          {!rows.length ? <p className="p-5 text-sm text-slate-500">Aún no existen campañas registradas.</p> : <div className="divide-y">{rows.map((campaign, i) => (
            <div key={String(campaign.id || i)} className="flex flex-wrap items-start justify-between gap-4 p-5">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{String(campaign.title || '')}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{String(campaign.message || '')}</p>
                <p className="mt-2 text-xs text-slate-500">Destino: {String(campaign.audience)} · Estado: {String(campaign.status)} · {new Date(String(campaign.created_at)).toLocaleString('es-EC')}</p>
                {campaign.status === 'sent' && <p className="mt-1 text-xs text-slate-500">Aceptadas: {String(campaign.sent_count || 0)} · Fallidas: {String(campaign.failed_count || 0)}</p>}
              </div>
              {campaign.status === 'draft' && (pushConfirm === campaign.id ?
                <div className="flex flex-col gap-2"><span className="text-xs font-semibold text-red-700">¿Enviar ahora a destinatarios reales?</span><div className="flex gap-2"><button disabled={saving} onClick={() => void sendPushCampaign(String(campaign.id))} className="rounded-lg bg-orange-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">Confirmar</button><button onClick={() => setPushConfirm(null)} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button></div></div> :
                <button disabled={saving || pushDevices === 0} onClick={() => setPushConfirm(String(campaign.id))} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"><Send size={16}/> Enviar</button>)}
            </div>
          ))}</div>}
        </section>
      </div> : section === 'fiscal' ? <FlashFoodFiscalSettings /> : section === 'settlements' ? <FlashFoodSettlements /> : section === 'settings' ? <div className="space-y-6">
        <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-lg font-bold">Recargo por pago con tarjeta</h2><p className="mt-1 text-sm text-slate-500">Porcentaje aplicado al pago con tarjeta. No se aplica a efectivo ni transferencia. Límite configurable: 25 %.</p><div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-medium">Porcentaje (%)<input type="number" min="0" max="25" step="0.01" className="mt-1 block w-40 rounded-xl border p-3" value={cardFee} onChange={e => setCardFee(e.target.value)}/></label><button disabled={saving} onClick={() => void saveCardFee()} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50">Guardar recargo</button></div><p className="mt-2 text-xs text-slate-500">{cardSettingExists ? 'Configuración existente' : 'Aún no se ha guardado esta configuración'}. El checkout debe consultar esta clave para aplicarla.</p></section>
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-5">
          <div><h2 className="text-lg font-bold">Tarifa global de delivery</h2><p className="mt-1 text-sm text-slate-500">Se aplica a todos los restaurantes. El envío se calcula según los kilómetros de recorrido desde la sucursal hasta el cliente, más los recargos aplicables.</p></div>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['base_fee','Tarifa base (USD)'],
              ['included_km','Kilómetros incluidos'],
              ['additional_km_fee','Valor por km adicional (USD)'],
              ['night_fee','Recargo nocturno (USD)'],
              ['rain_fee','Recargo por lluvia (USD)'],
            ] as const).map(([field, label]) => <label key={field} className="block text-sm font-medium">{label}<input type="number" min="0" step="0.01" value={delivery[field]} onChange={e => setDeliveryNumber(field,e.target.value)} className="mt-1 block w-full rounded-xl border p-3" /></label>)}
            <label className="block text-sm font-medium">Inicio de horario nocturno<input type="time" value={delivery.night_start} onChange={e => setDelivery(old => ({...old,night_start:e.target.value}))} className="mt-1 block w-full rounded-xl border p-3" /></label>
            <label className="block text-sm font-medium">Fin de horario nocturno<input type="time" value={delivery.night_end} onChange={e => setDelivery(old => ({...old,night_end:e.target.value}))} className="mt-1 block w-full rounded-xl border p-3" /></label>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 p-4">
            <div><p className="text-sm font-semibold text-slate-900">Recargo por lluvia</p><p className="text-xs text-slate-500">{delivery.rain_enabled ? 'Activado para todos los envíos' : 'Desactivado'}</p></div>
            <button type="button" role="switch" aria-checked={delivery.rain_enabled} aria-label="Activar o desactivar recargo por lluvia" onClick={() => setDelivery(old => ({...old,rain_enabled:!old.rain_enabled}))} className={`relative inline-flex h-8 w-14 shrink-0 items-center rounded-full transition-colors ${delivery.rain_enabled ? 'bg-orange-500' : 'bg-slate-300'}`}><span className={`inline-block h-6 w-6 rounded-full bg-white shadow transition-transform ${delivery.rain_enabled ? 'translate-x-7' : 'translate-x-1'}`} /></button>
          </div>
          <button disabled={saving || loading} onClick={() => void saveDelivery()} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar tarifa global'}</button>
          <p className="text-xs text-slate-500">{deliverySaved ? 'Configuración guardada en Supabase.' : 'Aún no se ha guardado la tarifa global.'} El checkout deberá leer esta configuración desde el backend para cobrar el envío.</p>
          <div className="rounded-xl bg-slate-50 p-4 space-y-3">
            <h3 className="font-bold">Simulador de envío</h3>
            <label className="block text-sm">Distancia por ruta (km)<input type="number" min="0" step="0.1" value={previewKm} onChange={e => setPreviewKm(e.target.value)} className="mt-1 block w-full rounded-xl border p-3" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={previewNight} onChange={e => setPreviewNight(e.target.checked)}/> Horario nocturno</label>
            <p className="text-xs text-slate-500">Lluvia: {delivery.rain_enabled ? `recargo de ${currency(delivery.rain_fee)} aplicado` : "recargo desactivado"}. Se controla desde el switch de arriba.</p>
            <p className="text-sm text-slate-600">Km adicionales: {previewExtra.toFixed(2)} · Costo adicional: {currency(previewExtra * delivery.additional_km_fee)}</p>
            <p className="text-xl font-extrabold">Total de envío: {currency(Math.round(previewTotal * 100) / 100)}</p>
          </div>
        </section>
      </div> : section === 'dashboard' ? <><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">{[
        ['Restaurantes registrados', dashboard?.restaurants, Store], ['Sucursales registradas', dashboard?.branches, Building2],
        ['Restaurantes publicados', dashboard?.published_restaurants, Store], ['Sucursales publicadas', dashboard?.published_branches, Building2],
        ['Pedidos marketplace', dashboard?.orders, ClipboardList], ['Repartidores', dashboard?.drivers, Bike],
        ['Roles activos', dashboard?.users, Users], ['Ventas pagadas marketplace', currency(dashboard?.gross_sales ?? 0), CreditCard],
      ].map(([label, value, Icon]) => { const I = Icon as typeof Store; return <div key={String(label)} className="rounded-2xl border bg-white p-5 shadow-sm"><I className="mb-3 text-orange-500" size={24}/><p className="text-sm text-slate-500">{String(label)}</p><p className="mt-2 text-2xl font-extrabold">{loading ? '…' : String(value ?? 0)}</p></div> })}</div><p className="mt-5 text-sm text-slate-500">Los pedidos y ventas corresponden a flashfood_orders. Los restaurantes y sucursales registrados se cuentan desde sus tablas originales.</p></> : <div className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><h2 className="font-bold">{config?.title}</h2><p className="text-xs text-slate-500">Página {page} · {rows.length} registros cargados</p></div><div className="flex flex-wrap gap-2">{section === 'drivers' && <button onClick={() => {setDriverName('');setDriverEmail('');setDriverPhone('');setDriverInvite(false);setDriverOpen(true);setError('')}} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white">+ Registrar repartidor</button>}{section === 'users' && <button onClick={openCreateUser} className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white">+ Crear usuario</button>}<label className="flex items-center gap-2 rounded-xl border px-3 py-2"><Search size={17}/><input className="w-40 outline-none" placeholder="Buscar en esta página" value={query} onChange={e => setQuery(e.target.value)}/></label></div></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="bg-slate-50"><tr>{config?.columns.map(key => <th key={key} className="px-4 py-3">{labels[key] || key}</th>)}{config?.entity && <th className="px-4 py-3">Acciones</th>}</tr></thead><tbody>{filtered.map((row, index) => <tr key={String(row.id ?? index)} className="border-t">{config?.columns.map(key => <td key={key} className="max-w-64 truncate px-4 py-3" title={show(row[key], key)}>{show(row[key], key)}</td>)}{config?.entity && <td className="px-4 py-3"><button onClick={() => startEdit(row)} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 font-semibold text-orange-600"><Pencil size={15}/> Editar</button></td>}</tr>)}</tbody></table>{!filtered.length && <p className="p-8 text-center text-slate-500">No hay registros en esta página.</p>}</div>
        <div className="flex justify-end gap-2 border-t p-4"><button disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">Anterior</button><button disabled={rows.length < 100 || loading} onClick={() => setPage(p => p + 1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">Siguiente</button></div>
      </div>}

      {section==='roles' && <section className="mb-5 rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">Asignar rol por correo</h2>
        <p className="mt-1 text-sm text-slate-500">Las cuentas mantienen su acceso como clientes. El administrador y empleado deben asignarse a un negocio.</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <input type="email" placeholder="correo@ejemplo.com" className="min-w-52 flex-1 rounded-xl border p-3" value={roleEmail} onChange={e=>setRoleEmail(e.target.value)}/>
          <select className="rounded-xl border p-3" value={roleName} onChange={e=>{setRoleName(e.target.value);void loadBusinesses().then(r=>setBusinessChoices(r.businesses)).catch(()=>{})}}>
            <option value="">Seleccionar rol</option><option value="superadmin">Superadmin</option><option value="admin">Administrador de negocio</option><option value="empleado">Empleado</option><option value="delivery">Repartidor</option>
          </select>
          {(roleName==='admin'||roleName==='empleado') && <select className="min-w-48 rounded-xl border p-3" value={roleBusiness} onChange={e=>setRoleBusiness(e.target.value)}>
            <option value="">Seleccionar negocio</option>{businessChoices.map(b=><option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>}
          <button onClick={()=>void saveRoleByEmail()} disabled={saving||!roleEmail.includes('@')||!roleName} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50">Guardar rol</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={roleActive} onChange={e=>setRoleActive(e.target.checked)}/> Rol activo</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={roleInvite} onChange={e=>setRoleInvite(e.target.checked)}/> Invitar si no existe</label>
        </div>
      </section>}

      {section === 'orders' && <FlashFoodMobileOperations />}
      {driverOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold">Registrar repartidor</h2>
            <button type="button" onClick={() => setDriverOpen(false)} aria-label="Cerrar"><X size={22}/></button>
          </div>
          <p className="text-sm text-slate-500">Si la cuenta existe, se vincula al perfil delivery. Si no existe, puedes invitarla. Los repartidores nuevos se crean sin verificar y desactivados hasta su aprobación.</p>
          <label className="block text-sm font-medium">Nombre completo<input className="mt-1 w-full rounded-xl border p-3" value={driverName} onChange={e=>setDriverName(e.target.value)} maxLength={150}/></label>
          <label className="block text-sm font-medium">Correo de la cuenta<input type="email" className="mt-1 w-full rounded-xl border p-3" value={driverEmail} onChange={e=>setDriverEmail(e.target.value)}/></label>
          <label className="block text-sm font-medium">Teléfono<input type="tel" className="mt-1 w-full rounded-xl border p-3" value={driverPhone} onChange={e=>setDriverPhone(e.target.value)} maxLength={30}/></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={driverInvite} onChange={e=>setDriverInvite(e.target.checked)}/> Enviar invitación si no existe la cuenta</label>
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={() => setDriverOpen(false)} className="rounded-xl border px-5 py-3">Cancelar</button>
            <button type="button" disabled={saving || driverName.trim().length<3 || !driverEmail.includes('@')} onClick={()=>void registerDriver()} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50">{saving?'Guardando…':'Registrar repartidor'}</button>
          </div>
        </div>
      </div>}
      {createOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
        <div className="max-h-[90dvh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
          <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Crear usuario FlashFood</h2><button type="button" aria-label="Cerrar" onClick={()=>setCreateOpen(false)}><X size={22}/></button></div>
          <p className="text-sm text-slate-500">Se enviará una invitación por correo para activar su cuenta. Todos los usuarios pueden realizar pedidos como clientes.</p>
          <label className="block text-sm font-medium">Nombre completo
            <input className="mt-1 w-full rounded-xl border p-3" value={createName} onChange={e=>setCreateName(e.target.value)} placeholder="Nombre y apellido" maxLength={150}/>
          </label>
          <label className="block text-sm font-medium">Correo electrónico
            <input type="email" className="mt-1 w-full rounded-xl border p-3" value={createEmail} onChange={e=>setCreateEmail(e.target.value)} placeholder="correo@ejemplo.com"/>
          </label>
          <label className="block text-sm font-medium">Rol inicial
            <select className="mt-1 w-full rounded-xl border p-3" value={createRole} onChange={e=>{setCreateRole(e.target.value);setCreateBusiness('')}}>
              <option value="cliente">Cliente</option><option value="admin">Administrador de negocio</option><option value="empleado">Empleado</option><option value="delivery">Delivery</option><option value="superadmin">Superadmin</option>
            </select>
          </label>
          {(createRole==='admin'||createRole==='empleado') && <label className="block text-sm font-medium">Negocio asignado
            <select className="mt-1 w-full rounded-xl border p-3" value={createBusiness} onChange={e=>setCreateBusiness(e.target.value)}>
              <option value="">Seleccionar negocio</option>{businessChoices.map(b=><option value={b.id} key={b.id}>{b.nombre}</option>)}
            </select>
          </label>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3"><button type="button" onClick={()=>setCreateOpen(false)} className="rounded-xl border px-5 py-3">Cancelar</button>
            <button type="button" disabled={saving||createName.trim().length<3||!createEmail.includes('@')||((createRole==='admin'||createRole==='empleado')&&!createBusiness)} onClick={()=>void submitCreateUser()} className="rounded-xl bg-orange-500 px-5 py-3 font-bold text-white disabled:opacity-50">{saving?'Creando…':'Crear y enviar invitación'}</button>
          </div>
        </div>
      </div>}
      {edit && config && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h2 className="text-xl font-bold">{section === 'roles' ? 'Asignar o modificar rol' : `Editar ${config.title.toLowerCase()}`}</h2><button onClick={() => setEdit(null)}><X/></button></div>
        {section === 'roles' ? <div className="space-y-4"><label className="block text-sm">ID de usuario<input className="mt-1 w-full rounded-lg border p-3" value={roleUser} onChange={e => setRoleUser(e.target.value)} placeholder="UUID de Auth"/></label><label className="block text-sm">Rol<input className="mt-1 w-full rounded-lg border p-3" value={roleName} onChange={e => setRoleName(e.target.value)} placeholder="superadmin, admin, delivery..."/></label><label className="flex gap-2"><input type="checkbox" checked={roleActive} onChange={e => setRoleActive(e.target.checked)}/> Rol activo</label></div> : <div className="space-y-4">{Object.entries(config.fields || {}).map(([key, kind]) => {
          const value = changes[key] !== undefined ? changes[key] : (key === 'ban' ? (edit.banned_until != null && new Date(String(edit.banned_until)) > new Date()) : edit[key])
          return <label key={key} className="block text-sm font-medium">{labels[key] || key}{kind === 'bool' ? <span className="mt-2 flex items-center gap-2"><input type="checkbox" checked={Boolean(value)} onChange={e => setChanges(old => ({ ...old, [key]: e.target.checked }))}/>{value ? 'Sí' : 'No'}</span> : kind === 'json' ? <textarea rows={5} className="mt-1 w-full rounded-lg border p-3 font-mono text-xs" value={typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)} onChange={e => { try { setChanges(old => ({ ...old, [key]: JSON.parse(e.target.value) })) } catch { setChanges(old => ({ ...old, [key]: e.target.value })) } }}/> : <input className="mt-1 w-full rounded-lg border p-3" value={String(value ?? '')} onChange={e => setChanges(old => ({ ...old, [key]: e.target.value }))}/>}</label>
        })}</div>}
        <div className="mt-6 flex justify-end gap-3"><button onClick={() => setEdit(null)} className="rounded-xl border px-4 py-3">Cancelar</button><button disabled={saving || (section !== 'roles' && !Object.keys(changes).length)} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-4 py-3 font-bold text-white disabled:opacity-50"><Save size={17}/>{saving ? 'Guardando…' : 'Guardar cambios'}</button></div></div></div>}
    </main>
  </div>
}
