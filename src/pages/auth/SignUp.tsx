import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'
import { CheckCircle2, Smartphone } from 'lucide-react'

export default function SignUp() {
  const navigate = useNavigate()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [phoneNonce, setPhoneNonce] = useState('')
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [codeSent, setCodeSent] = useState(false)
  const [sendingCode, setSendingCode] = useState(false)
  const [verifyingPhone, setVerifyingPhone] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)

  const callAccountAuth = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('yomy-account-auth', { body })
    if (error || data?.error) throw new Error(String(data?.error || error?.message || 'Account service failed'))
    return data
  }

  const sendCode = async () => {
    if (!phone.trim()) return toast.error('Enter your phone number with country code')
    setSendingCode(true)
    try {
      await callAccountAuth({ action:'send_signup_otp', phone })
      setCodeSent(true)
      toast.success('Verification code sent by SMS')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send SMS')
    } finally {
      setSendingCode(false)
    }
  }

  const verifyPhone = async () => {
    if (!code.trim()) return
    setVerifyingPhone(true)
    try {
      const data = await callAccountAuth({ action:'verify_signup_otp', phone, code })
      setPhoneNonce(String(data.nonce || ''))
      setPhoneVerified(true)
      toast.success('Phone verified')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifyingPhone(false)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!phoneVerified || !phoneNonce) {
      toast.error('Verify your phone before creating the account')
      return
    }
    if (username.length < 3) {
      toast.error('Username must be at least 3 characters')
      return
    }

    setLoading(true)
    try {
      const data = await callAccountAuth({
        action:'create_account',
        phone,
        nonce:phoneNonce,
        email,
        password,
        username:username.toLowerCase(),
        full_name:fullName,
      })
      if (!data?.user_id) throw new Error('Account was not created')
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      toast.success('Account created and phone verified')
      navigate('/')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-5">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 bg-clip-text text-transparent">YOMY</h1>
          <p className="text-muted-foreground text-sm">Create your YOMY identity with a verified phone.</p>
        </div>

        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone number</Label>
                <div className="flex gap-2">
                  <Input id="phone" inputMode="tel" autoComplete="tel" placeholder="+20..." value={phone} onChange={e => { setPhone(e.target.value); setPhoneVerified(false); setPhoneNonce('') }} required />
                  <Button type="button" variant="secondary" className="shrink-0 rounded-xl" onClick={() => void sendCode()} disabled={sendingCode || phoneVerified}>
                    {phoneVerified ? <CheckCircle2 className="size-4" /> : sendingCode ? <Spinner className="size-4" /> : <Smartphone className="size-4" />}
                  </Button>
                </div>
              </div>

              {codeSent && !phoneVerified && (
                <div className="space-y-2 rounded-2xl border border-primary/15 bg-primary/5 p-3">
                  <Label htmlFor="phone-code">SMS code</Label>
                  <div className="flex gap-2">
                    <Input id="phone-code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={e => setCode(e.target.value.replace(/\D/g,'').slice(0,10))} />
                    <Button type="button" onClick={() => void verifyPhone()} disabled={verifyingPhone || !code.trim()} className="rounded-xl">{verifyingPhone ? <Spinner className="size-4" /> : 'Verify'}</Button>
                  </div>
                </div>
              )}

              {phoneVerified && <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-600 dark:text-emerald-400">Phone verified. You can now create this YOMY account. A phone can be linked to up to two YOMY accounts.</div>}

              <div className="space-y-2"><Label htmlFor="fullName">Full Name</Label><Input id="fullName" placeholder="Your full name" value={fullName} onChange={e => setFullName(e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="username">Username</Label><Input id="username" placeholder="username" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_.]/gi,'').toLowerCase())} required /></div>
              <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" placeholder="6+ characters" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /></div>

              <Button type="submit" className="w-full rounded-xl" disabled={loading || !phoneVerified}>
                {loading ? <><Spinner className="size-4 mr-2" />Creating account...</> : 'Create YOMY account'}
              </Button>
              <p className="text-xs text-center text-muted-foreground">By signing up, you agree to our Terms and Privacy Policy.</p>
            </form>
            <div className="mt-4 relative"><Separator /></div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-4 text-center"><p className="text-sm">Have an account? <Link to="/login" className="text-primary font-semibold hover:underline">Log in</Link></p></CardHeader>
        </Card>
      </div>
    </div>
  )
}
