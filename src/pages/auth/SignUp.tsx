import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useYomyLanguage } from '@/lib/i18n'
import { completeGoogleRedirect, signInWithGoogle } from '@/lib/googleAuth'
import { getPostAuthRoute } from '@/lib/authRouting'

const ACCOUNT_LEGAL_VERSION = '2026-10-08'

function accountErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Sign up failed.'
  if (/user already registered/i.test(message)) return 'This email is already registered. Try logging in.'
  if (/password/i.test(message) && /characters/i.test(message)) return 'Use at least 6 characters for your password.'
  return message
}

export default function SignUp() {
  const navigate = useNavigate()
  const { language, copy } = useYomyLanguage()
  const rtl = language === 'ar'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [acceptedPolicies, setAcceptedPolicies] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const location = useLocation()

  useEffect(() => {
    let active = true
    const params = new URLSearchParams(location.search)
    const autoGoogle = params.get('google') === '1'

    if (autoGoogle) {
      window.history.replaceState({}, '', location.pathname)
      setGoogleLoading(true)
      void signInWithGoogle({ signup: true })
        .then(async result => {
          if (!active || !result) return
          const destination = await getPostAuthRoute()
          toast.success(rtl ? 'تم إنشاء الحساب باستخدام Google.' : 'Account connected with Google.')
          navigate(destination, { replace: true })
        })
        .catch(error => {
          if (active) toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
        })
        .finally(() => {
          if (active) setGoogleLoading(false)
        })
    } else {
      void completeGoogleRedirect()
        .then(async result => {
          if (!active || !result) return
          const destination = await getPostAuthRoute()
          toast.success(rtl ? 'تم إنشاء الحساب باستخدام Google.' : 'Account connected with Google.')
          navigate(destination, { replace: true })
        })
        .catch(error => {
          if (active) toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
        })
    }

    return () => { active = false }
  }, [location.pathname, location.search, navigate, rtl])

  const handleGoogleSignUp = async () => {
    if (!acceptedPolicies) {
      toast.error(copy('legalConsentNotice'))
      return
    }
    setGoogleLoading(true)
    try {
      const result = await signInWithGoogle({ signup: true })
      if (!result) return
      const destination = await getPostAuthRoute()
      toast.success(rtl ? 'تم إنشاء الحساب باستخدام Google.' : 'Account connected with Google.')
      navigate(destination, { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google sign-up failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  const handleSignUp = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedUsername = username.trim().toLowerCase()

    if (normalizedUsername.length < 3) {
      toast.error(rtl ? 'اسم المستخدم يجب أن يحتوي على 3 أحرف على الأقل.' : 'Username must be at least 3 characters.')
      return
    }
    if (!/^[a-z0-9_.]{3,30}$/.test(normalizedUsername)) {
      toast.error(rtl ? 'اسم المستخدم يسمح بالحروف الإنجليزية والأرقام والنقطة والشرطة السفلية.' : 'Use only letters, numbers, periods, and underscores in the username.')
      return
    }
    if (!acceptedPolicies) {
      toast.error(copy('legalConsentNotice'))
      return
    }

    setLoading(true)
    try {
      const { data: existing, error: existingError } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', normalizedUsername)
        .maybeSingle()
      if (existingError) throw existingError
      if (existing) {
        toast.error(rtl ? 'اسم المستخدم مستخدم بالفعل.' : 'That username is already taken.')
        return
      }

      const acceptedAt = new Date().toISOString()
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/verify-email?email=${encodeURIComponent(normalizedEmail)}`,
          data: {
            username: normalizedUsername,
            full_name: '',
            phone_number: null,
            legal_terms_accepted: true,
            legal_privacy_accepted: true,
            legal_version: ACCOUNT_LEGAL_VERSION,
            legal_accepted_at: acceptedAt,
          },
        },
      })
      if (error) throw error
      sessionStorage.setItem('yomy-pending-signup-email', normalizedEmail)

      if (data.session) {
        sessionStorage.removeItem('yomy-pending-signup-email')
        toast.success(rtl ? 'تم إنشاء الحساب. لنكمل إعداد YOMY.' : 'Account created. Let’s finish setting up YOMY.')
        navigate('/onboarding', { replace: true })
      } else {
        toast.success(rtl ? 'تم إنشاء الحساب. افحص بريدك لتأكيده.' : 'Account created. Check your email to confirm it.')
        navigate(`/verify-email?email=${encodeURIComponent(normalizedEmail)}`, { replace: true })
      }
    } catch (error) {
      toast.error(accountErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="yomy-glass-page min-h-dvh px-4 py-7 sm:px-6">
      <div className="mx-auto flex min-h-[90dvh] w-full max-w-md items-center">
        <div className="w-full space-y-4">
          <div className="px-2 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl border border-primary/15 bg-primary/8 shadow-[0_18px_50px_rgba(90,60,180,.12)]">
              <span className="text-2xl font-black tracking-[-.08em]">yomy</span>
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[.25em] text-primary">YOMY</p>
            <h1 className="mt-2 text-3xl font-bold tracking-[-.04em]">{rtl ? 'أنشئ حسابك' : 'Create your account'}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {rtl ? 'سجّل أولًا. بعد ذلك سنكمل ملفك على خطوات واضحة وسريعة.' : 'Register first. Then we’ll finish your profile in a few clear, fast steps.'}
            </p>
          </div>

          <Card className="yomy-ios-panel border-white/10">
            <CardHeader className="space-y-2 pb-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                <ShieldCheck className="size-4" />
                {rtl ? 'ابدأ بحسابك الأساسي' : 'Start with your core account'}
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-email">{copy('email')}</Label>
                  <Input id="signup-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required className="h-12 rounded-2xl bg-background/45" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-password">{copy('password')}</Label>
                  <Input id="signup-password" type="password" placeholder="••••••••" minLength={6} value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" required className="h-12 rounded-2xl bg-background/45" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-username">{rtl ? 'اسم المستخدم' : 'Username'}</Label>
                  <Input id="signup-username" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_.]/gi, '').toLowerCase())} placeholder="yomy_user" autoComplete="username" required className="h-12 rounded-2xl bg-background/45" />
                  <p className="text-[11px] leading-5 text-muted-foreground">{rtl ? 'سيصبح هذا معرّفك الفريد على YOMY.' : 'This becomes your unique YOMY handle.'}</p>
                </div>

                <div className="rounded-2xl border border-border/60 bg-background/35 p-3.5">
                  <div className="flex items-start gap-3">
                    <Checkbox id="signup-consent" checked={acceptedPolicies} onCheckedChange={v => setAcceptedPolicies(v === true)} className="mt-0.5 shrink-0" />
                    <Label htmlFor="signup-consent" className="cursor-pointer text-xs leading-5 font-normal">
                      {rtl ? 'أوافق على شروط الاستخدام وسياسة الخصوصية وإرشادات المجتمع.' : 'I agree to the Terms of Service, Privacy Policy, and Community Guidelines.'}
                    </Label>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <ShieldCheck className="size-3.5 shrink-0" />
                    <span>{rtl ? 'سنطلب منك تأكيد الاتفاقية النهائية قبل دخول المجتمع.' : 'We’ll ask you to confirm the final community agreement before entering YOMY.'}</span>
                  </div>
                </div>

                <Button type="submit" className="h-12 w-full rounded-2xl" disabled={loading || googleLoading || !acceptedPolicies}>
                  {loading ? (rtl ? 'جارٍ إنشاء الحساب…' : 'Creating account…') : (rtl ? 'إنشاء الحساب' : 'Create account')}
                  {!loading && <ArrowRight className="ml-2 size-4" />}
                </Button>
              </form>

              <div className="my-5 relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-[11px] text-muted-foreground">OR</span>
              </div>

              <Button type="button" variant="outline" className="h-12 w-full rounded-2xl" disabled={loading || googleLoading || !acceptedPolicies} onClick={() => void handleGoogleSignUp()}>
                <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full border bg-white text-sm font-bold text-black shadow-sm">G</span>
                {googleLoading ? (rtl ? 'جارٍ الاتصال…' : 'Connecting…') : (rtl ? 'التسجيل باستخدام Google' : 'Continue with Google')}
              </Button>
            </CardContent>
          </Card>

          <Card className="yomy-ios-panel border-white/10">
            <CardHeader className="py-4 text-center">
              <p className="text-sm">
                {copy('haveAccount')}{' '}
                <Link to="/login" className="font-semibold text-primary hover:underline">{copy('login')}</Link>
              </p>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  )
}
