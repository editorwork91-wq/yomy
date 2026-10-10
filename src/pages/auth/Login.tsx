import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { toast } from 'sonner'
import { useYomyLanguage } from '@/lib/i18n'
import { getPostAuthRoute } from '@/lib/authRouting'
import { useAuth } from '@/contexts/AuthContext'
import { MAX_SAVED_ACCOUNTS } from '@/lib/accountSwitcher'

export default function Login() {
  const navigate = useNavigate()
  const { savedAccounts, switchAccount } = useAuth()
  const [switchingAccountId, setSwitchingAccountId] = useState<string | null>(null)
  const { copy, language } = useYomyLanguage()
  const rtl = language === 'ar'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const finishAuth = async () => {
    const destination = await getPostAuthRoute()
    navigate(destination, { replace: true })
  }

  const handleSwitchSavedAccount = async (userId: string) => {
    setSwitchingAccountId(userId)
    try {
      await switchAccount(userId)
      navigate(await getPostAuthRoute(), { replace: true })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not switch account. Please sign in again.')
    } finally {
      setSwitchingAccountId(null)
    }
  }


  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault()
    const normalizedEmail = email.trim().toLowerCase()
    const alreadySaved = savedAccounts.some(account => account.email.toLowerCase() === normalizedEmail)
    if (!alreadySaved && savedAccounts.length >= MAX_SAVED_ACCOUNTS) {
      toast.error(rtl ? 'وصلت إلى الحد الأقصى وهو 5 حسابات محفوظة على هذا الجهاز.' : 'This device already has 5 saved accounts. Switch to one and remove it before adding another.')
      return
    }
    setLoading(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password })
      if (error) throw error
      await finishAuth()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Login failed')
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
            <h1 className="mt-2 text-3xl font-bold tracking-[-.04em]">{rtl ? 'مرحبًا بعودتك' : 'Welcome back'}</h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
              {rtl ? 'سجّل الدخول وسنكمل تلقائيًا من المكان الصحيح.' : 'Sign in and YOMY will take you exactly where you belong.'}
            </p>
          </div>

          {savedAccounts.length > 0 && (
            <Card className="yomy-ios-panel border-white/10">
              <CardContent className="space-y-2 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{rtl ? 'حسابات محفوظة على هذا الجهاز' : 'Saved on this device'}</p>
                  <Link to="/accounts" className="text-xs font-semibold text-primary hover:underline">{rtl ? 'إدارة' : 'Manage'}</Link>
                </div>
                {savedAccounts.map(account => {
                  const title = account.fullName || account.username || account.email || 'YOMY'
                  return (
                    <button key={account.userId} type="button" onClick={() => void handleSwitchSavedAccount(account.userId)} disabled={loading || switchingAccountId !== null} className="flex w-full items-center gap-3 rounded-2xl border border-border/55 bg-background/35 p-3 text-left transition-colors hover:bg-muted/45 disabled:opacity-60">
                      <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-semibold ring-1 ring-border/70">{account.avatarUrl ? <img src={account.avatarUrl} alt="" className="size-full object-cover" /> : title[0]?.toUpperCase()}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{account.email}</span>
                      </span>
                      <span className="text-[11px] font-semibold text-primary">{switchingAccountId === account.userId ? (rtl ? 'جارٍ التبديل…' : 'Switching…') : (rtl ? 'تبديل' : 'Switch')}</span>
                    </button>
                  )
                })}
              </CardContent>
            </Card>
          )}

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
                <Button type="submit" className="h-12 w-full rounded-2xl" disabled={loading}>
                  {loading ? (rtl ? 'جارٍ الدخول…' : 'Signing in…') : (rtl ? 'تسجيل الدخول' : 'Log in')}
                </Button>
              </form>

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
