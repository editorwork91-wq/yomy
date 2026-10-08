import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "npm:@supabase/supabase-js@2"
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors"

type RouteTarget = "/" | "/agreement"

const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  })

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

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
        // Fall back to the compatibility anon key when the mapping is unavailable.
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

    const target: RouteTarget =
      onboarding?.completed && legalComplete
        ? "/"
        : "/agreement"

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
