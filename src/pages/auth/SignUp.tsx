import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'
import { ShieldCheck } from 'lucide-react'
import { useYomyLanguage } from '@/lib/i18n'

const LEGAL_VERSION = '2026-10-03'

export default function SignUp() {
  const navigate = useNavigate()
  const { copy } = useYomyLanguage()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [acceptedPolicies, setAcceptedPolicies] = useState(false)
  const [loading, setLoading] = useState(false)

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

    setLoading(true)
    try {
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('username', username.toLowerCase())
        .maybeSingle()

      if (existing) {
        toast.error('Username already taken')
        setLoading(false)
        return
      }

      const acceptedAt = new Date().toISOString()
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username.toLowerCase(),
            full_name: fullName,
            phone_number: phone.trim() || null,
            legal_terms_accepted: true,
            legal_privacy_accepted: true,
            legal_version: LEGAL_VERSION,
            legal_accepted_at: acceptedAt,
          },
        },
      })

      if (error) throw error
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
                <Input id="phone" type="tel" inputMode="tel" placeholder="+20 1XXXXXXXXX" value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">{copy('noPhoneNote')}</p>
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

              <Button type="submit" className="w-full" disabled={loading || !acceptedPolicies}>
                {loading ? copy('creatingAccount') : copy('createAccount')}
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
