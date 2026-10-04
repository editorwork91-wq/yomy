import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { CheckCircle2, ShieldCheck } from 'lucide-react'
import { useYomyLanguage } from '@/lib/i18n'
import {
  confirmFirebasePhoneVerification,
  resetFirebasePhoneVerification,
  startFirebasePhoneVerification,
} from '@/lib/firebasePhone'

const LEGAL_VERSION = '2026-10-03'

function normalizePhone(value: string) {
  const normalized = value
    .trim()
    .replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 0x6f0))
    .replace(/[\s().-]/g, '')
    .replace(/[^+\d]/g, '')
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : ''
}

function phoneAuthErrorMessage(error: unknown) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code || '')
    : ''
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'The phone number is not valid.'
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait and try again later.'
    case 'auth/quota-exceeded':
      return 'Phone verification quota has been reached. Try again later.'
    case 'auth/captcha-check-failed':
      return 'reCAPTCHA could not verify this request. Try again.'
    case 'auth/operation-not-allowed':
      return 'Phone authentication is not enabled in Firebase yet.'
    case 'auth/app-not-authorized':
      return 'This Yomy domain is not authorized in Firebase Authentication.'
    case 'auth/network-request-failed':
      return 'Network connection failed. Please check your internet connection and try again.'
    case 'auth/api-key-not-valid':
      return 'Firebase configuration is invalid. Check the Yomy Firebase settings.'
    default:
      return error instanceof Error ? error.message : 'Phone verification failed.'
  }
}

type VerificationState = 'idle' | 'sending' | 'code' | 'verifying' | 'verified'

