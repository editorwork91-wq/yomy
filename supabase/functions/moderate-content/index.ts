import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const OPENAI_TIMEOUT_MS = 2500;
type MediaType = "image" | "video";
type Decision = "safe" | "review" | "rejected" | "timeout";

interface ModerationRequest {
  postId: string;
  mediaUrl: string;
  mediaType: MediaType;
  title?: string;
  caption?: string;
  description?: string;
}

interface CategoryScores {
  violence: number;
  sexual: number;
  graphic: number;
  hate: number;
  self_harm: number;
  exploitation: number;
}

interface ModerationResult {
  status: Decision;
  safe: boolean;
  score: number;
  categories: CategoryScores;
  moderated_at: string;
  duration_ms: number;
  provider: string;
  reason?: string;
}

const emptyCategories = (): CategoryScores => ({
  violence: 0,
  sexual: 0,
  graphic: 0,
  hate: 0,
  self_harm: 0,
  exploitation: 0,
});

function toScores(categories: Record<string, unknown>): CategoryScores {
  return {
    violence: Number(categories["violence"] ?? 0),
    sexual: Number(categories["sexual"] ?? 0),
    graphic: Number(categories["violence/graphic"] ?? categories["graphic"] ?? 0),
    hate: Number(categories["hate"] ?? 0),
    self_harm: Number(categories["self-harm"] ?? categories["self_harm"] ?? 0),
    exploitation: Number(categories["sexual/minors"] ?? categories["exploitation"] ?? 0),
  };
}

function decide(scores: CategoryScores): Decision {
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore >= 0.80) return "rejected";
  if (maxScore >= 0.35) return "review";
  return "safe";
}

async function moderateImage(mediaUrl: string, text: string, signal: AbortSignal): Promise<ModerationResult> {
  const started = Date.now();
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    return {
      status: "review", safe: false, score: 1, categories: emptyCategories(),
      moderated_at: new Date().toISOString(), duration_ms: Date.now() - started,
      provider: "configuration-missing", reason: "OPENAI_API_KEY is not configured",
    };
  }

  const response = await fetch("https://api.openai.com/v1/moderations", {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "omni-moderation-latest",
      input: [
        ...(text.trim() ? [{ type: "text", text: text.slice(0, 8000) }] : []),
        { type: "image_url", image_url: { url: mediaUrl } },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Moderation provider returned ${response.status}`);
  const data = await response.json();
  const providerResult = data?.results?.[0];
  if (!providerResult) throw new Error("Moderation provider returned no result");

  const scores = toScores(providerResult.category_scores ?? {});
  const status = decide(scores);
  return {
    status, safe: status === "safe", score: Math.max(...Object.values(scores)), categories: scores,
    moderated_at: new Date().toISOString(), duration_ms: Date.now() - started,
    provider: "openai-omni-moderation",
  };
}

async function moderate(request: ModerationRequest): Promise<ModerationResult> {
  const started = Date.now();

  // Videos stay unpublished until a server-side frame/video worker is configured.
  if (request.mediaType === "video") {
    return {
      status: "review", safe: false, score: 1, categories: emptyCategories(),
      moderated_at: new Date().toISOString(), duration_ms: Date.now() - started,
      provider: "video-review-queue",
      reason: "Video requires server-side frame analysis before publication",
    };
  }

  const text = [request.title, request.caption, request.description].filter(Boolean).join("\n");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    return await moderateImage(request.mediaUrl, text, controller.signal);
  } catch (error) {
    return {
      status: "timeout", safe: false, score: 1, categories: emptyCategories(),
      moderated_at: new Date().toISOString(), duration_ms: Date.now() - started,
      provider: "openai-omni-moderation", reason: error instanceof Error ? error.message : "Moderation failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !token) throw new Error("Unauthorized");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) throw new Error("Unauthorized");

    const body = (await req.json()) as ModerationRequest;
    if (!body.postId || !body.mediaUrl || !body.mediaType) throw new Error("postId, mediaUrl and mediaType are required");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: post, error: postError } = await admin
      .from("posts")
      .select("id, user_id, status")
      .eq("id", body.postId)
      .maybeSingle();
    if (postError || !post || post.user_id !== user.id) throw new Error("Post not found or not owned by caller");
    if (post.status === "published") throw new Error("Post is already published");

    await admin.from("posts")
      .update({ status: "moderation", moderation_status: "pending" })
      .eq("id", body.postId).eq("user_id", user.id);

    const result = await moderate(body);
    const nextStatus = result.status === "safe" ? "ready" : result.status === "rejected" ? "rejected" : "pending_moderation";

    const { error: updateError } = await admin.from("posts")
      .update({
        moderation_status: result.status === "timeout" ? "review" : result.status,
        moderation_result: result,
        moderated_at: result.moderated_at,
        status: nextStatus,
      })
      .eq("id", body.postId).eq("user_id", user.id).eq("status", "moderation");
    if (updateError) throw updateError;

    return new Response(JSON.stringify({ ...result, post_status: nextStatus }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Moderation failed" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
