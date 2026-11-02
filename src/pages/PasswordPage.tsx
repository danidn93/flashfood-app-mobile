import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { AlertCircle, CheckCircle2, Eye, EyeOff, LockKeyhole, LoaderCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Mode = 'invite' | 'recovery' | 'change'
type Status = 'checking' | 'ready' | 'expired' | 'done'
export default function PasswordPage({ mode }: { mode: Mode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [status, setStatus] = useState<Status>('checking')
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let mounted = true
    const initialize = async () => {
      try {
        if (mode === 'change') {
          const { data, error: authError } = await supabase.auth.getUser()
          if (authError || !data.user) throw new Error('Inicia sesión para modificar tu contraseña.')
          if (mounted) setStatus('ready')
          return
        }
        // Require a real invitation/recovery link; a pre-existing unrelated session is insufficient.
        const query = new URLSearchParams(window.location.search)
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const linkError = query.get('error_description') || hash.get('error_description')
        if (linkError) throw new Error(linkError)
        const code = query.get('code')
        const tokenHash = query.get('token_hash')
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        const linkType = hash.get('type') || query.get('type')
        const expectedType = mode === 'invite' ? 'invite' : 'recovery'
        if (linkType && linkType !== expectedType) throw new Error('Este enlace corresponde a otra operación de seguridad.')
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        } else if (tokenHash) {
          const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: expectedType })
          if (verifyError) throw verifyError
        } else if (accessToken && refreshToken) {
          const { error: sessionError } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
          if (sessionError) throw sessionError
        } else {
          throw new Error('El enlace no contiene un token válido. Solicita uno nuevo.')
        }
        const { data: sessionData, error: userError } = await supabase.auth.getUser()
        if (userError || !sessionData.user) throw new Error('No se pudo verificar tu identidad.')
        window.history.replaceState({}, '', window.location.pathname)
        if (mounted) setStatus('ready')
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'El enlace no es válido o ha expirado.')
          setStatus('expired')
        }
      }
    }
    void initialize()
    return () => { mounted = false }
  }, [mode, location.pathname])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    if (password.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return }
    if (mode === 'change' && !currentPassword) { setError('Ingresa tu contraseña actual.'); return }
    setSaving(true)
    try {
      if (mode === 'change') {
        const { data: account, error: accountError } = await supabase.auth.getUser()
        if (accountError || !account.user?.email) throw new Error('Tu cuenta no tiene un correo verificable.')
        const { error: verifyError } = await supabase.auth.signInWithPassword({ email: account.user.email, password: currentPassword })
        if (verifyError) throw new Error('La contraseña actual no es correcta.')
      }
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setPassword(''); setConfirmation(''); setCurrentPassword('')
      setStatus('done')
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo actualizar tu contraseña.') }
    finally { setSaving(false) }
  }

  const title = mode === 'invite' ? 'Activa tu cuenta FlashFood' : mode === 'recovery' ? 'Restablece tu contraseña' : 'Cambiar contraseña'
  const description = mode === 'invite' ? 'Establece una contraseña para ingresar con la cuenta que te invitó FlashFood.' : mode === 'recovery' ? 'Elige una nueva contraseña para recuperar el acceso a tu cuenta.' : 'Actualiza tu contraseña de forma segura.'
  return <main className="min-h-dvh bg-[#F7F8FA] px-4 pb-28 pt-10">
    <div className="mx-auto max-w-md rounded-3xl border border-gray-100 bg-white p-6 shadow-sm">
      <img src="/flashfood-logo.png" className="mx-auto h-20 w-20 object-contain" alt="FlashFood" />
      <h1 className="mt-5 text-center text-2xl font-extrabold text-gray-900">{title}</h1>
      <p className="mt-2 text-center text-sm leading-6 text-gray-500">{description}</p>
      {status === 'checking' && <p className="mt-8 flex justify-center gap-2 text-sm text-gray-600"><LoaderCircle size={18} className="animate-spin"/> Validando el acceso…</p>}
      {status === 'expired' && <div className="mt-6 rounded-xl bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="mb-2" size={20}/>{error}<p className="mt-2">Puedes solicitar un nuevo enlace desde la pantalla de inicio de sesión.</p><Link className="mt-4 inline-block font-bold text-orange-600" to="/login">Ir a iniciar sesión</Link></div>}
      {status === 'done' && <div className="mt-6 rounded-xl bg-green-50 p-4 text-center text-sm text-green-700"><CheckCircle2 size={30} className="mx-auto mb-2"/>Tu contraseña se actualizó correctamente.<button type="button" onClick={()=>navigate('/perfil',{replace:true})} className="mt-4 block w-full rounded-xl bg-orange-500 px-4 py-3 font-bold text-white">Ir a mi perfil</button></div>}
      {status === 'ready' && <form onSubmit={e=>void submit(e)} className="mt-6 space-y-4">
        {mode === 'change' && <label className="block text-sm font-semibold text-gray-700">Contraseña actual<input autoComplete="current-password" type="password" required value={currentPassword} onChange={e=>setCurrentPassword(e.target.value)} className="mt-1 w-full rounded-xl border px-4 py-3"/></label>}
        <label className="block text-sm font-semibold text-gray-700">Nueva contraseña
          <div className="mt-1 flex items-center gap-2 rounded-xl border px-3"><LockKeyhole size={18} className="text-gray-400"/><input autoComplete="new-password" type={showPassword?'text':'password'} required minLength={8} value={password} onChange={e=>setPassword(e.target.value)} className="min-w-0 flex-1 py-3 outline-none"/><button type="button" onClick={()=>setShowPassword(x=>!x)} aria-label={showPassword?'Ocultar contraseña':'Mostrar contraseña'}>{showPassword?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
        </label>
        <label className="block text-sm font-semibold text-gray-700">Confirmar contraseña<input autoComplete="new-password" type={showPassword?'text':'password'} required minLength={8} value={confirmation} onChange={e=>setConfirmation(e.target.value)} className="mt-1 w-full rounded-xl border px-4 py-3"/></label>
        <p className="text-xs text-gray-500">Utiliza al menos 8 caracteres. No compartas tu contraseña con nadie.</p>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        <button disabled={saving} type="submit" className="w-full rounded-xl bg-[#F97316] px-4 py-3 font-extrabold text-white disabled:opacity-50">{saving?'Guardando…':mode==='invite'?'Activar mi cuenta':'Guardar nueva contraseña'}</button>
      </form>}
      <Link to="/perfil" className="mt-6 block text-center text-sm font-semibold text-orange-600">Volver a FlashFood</Link>
    </div>
  </main>
}