export default function SignUp() {
  const navigate = useNavigate()
  const { language, copy } = useYomyLanguage()
  const sendPhoneButtonRef = useRef<HTMLButtonElement>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const [phoneNonce, setPhoneNonce] = useState('')
  const [verificationState, setVerificationState] = useState<VerificationState>('idle')
  const [resendAt, setResendAt] = useState(0)
  const [countdownNow, setCountdownNow] = useState(() => Date.now())
  const [acceptedPolicies, setAcceptedPolicies] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (resendAt <= Date.now()) return
    const timer = window.setInterval(() => {
      const now = Date.now()
      setCountdownNow(now)
      if (now >= resendAt) window.clearInterval(timer)
    }, 250)
    return () => window.clearInterval(timer)
  }, [resendAt])

  useEffect(() => () => resetFirebasePhoneVerification(), [])

  const normalizedPhone = normalizePhone(phone)
  const waitingForCode = verificationState === 'code' || verificationState === 'verifying'
  const verified = verificationState === 'verified' && Boolean(normalizedPhone)

  const sendPhoneOtp = async () => {
    if (!normalizedPhone) {
      toast.error('Enter a valid phone number in international format, for example +2010...')
      return false
    }
    if (!sendPhoneButtonRef.current) {
      toast.error('Phone verification UI is not ready yet. Please try again.')
      return false
    }
    if (countdownNow < resendAt) return false

    setVerificationState('sending')
    try {
      const { data: preflight, error: preflightError } = await supabase.functions.invoke('yomy-account-auth', {
        body: { action: 'check_phone_signup', phone: normalizedPhone },
      })
      if (preflightError || preflight?.error) {
        throw new Error(preflight?.error || preflightError?.message || 'PHONE_VERIFICATION_UNAVAILABLE')
      }

      await startFirebasePhoneVerification(normalizedPhone, sendPhoneButtonRef.current, language)
      setVerificationState('code')
      setVerificationCode('')
      setResendAt(Date.now() + 45_000)
      toast.success(copy('codeSent'))
      return true
    } catch (error) {
      resetFirebasePhoneVerification()
      setVerificationState('idle')
      const message = phoneAuthErrorMessage(error)
      if (message === 'FIREBASE_PHONE_AUTH_NOT_CONFIGURED') {
        toast.error(copy('phoneVerificationUnavailable'))
      } else {
        toast.error(message)
      }
      return false
    }
  }

  const verifyPhoneOtp = async () => {
    if (!normalizedPhone || !/^\d{4,10}$/.test(verificationCode.trim())) {
      toast.error(copy('verificationCode'))
      return false
    }

    setVerificationState('verifying')
    try {
      const result = await confirmFirebasePhoneVerification(verificationCode.trim(), normalizedPhone)
      setPhoneNonce(result.nonce)
      setVerificationState('verified')
      toast.success(copy('phoneVerified'))
      return true
    } catch (error) {
      setVerificationState('code')
      toast.error(phoneAuthErrorMessage(error))
      return false
    }
  }

  const updatePhone = (value: string) => {
    resetFirebasePhoneVerification()
    setPhone(value)
    setVerificationState('idle')
    setVerificationCode('')
    setPhoneNonce('')
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()

    if (username.length < 3) {
      toast.error('Username must be at least 3 characters')
      return
    }
    if (!acceptedPolicies) {
      toast.error(copy('legalConsentNotice'))
      return
    }

    const cleanPhone = normalizePhone(phone)
    if (phone.trim() && !cleanPhone) {
      toast.error('Use an international phone format such as +2010...')
      return
    }
    if (cleanPhone && verificationState !== 'verified') {
      await sendPhoneOtp()
      return
    }

    setLoading(true)
    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.toLowerCase())
        .maybeSingle()

      if (existing) {
        toast.error('Username already taken')
        return
      }

      const acceptedAt = new Date().toISOString()

      if (cleanPhone) {
        const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
          body: {
            action: 'create_account',
            phone: cleanPhone,
            nonce: phoneNonce,
            email,
            password,
            username: username.toLowerCase(),
            full_name: fullName,
            legal_terms_accepted: true,
            legal_privacy_accepted: true,
            legal_version: LEGAL_VERSION,
            legal_accepted_at: acceptedAt,
          },
        })
        if (error || data?.error) throw new Error(data?.error || error?.message || 'ACCOUNT_CREATE_FAILED')

        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
        if (signInError) throw signInError
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username: username.toLowerCase(),
              full_name: fullName,
              phone_number: null,
              legal_terms_accepted: true,
              legal_privacy_accepted: true,
              legal_version: LEGAL_VERSION,
              legal_accepted_at: acceptedAt,
            },
          },
        })
        if (error) throw error
      }

      toast.success('Account created! Welcome to Yomy!')
      navigate('/')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Sign up failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 bg-clip-text text-transparent">Yomy</h1>
          <p className="text-muted-foreground text-sm">{copy('connectShareDiscover')}</p>
        </div>

        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">{copy('fullName')}</Label>
                <Input id="fullName" placeholder={copy('fullName')} value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="username">{copy('username')}</Label>
                <Input id="username" placeholder="username" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_.]/gi, '').toLowerCase())} autoComplete="username" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">{copy('email')}</Label>
                <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">{copy('password')}</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} minLength={6} autoComplete="new-password" required />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone" className="flex items-center justify-between">
                  <span>{copy('phoneNumber')}</span>
                  <span className="text-[11px] font-normal text-muted-foreground">{copy('optional')}</span>
                </Label>
                <Input id="phone" type="tel" inputMode="tel" placeholder="+20 1XXXXXXXXX" value={phone} onChange={e => updatePhone(e.target.value)} autoComplete="tel" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">{copy('phoneOptionalVerified')}</p>

                {phone.trim() && !normalizedPhone && (
                  <p className="text-[11px] text-destructive">Use an international format such as +2010...</p>
                )}

                {verified ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 truncate">{copy('phoneVerified')}</span>
                    </div>
                    <button type="button" className="text-[11px] font-semibold text-primary" onClick={() => updatePhone('')}>{copy('changeNumber')}</button>
                  </div>
                ) : waitingForCode ? (
                  <div className="rounded-2xl border bg-muted/25 p-3 space-y-2.5">
                    <p className="text-xs font-medium">{copy('verificationCode')}</p>
                    <p className="text-[11px] text-muted-foreground">{copy('codeSent')}</p>
                    <div className="flex gap-2">
                      <Input
                        value={verificationCode}
                        onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        className="rounded-xl"
                      />
                      <Button type="button" className="rounded-xl shrink-0" disabled={verificationState === 'verifying' || verificationCode.length < 4} onClick={() => void verifyPhoneOtp()}>
                        {verificationState === 'verifying' ? '…' : copy('verifyCode')}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{resendAt > countdownNow ? copy('resendIn') + ' ' + Math.ceil((resendAt - countdownNow) / 1000) + copy('seconds') : ''}</span>
                      <button type="button" ref={sendPhoneButtonRef} disabled={countdownNow < resendAt || verificationState === 'verifying'} className="font-semibold text-primary disabled:opacity-40" onClick={() => void sendPhoneOtp()}>{copy('resendCode')}</button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" ref={sendPhoneButtonRef} variant="outline" className="w-full rounded-xl" disabled={!normalizedPhone || verificationState === 'sending' || loading} onClick={() => void sendPhoneOtp()}>
                    {verificationState === 'sending' ? '…' : copy('phoneVerify')}
                  </Button>
                )}
              </div>

              <div className="rounded-2xl border bg-muted/30 p-3.5">
                <div className="flex items-start gap-3">
                  <Checkbox id="legal-consent" checked={acceptedPolicies} onCheckedChange={value => setAcceptedPolicies(value === true)} required aria-required="true" className="mt-0.5" />
                  <Label htmlFor="legal-consent" className="cursor-pointer text-xs leading-5 font-normal">
                    {copy('agreeTo')}{' '}
                    <Link to="/terms" target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">{copy('terms')}</Link>
                    {' '}and{' '}
                    <Link to="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">{copy('privacyPolicy')}</Link>
                    .{' '}
                    <Link to="/community-guidelines" target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">{copy('communityGuidelines')}</Link>
                    .
                  </Label>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0" />
                  <span>{copy('consentRecorded')}</span>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={loading || !acceptedPolicies || verificationState === 'sending'}>
                {loading ? copy('creatingAccount') : cleanPhone && !verified ? copy('phoneVerify') : copy('createAccount')}
              </Button>

              <p className="text-[11px] leading-relaxed text-center text-muted-foreground">{copy('legalConsentNotice')}</p>
            </form>

            <div className="mt-5 relative"><Separator /></div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-4 text-center">
            <p className="text-sm">
              {copy('haveAccount')}{' '}
              <Link to="/login" className="text-primary font-semibold hover:underline">{copy('login')}</Link>
            </p>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
