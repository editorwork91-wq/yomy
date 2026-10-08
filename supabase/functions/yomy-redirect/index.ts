import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors"

type RouteTarget = "/" | "/agreement"
type AppRoute = "open" | "login" | "signup" | "agreement"

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  })

const redirectToApp = (route: AppRoute) => {
  const target = new URL(`yomy://open?route=${encodeURIComponent(route)}`)
  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const url = new URL(req.url)

  // Public, allowlisted deep-link entrypoint. There is intentionally no
  // arbitrary target URL parameter, preventing an open-redirect vulnerability.
  if (req.method === "GET" || req.method === "HEAD") {
    const route = (url.searchParams.get("route") ?? "open") as AppRoute
    const allowedRoutes: AppRoute[] = ["open", "login", "signup", "agreement"]

    if (!allowedRoutes.includes(route)) {
      return json({ error: "Unsupported redirect route" }, 400)
    }

    if (req.method === "HEAD") {
      const response = redirectToApp(route)
      return new Response(null, {
        status: response.status,
        headers: response.headers,
      })
    }

    return redirectToApp(route)
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return json({ error: "Authentication required" }, 401)
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? ""
    const publishableKeysRaw = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS")
    let apiKey = Deno.env.get("SUPABASE_ANON_KEY") ?? ""

    if (publishableKeysRaw) {
      try {
        const keys = JSON.parse(publishableKeysRaw) as Record<string, string>
        const defaultKeyName = keys.default
        if (defaultKeyName && Deno.env.get(defaultKeyName)) {
          apiKey = Deno.env.get(defaultKeyName) ?? apiKey
        }
      } catch {
        // Compatibility fallback.
      }
    }

    const userClient = createClient(supabaseUrl, apiKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const token = authHeader.slice("Bearer ".length)
    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData.user) return json({ error: "Invalid session" }, 401)

    const { data: onboarding, error: onboardingError } = await userClient
      .from("user_onboarding")
      .select("step, completed, legal_terms_accepted, legal_privacy_accepted, legal_community_accepted")
      .eq("user_id", userData.user.id)
      .maybeSingle()

    if (onboardingError) {
      console.error("yomy-redirect onboarding lookup failed", onboardingError.message)
      return json({ error: "Unable to determine onboarding state" }, 500)
    }

    const legalComplete = Boolean(
      onboarding?.legal_terms_accepted &&
      onboarding?.legal_privacy_accepted &&
      onboarding?.legal_community_accepted,
    )

    const target: RouteTarget = onboarding?.completed && legalComplete ? "/" : "/agreement"

    return json({
      ok: true,
      target,
      user_id: userData.user.id,
      onboarding_step: onboarding?.step ?? "agreement",
      legal_complete: legalComplete,
    })
  } catch (error) {
    console.error("yomy-redirect unexpected error", error)
    return json({ error: "Redirect service unavailable" }, 500)
  }
})
