import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { useYomyLanguage } from '@/lib/i18n'
import { completeGoogleRedirect, signInWithGoogle } from '@/lib/googleAuth'
import { getPostAuthRoute } from '@/lib/authRouting'

export default function Login() {
  const navigate = useNavigate()
  const { copy, language } = useYomyLanguage()
  const rtl = language === 'ar'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const finishAuth = async () => {
    const destination = await getPostAuthRoute()
    navigate(destination, { replace: true })
  }

  const location = useLocation()

  useEffect(() => {
    let active = true
    const params = new URLSearchParams(location.search)
    const autoGoogle = params.get('google') === '1'

    if (autoGoogle) {
      window.history.replaceState({}, '', location.pathname)
      setGoogleLoading(true)
      void signInWithGoogle()
        .then(async result => {
          if (active && result) {
            toast.success(rtl ? 'تم تسجيل الدخول باستخدام Google.' : 'Signed in with Google.')
            await finishAuth()
          }
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
          if (active && result) {
            toast.success(rtl ? 'تم تسجيل الدخول باستخدام Google.' : 'Signed in with Google.')
            await finishAuth()
          }
        })
        .catch(error => {
          if (active) toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
        })
    }

    return () => { active = false }
  }, [location.pathname, location.search, rtl])

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (error) throw error
      await finishAuth()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    try {
      const result = await signInWithGoogle()
      if (!result) return
      toast.success(rtl ? 'تم تسجيل الدخول باستخدام Google.' : 'Signed in with Google.')
      await finishAuth()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
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
            <h1 className="mt-2 text-3xl font-bold tracking-[-.04em]">{rtl ? 'مرحبًا بعودتك' : 'Welcome back'}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {rtl ? 'سجّل الدخول وسنكمل تلقائيًا من المكان الصحيح.' : 'Sign in and YOMY will take you exactly where you belong.'}
            </p>
          </div>

          <Card className="yomy-ios-panel border-white/10">
            <CardContent className="p-6">
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="login-email">{copy('email')}</Label>
                  <Input id="login-email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required className="h-12 rounded-2xl bg-background/45" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">{copy('password')}</Label>
                  <Input id="login-password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required className="h-12 rounded-2xl bg-background/45" />
                </div>
                <Button type="submit" className="h-12 w-full rounded-2xl" disabled={loading || googleLoading}>
                  {loading ? (rtl ? 'جارٍ الدخول…' : 'Signing in…') : (rtl ? 'تسجيل الدخول' : 'Log in')}
                </Button>
              </form>

              <div className="my-5 relative">
                <Separator />
                <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-[11px] text-muted-foreground">OR</span>
              </div>

              <Button type="button" variant="outline" className="h-12 w-full rounded-2xl" disabled={loading || googleLoading} onClick={() => void handleGoogleSignIn()}>
                <span className="mr-2 inline-flex size-6 items-center justify-center rounded-full border bg-white text-sm font-bold text-black shadow-sm">G</span>
                {googleLoading ? (rtl ? 'جارٍ الاتصال…' : 'Connecting…') : (rtl ? 'المتابعة باستخدام Google' : 'Continue with Google')}
              </Button>
            </CardContent>
          </Card>

          <Card className="yomy-ios-panel border-white/10">
            <CardHeader className="py-4 text-center">
              <div className="mb-2 flex items-center justify-center text-[11px] text-muted-foreground">
                {rtl ? 'حساب جديد؟' : 'New to YOMY?'}
              </div>
              <p className="text-sm">
                {copy('dontHaveAccount')}{' '}
                <Link to="/signup" className="font-semibold text-primary hover:underline">{copy('signup')}</Link>
              </p>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  )
}
