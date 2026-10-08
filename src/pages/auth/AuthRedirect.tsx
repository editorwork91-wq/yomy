import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { supabase } from "@/lib/supabase"
import { Spinner } from "@/components/ui/spinner"

export default function AuthRedirect() {
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const routeUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session) {
        navigate("/login", { replace: true })
        return
      }

      const { data, error: routeError } = await supabase.functions.invoke("yomy-redirect", {
        body: { source: "auth" },
      })

      if (cancelled) return

      if (routeError || !data?.ok || !data?.target) {
        setError("We couldn't complete the account handoff. Please try again.")
        return
      }

      navigate(data.target as string, { replace: true })
    }

    void routeUser()
    return () => { cancelled = true }
  }, [navigate])

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-sm text-center space-y-4" aria-live="polite">
        <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border bg-card shadow-sm">
          <span className="text-xl font-bold tracking-tight">Y</span>
        </div>
        {error ? (
          <>
            <h1 className="text-lg font-semibold">YOMY</h1>
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Opening YOMY</h1>
            <p className="text-sm text-muted-foreground">Checking your account securely…</p>
            <Spinner className="mx-auto size-6" />
          </>
        )}
      </section>
    </main>
  )
}
