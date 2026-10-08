import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CountryCode } from 'libphonenumber-js'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { CheckCircle2, ChevronDown, Globe2, MapPin, Search, ShieldCheck } from 'lucide-react'
import { useYomyLanguage } from '@/lib/i18n'
import { completeGoogleRedirect, signInWithGoogle } from '@/lib/googleAuth'
import {
  COUNTRY_CODES,
  COUNTRY_NAMES,
  countryFlag,
  detectCountryFromDevice,
  isSupportedCountry,
  normalizePhoneInput,
} from '@/lib/phone'
import {
  confirmFirebasePhoneVerification,
  resetFirebasePhoneVerification,
  startFirebasePhoneVerification,
} from '@/lib/firebasePhone'

const LEGAL_VERSION = '2026-10-03'

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
      if (error instanceof Error && error.message === 'PHONE_AUTH_REQUIRES_HOSTED_DOMAIN') {
        return 'SMS verification must be completed on YOMY’s secure web address, not localhost.'
      }
      return error instanceof Error ? error.message : 'Phone verification failed.'
  }
}

type VerificationState = 'idle' | 'sending' | 'code' | 'verifying' | 'verified'

export default function SignUp() {
  const navigate = useNavigate()
  const { language, copy } = useYomyLanguage()
  const sendPhoneButtonRef = useRef<HTMLButtonElement>(null)
  const locationAttemptedRef = useRef(false)
  const [country, setCountry] = useState<CountryCode>(() => {
    const saved = localStorage.getItem('yomy-phone-country') || 'EG'
    return isSupportedCountry(saved) ? saved : 'EG'
  })
  const [countryPickerOpen, setCountryPickerOpen] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [detectingLocation, setDetectingLocation] = useState(false)
  const [detectedLocation, setDetectedLocation] = useState(false)
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
  const [googleLoading, setGoogleLoading] = useState(false)

  useEffect(() => {
    let active = true
    void completeGoogleRedirect()
      .then(result => {
        if (active && result) {
          toast.success(language === 'ar' ? 'تم إنشاء الحساب باستخدام Google' : 'Account created with Google')
          navigate('/')
        }
      })
      .catch(error => {
        if (active) toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
      })
    return () => { active = false }
  }, [language, navigate])

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

  const parsedPhone = normalizePhoneInput(phone, country)
  const normalizedPhone = parsedPhone.e164
  const waitingForCode = verificationState === 'code' || verificationState === 'verifying'
  const verified = verificationState === 'verified' && Boolean(normalizedPhone)

  const requestLocationCountry = async () => {
    if (detectingLocation) return
    setDetectingLocation(true)
    try {
      const detected = await detectCountryFromDevice()
      if (!detected) {
        toast.error(language === 'ar'
          ? 'تعذر تحديد البلد تلقائيًا. يمكنك اختيار البلد يدويًا.'
          : 'Could not determine your country automatically. You can choose it manually.')
        return
      }
      setCountry(detected)
      localStorage.setItem('yomy-phone-country', detected)
      setDetectedLocation(true)
      if (phone) setPhone(normalizePhoneInput(phone, detected).display)
      toast.success(
        language === 'ar'
          ? 'تم تحديد بلدك وتحديث رمز الاتصال.'
          : 'Country detected and calling code updated.',
      )
    } finally {
      setDetectingLocation(false)
    }
  }

  const onPhoneFocus = () => {
    if (locationAttemptedRef.current) return
    locationAttemptedRef.current = true
    void requestLocationCountry()
  }

  const chooseCountry = (next: CountryCode) => {
    resetFirebasePhoneVerification()
    setCountry(next)
    localStorage.setItem('yomy-phone-country', next)
    setPhone(normalizePhoneInput(phone, next).display)
    setVerificationState('idle')
    setVerificationCode('')
    setPhoneNonce('')
    setCountryPickerOpen(false)
    setCountrySearch('')
    setDetectedLocation(false)
  }

  const handlePhoneChange = (value: string) => {
    resetFirebasePhoneVerification()
    const parsed = normalizePhoneInput(value, country)
    if (parsed.country !== country && value.trim().startsWith('+') && isSupportedCountry(parsed.country)) {
      setCountry(parsed.country)
      localStorage.setItem('yomy-phone-country', parsed.country)
    }
    setPhone(parsed.display)
    setVerificationState('idle')
    setVerificationCode('')
    setPhoneNonce('')
    setDetectedLocation(false)
  }

  const sendPhoneOtp = async () => {
    if (!normalizedPhone) {
      toast.error(language === 'ar'
        ? 'أدخل رقمًا صحيحًا. يمكنك كتابة الرقم محليًا أو باستخدام +.'
        : 'Enter a valid phone number. You may type it locally or with +.')
      return false
    }

    if (!isSupportedCountry(parsedPhone.country)) {
      toast.error(language === 'ar'
        ? 'YOMY يدعم مصر والولايات المتحدة والدول الأوروبية فقط.'
        : 'YOMY supports Egypt, the United States, and European countries only.')
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
      toast.error(phoneAuthErrorMessage(error))
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

  const handleGoogleSignUp = async () => {
    if (!acceptedPolicies) {
      toast.error(copy('legalConsentNotice'))
      return
    }

    setGoogleLoading(true)
    try {
      const result = await signInWithGoogle({ signup: true })
      if (result) {
        toast.success(language === 'ar' ? 'تم إنشاء الحساب باستخدام Google' : 'Account created with Google')
        navigate('/')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Google sign-up failed')
    } finally {
      setGoogleLoading(false)
    }
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

    if (phone.trim() && !normalizedPhone) {
      toast.error(language === 'ar'
        ? 'الرقم غير مكتمل أو غير صحيح لهذا البلد.'
        : 'The number is incomplete or invalid for the selected country.')
      return
    }
    if (normalizedPhone && verificationState !== 'verified') {
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

      if (normalizedPhone) {
        const { data, error } = await supabase.functions.invoke('yomy-account-auth', {
          body: {
            action: 'create_account',
            phone: normalizedPhone,
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

  const filteredCountries = COUNTRY_CODES.filter(item => {
    const q = countrySearch.trim().toLowerCase()
    return !q || item.name.toLowerCase().includes(q) || item.code.toLowerCase().includes(q) || item.dial.includes(q)
  })
  const selectedCountry = COUNTRY_CODES.find(item => item.code === country) || COUNTRY_CODES.find(item => item.code === 'EG')!

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-5">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold tracking-tighter bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400 bg-clip-text text-transparent">Yomy</h1>
          <p className="text-muted-foreground text-sm">{copy('connectShareDiscover')}</p>
        </div>

        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="fullName">{copy('fullName')}</Label>
                  <Input id="fullName" placeholder={copy('fullName')} value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username">{copy('username')}</Label>
                  <Input id="username" placeholder="username" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_.]/gi, '').toLowerCase())} autoComplete="username" required />
                </div>
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
                <div className="flex items-center justify-between">
                  <Label htmlFor="phone">{copy('phoneNumber')}</Label>
                  <span className="text-[11px] font-normal text-muted-foreground">{copy('optional')}</span>
                </div>

                <div className="flex gap-2 relative">
                  <button
                    type="button"
                    aria-haspopup="listbox"
                    aria-expanded={countryPickerOpen}
                    onClick={() => setCountryPickerOpen(value => !value)}
                    className="h-11 shrink-0 min-w-[104px] rounded-xl border bg-card px-3 flex items-center gap-2 text-sm transition-colors hover:bg-muted"
                  >
                    <span className="text-lg leading-none">{countryFlag(selectedCountry.code)}</span>
                    <span className="font-semibold">{selectedCountry.dial}</span>
                    <ChevronDown className="size-4 ml-auto opacity-60" />
                  </button>

                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    dir="ltr"
                    placeholder={selectedCountry.dial + ' 1XXXXXXXXX'}
                    value={phone}
                    onChange={e => handlePhoneChange(e.target.value)}
                    onFocus={onPhoneFocus}
                    autoComplete="tel"
                    className="h-11 rounded-xl flex-1"
                    aria-describedby="phone-hint"
                  />

                  {countryPickerOpen && (
                    <div className="absolute z-30 left-0 top-12 w-[min(360px,calc(100vw-48px))] rounded-2xl border bg-popover shadow-2xl overflow-hidden">
                      <div className="p-2 border-b">
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 opacity-50" />
                          <Input
                            autoFocus
                            value={countrySearch}
                            onChange={e => setCountrySearch(e.target.value)}
                            placeholder="Search country or code…"
                            className="h-10 pl-9 rounded-xl"
                          />
                        </div>
                      </div>
                      <div className="max-h-64 overflow-y-auto p-1">
                        {filteredCountries.map(item => (
                          <button
                            key={item.code}
                            type="button"
                            onClick={() => chooseCountry(item.code)}
                            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-muted"
                          >
                            <span className="text-lg w-7">{countryFlag(item.code)}</span>
                            <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                            <span className="text-xs text-muted-foreground">{item.dial}</span>
                          </button>
                        ))}
                        {filteredCountries.length === 0 && (
                          <div className="py-8 text-center text-sm text-muted-foreground">No supported countries found.</div>
                        )}
                      </div>
                      <div className="border-t p-2">
                        <button
                          type="button"
                          onClick={() => void requestLocationCountry()}
                          disabled={detectingLocation}
                          className="w-full rounded-xl px-3 py-2.5 flex items-center gap-2 text-sm font-semibold hover:bg-muted disabled:opacity-50"
                        >
                          <MapPin className="size-4" />
                          {detectingLocation
                            ? (language === 'ar' ? 'جارٍ تحديد الموقع…' : 'Detecting location…')
                            : (language === 'ar' ? 'استخدم موقعي لتحديد البلد' : 'Use my location to detect country')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div id="phone-hint" className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
                  <Globe2 className="size-3.5 mt-0.5 shrink-0" />
                  <span>
                    {language === 'ar'
                      ? 'يمكنك كتابة الرقم محليًا مثل 010… وسيحوّله YOMY تلقائيًا إلى الصيغة الدولية. الدول المدعومة: مصر، الولايات المتحدة، وأوروبا.'
                      : 'Type a local number like 010… and YOMY will convert it to international format automatically. Supported: Egypt, US, and Europe.'}
                  </span>
                </div>

                {detectedLocation && (
                  <div className="text-[11px] font-medium text-primary">
                    {countryFlag(selectedCountry.code)} {COUNTRY_NAMES[selectedCountry.code]} detected
                  </div>
                )}

                {phone.trim() && !normalizedPhone && (
                  <p className="text-[11px] text-destructive">
                    {language === 'ar' ? 'الرقم غير مكتمل أو غير مدعوم لهذا البلد.' : 'The number is incomplete or not supported for this country.'}
                  </p>
                )}

                {verified ? (
                  <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/8 px-3 py-2.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 truncate">{copy('phoneVerified')}</span>
                    </div>
                    <button type="button" className="text-[11px] font-semibold text-primary" onClick={() => handlePhoneChange('')}>{copy('changeNumber')}</button>
                  </div>
                ) : waitingForCode ? (
                  <div className="rounded-2xl border bg-muted/25 p-3.5 space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold">{copy('verificationCode')}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{copy('codeSent')}</p>
                      </div>
                      <span className="text-[11px] font-semibold text-primary">{countryFlag(selectedCountry.code)} {selectedCountry.dial}</span>
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={verificationCode}
                        onChange={e => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 10))}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="123456"
                        className="h-11 rounded-xl"
                      />
                      <Button type="button" className="h-11 rounded-xl shrink-0" disabled={verificationState === 'verifying' || verificationCode.length < 4} onClick={() => void verifyPhoneOtp()}>
                        {verificationState === 'verifying' ? '…' : copy('verifyCode')}
                      </Button>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-muted-foreground">{resendAt > countdownNow ? copy('resendIn') + ' ' + Math.ceil((resendAt - countdownNow) / 1000) + copy('seconds') : ''}</span>
                      <button type="button" disabled={countdownNow < resendAt || verificationState === 'verifying'} className="font-semibold text-primary disabled:opacity-40" onClick={() => void sendPhoneOtp()}>{copy('resendCode')}</button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" variant="outline" className="h-11 w-full rounded-xl" disabled={!normalizedPhone || verificationState === 'sending' || loading} onClick={() => void sendPhoneOtp()}>
                    {verificationState === 'sending' ? '…' : copy('phoneVerify')}
                  </Button>
                )}
              </div>

              <div className="rounded-2xl border bg-muted/20 p-3.5">
                <div className="flex items-start gap-3">
                  <Checkbox id="legal-consent" checked={acceptedPolicies} onCheckedChange={value => setAcceptedPolicies(value === true)} required aria-required="true" className="mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <Label htmlFor="legal-consent" className="block cursor-pointer text-xs leading-5 font-normal">
                      <span>{copy('agreeTo')} </span>
                      <Link to="/terms" target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">{copy('terms')}</Link>
                      <span> {language === 'ar' ? 'و' : 'and'} </span>
                      <Link to="/privacy" target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">{copy('privacyPolicy')}</Link>
                      <span> {language === 'ar' ? 'و' : 'and'} </span>
                      <Link to="/community-guidelines" target="_blank" rel="noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">{copy('communityGuidelines')}</Link>
                      <span>.</span>
                    </Label>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <ShieldCheck className="size-3.5 shrink-0" />
                  <span>{copy('consentRecorded')}</span>
                </div>
              </div>

              <Button type="submit" className="h-11 w-full rounded-xl" disabled={loading || googleLoading || !acceptedPolicies || verificationState === 'sending'}>
                {loading ? copy('creatingAccount') : normalizedPhone && !verified ? copy('phoneVerify') : copy('createAccount')}
              </Button>

              <p className="text-[11px] leading-relaxed text-center text-muted-foreground">{copy('legalConsentNotice')}</p>

              <button
                ref={sendPhoneButtonRef}
                id="yomy-phone-recaptcha-anchor"
                type="button"
                tabIndex={-1}
                aria-hidden="true"
                className="absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 pointer-events-none"
              />
            </form>

            <div className="mt-5 relative">
              <Separator />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">OR</span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-4 h-11 w-full rounded-xl"
              disabled={loading || googleLoading || !acceptedPolicies}
              onClick={() => void handleGoogleSignUp()}
            >
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-white text-sm font-bold leading-none shadow-sm">G</span>
              {googleLoading
                ? (language === 'ar' ? 'جارٍ إنشاء الحساب…' : 'Creating with Google…')
                : (language === 'ar' ? 'التسجيل باستخدام Google' : 'Sign up with Google')}
            </Button>
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
