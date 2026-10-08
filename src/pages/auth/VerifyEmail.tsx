import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck, RefreshCw, ArrowRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'

export default function VerifyEmail() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, loading } = useAuth()
  const email = useMemo(
    () => searchParams.get('email') || sessionStorage.getItem('yomy-pending-signup-email') || '',
    [searchParams],
  )
  const [resending, setResending] = useState(false)

  useEffect(() => {
    if (!loading && user) navigate('/onboarding', { replace: true })
  }, [loading, user, navigate])

  const resend = async () => {
    if (!email || resending) return
    setResending(true)
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email })
      if (error) throw error
      toast.success('Confirmation email sent again.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not resend the email.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="yomy-glass-page min-h-dvh px-4 py-8">
      <div className="mx-auto flex min-h-[80dvh] w-full max-w-md items-center">
        <Card className="yomy-ios-panel w-full overflow-hidden border-white/10">
          <CardContent className="p-6 sm:p-8">
            <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-[1.4rem] bg-primary/10 text-primary">
              <MailCheck className="size-7" />
            </div>
            <div className="text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-primary">One more step</p>
              <h1 className="mt-2 text-2xl font-bold tracking-tight">Check your email</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                YOMY sent a confirmation link to <span className="font-semibold text-foreground">{email || 'your email address'}</span>.
                Open it, then YOMY will continue your setup automatically.
              </p>
            </div>

            <div className="mt-6 rounded-2xl border border-border/60 bg-background/45 p-4 text-sm leading-6 text-muted-foreground">
              Your account has been created. The rest of your YOMY profile will be completed after email confirmation.
            </div>

            <div className="mt-6 grid gap-2">
              <Button type="button" className="h-12 rounded-2xl" onClick={() => navigate('/onboarding')}>
                I already confirmed <ArrowRight className="ml-2 size-4" />
              </Button>
              <Button type="button" variant="outline" className="h-11 rounded-2xl" disabled={resending || !email} onClick={() => void resend()}>
                <RefreshCw className={`mr-2 size-4 ${resending ? 'animate-spin' : ''}`} />
                Send again
              </Button>
              <Link to="/login" className="mt-2 text-center text-xs font-semibold text-muted-foreground hover:text-foreground">
                Back to login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
