import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { useYomyLanguage } from '@/lib/i18n'
import { completeGoogleRedirect, signInWithGoogle } from '@/lib/googleAuth'

export default function Login() {
  const navigate = useNavigate()
  const { copy, language } = useYomyLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  useEffect(() => {
    let active = true
    void completeGoogleRedirect()
      .then(result => {
        if (active && result) {
          toast.success('Signed in with Google')
          navigate('/')
        }
      })
      .catch(error => {
        if (active) toast.error(error instanceof Error ? error.message : 'Google sign-in failed')
      })
    return () => { active = false }
  }, [navigate])

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

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true)
    try {
      const result = await signInWithGoogle()
      if (result) {
        toast.success(language === 'ar' ? 'تم تسجيل الدخول باستخدام Google' : 'Signed in with Google')
        navigate('/')
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
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
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">{copy('email')}</Label>
                <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{copy('password')}</Label>
                <Input id="password" type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? copy('signingIn') : copy('login')}
              </Button>
            </form>

            <div className="mt-4 relative">
              <Separator />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">OR</span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="mt-4 w-full rounded-xl"
              disabled={loading || googleLoading}
              onClick={() => void handleGoogleSignIn()}
            >
              <span className="mr-2 text-base font-bold leading-none">G</span>
              {googleLoading
                ? (language === 'ar' ? 'جارٍ الاتصال بـ Google…' : 'Connecting to Google…')
                : (language === 'ar' ? 'المتابعة باستخدام Google' : 'Continue with Google')}
            </Button>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-4 text-center">
            <p className="text-sm">
              {copy('dontHaveAccount')}{' '}
              <Link to="/signup" className="text-primary font-semibold hover:underline">{copy('signup')}</Link>
            </p>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
