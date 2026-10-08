import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { toast } from 'sonner'

export default function SignUp() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    if (username.length < 3) {
      toast.error('Username must be at least 3 characters')
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

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username.toLowerCase(),
            full_name: fullName.trim(),
          },
        },
      })
      if (error) throw error

      if (!data.session || !data.user) {
        toast.success('Account created. Check your email to confirm your address.')
        return
      }

      const parts = fullName.trim().split(/\s+/).filter(Boolean)
      const firstName = parts.shift() ?? ''
      const lastName = parts.join(' ')

      const { error: onboardingError } = await supabase
        .from('user_onboarding')
        .upsert({
          user_id: data.user.id,
          step: 'agreement',
          completed: false,
          first_name: firstName,
          last_name: lastName,
          legal_terms_accepted: false,
          legal_privacy_accepted: false,
          legal_community_accepted: false,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' })

      if (onboardingError) throw onboardingError

      toast.success('Account created. One final step before you enter YOMY.')
      navigate('/auth/redirect', { replace: true })
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
          <h1 className="text-4xl font-bold tracking-tighter">YOMY</h1>
          <p className="text-muted-foreground text-sm">Create your account securely. A phone number is optional.</p>
        </div>

        <Card className="border shadow-sm">
          <CardContent className="pt-6">
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="fullName">Full Name</Label><Input id="fullName" placeholder="Your full name" value={fullName} onChange={e => setFullName(e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="username">Username</Label><Input id="username" placeholder="username" value={username} onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_.]/gi, '').toLowerCase())} required /></div>
              <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" placeholder="you@example.com" value={email} onChange={e => setEmail(e.target.value)} required /></div>
              <div className="space-y-2"><Label htmlFor="password">Password</Label><Input id="password" type="password" placeholder="6+ characters" value={password} onChange={e => setPassword(e.target.value)} minLength={6} required /></div>
              <Button type="submit" className="w-full" disabled={loading}>{loading ? 'Creating account...' : 'Create account'}</Button>
              <p className="text-xs text-center text-muted-foreground">Your phone number is not required to create a YOMY account.</p>
            </form>
            <div className="mt-4 relative"><Separator /></div>
          </CardContent>
        </Card>

        <Card className="border shadow-sm">
          <CardHeader className="py-4 text-center">
            <p className="text-sm">Have an account?{' '}<Link to="/login" className="text-primary font-semibold hover:underline">Log in</Link></p>
          </CardHeader>
        </Card>
      </div>
    </div>
  )
}
