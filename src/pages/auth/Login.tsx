import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'

type RecoveryAccount = { id: string; username: string; avatar_url?: string; email: string }

export default function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const [recoveryMode, setRecoveryMode] = useState<'email'|'sms'>('email')
  const [recoveryPhone, setRecoveryPhone] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryNonce, setRecoveryNonce] = useState('')
  const [recoveryAccounts, setRecoveryAccounts] = useState<RecoveryAccount[]>([])
  const [recoveryStep, setRecoveryStep] = useState<'phone'|'code'|'account'>('phone')
  const [recoveryBusy, setRecoveryBusy] = useState(false)

  const accountAuth = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('yomy-account-auth', { body })
    if (error || data?.error) throw new Error(String(data?.error || error?.message || 'Recovery service failed'))
    return data
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      navigate('/')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const sendEmailRecovery = async () => {
    if (!email.trim()) return toast.error('Enter your email first')
    setRecoveryBusy(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), { redirectTo: window.location.origin + '/reset-password' })
      if (error) throw error
      toast.success('Password reset email sent')
      setRecoveryOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reset email')
    } finally {
      setRecoveryBusy(false)
    }
  }

  const sendSmsRecovery = async () => {
    setRecoveryBusy(true)
    try {
      await accountAuth({ action:'send_recovery_otp', phone:recoveryPhone })
      setRecoveryStep('code')
      toast.success('Recovery code sent by SMS')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send SMS')
    } finally { setRecoveryBusy(false) }
  }

  const verifySmsRecovery = async () => {
    setRecoveryBusy(true)
    try {
      const data = await accountAuth({ action:'verify_recovery_otp', phone:recoveryPhone, code:recoveryCode })
      setRecoveryNonce(String(data.nonce || ''))
      setRecoveryAccounts((data.accounts || []) as RecoveryAccount[])
      setRecoveryStep('account')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Recovery verification failed')
    } finally { setRecoveryBusy(false) }
  }

  const sendRecoveryLink = async (account: RecoveryAccount) => {
    setRecoveryBusy(true)
    try {
      await accountAuth({ action:'send_recovery_link', phone:recoveryPhone, nonce:recoveryNonce, user_id:account.id })
      toast.success('Reset link sent to your phone')
      setRecoveryOpen(false)
      setRecoveryStep('phone')
      setRecoveryNonce('')
      setRecoveryAccounts([])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reset link')
    } finally { setRecoveryBusy(false) }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-2"><h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 bg-clip-text text-transparent">YOMY</h1><p className="text-muted-foreground text-sm">Connect, share, and discover.</p></div>
        <Card className="border shadow-sm"><CardContent className="pt-6"><form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)} required /></div>
          <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" placeholder="••••••••" value={password} onChange={e=>setPassword(e.target.value)} required /></div>
          <div className="flex items-center justify-between gap-3"><Button type="submit" className="flex-1 rounded-xl" disabled={loading}>{loading ? <><Spinner className="size-4 mr-2" />Signing in...</> : 'Log in'}</Button><Button type="button" variant="ghost" className="rounded-xl text-xs" onClick={()=>setRecoveryOpen(true)}>Forgot password?</Button></div>
        </form><div className="mt-4 relative"><Separator /></div></CardContent></Card>
        <Card className="border shadow-sm"><CardHeader className="py-4 text-center"><p className="text-sm">Don&apos;t have an account? <Link to="/signup" className="text-primary font-semibold hover:underline">Sign up</Link></p></CardHeader></Card>
      </div>

      <Dialog open={recoveryOpen} onOpenChange={setRecoveryOpen}>
        <DialogContent className="w-[min(94vw,420px)] rounded-[28px]">
          <DialogHeader><DialogTitle>Reset your YOMY password</DialogTitle></DialogHeader>
          <div className="flex gap-2 rounded-2xl bg-muted p-1">
            <Button variant={recoveryMode==='email'?'default':'ghost'} className="flex-1 rounded-xl" onClick={()=>setRecoveryMode('email')}>Email</Button>
            <Button variant={recoveryMode==='sms'?'default':'ghost'} className="flex-1 rounded-xl" onClick={()=>setRecoveryMode('sms')}>SMS</Button>
          </div>

          {recoveryMode==='email' ? (
            <div className="space-y-3"><p className="text-xs text-muted-foreground">We&apos;ll send a secure recovery email.</p><Input value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" /><Button className="w-full rounded-xl" disabled={recoveryBusy} onClick={()=>void sendEmailRecovery()}>{recoveryBusy?<Spinner className="size-4"/>:'Send recovery email'}</Button></div>
          ) : (
            <div className="space-y-3">
              {recoveryStep==='phone' && <><p className="text-xs text-muted-foreground">Enter the verified YOMY phone number.</p><Input inputMode="tel" value={recoveryPhone} onChange={e=>setRecoveryPhone(e.target.value)} placeholder="+20..." /><Button className="w-full rounded-xl" disabled={recoveryBusy} onClick={()=>void sendSmsRecovery()}>{recoveryBusy?<Spinner className="size-4"/>:'Send SMS code'}</Button></>}
              {recoveryStep==='code' && <><p className="text-xs text-muted-foreground">Enter the SMS code we sent.</p><Input inputMode="numeric" autoComplete="one-time-code" value={recoveryCode} onChange={e=>setRecoveryCode(e.target.value.replace(/\D/g,'').slice(0,10))} placeholder="123456" /><Button className="w-full rounded-xl" disabled={recoveryBusy} onClick={()=>void verifySmsRecovery()}>{recoveryBusy?<Spinner className="size-4"/>:'Verify code'}</Button></>}
              {recoveryStep==='account' && <><p className="text-xs text-muted-foreground">Choose which YOMY account should receive the reset link.</p><div className="space-y-2">{recoveryAccounts.map(account=><button key={account.id} type="button" onClick={()=>void sendRecoveryLink(account)} className="flex w-full items-center gap-3 rounded-2xl border p-3 text-left hover:bg-muted/70"><span className="size-9 rounded-full bg-muted overflow-hidden shrink-0">{account.avatar_url?<img src={account.avatar_url} alt="" className="size-full object-cover"/>:null}</span><span className="min-w-0 flex-1"><b className="block text-sm truncate">@{account.username}</b><small className="text-xs text-muted-foreground">{account.email}</small></span></button>)}</div></>}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
