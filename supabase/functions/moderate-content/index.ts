import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const GEMINI_TIMEOUT_MS = 9000;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";
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

function clampScore(value: unknown): number {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1, Math.max(0, number));
}

function decide(scores: CategoryScores): Decision {
  const maxScore = Math.max(...Object.values(scores));
  if (maxScore >= 0.80) return "rejected";
  if (maxScore >= 0.35) return "review";
  return "safe";
}

function extractJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini returned invalid JSON");
    return JSON.parse(match[0]) as Record<string, unknown>;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

async function moderateImage(mediaUrl: string, text: string, signal: AbortSignal): Promise<ModerationResult> {
  const started = Date.now();
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  const model = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  if (!apiKey) {
    return {
      status: "review", safe: false, score: 1, categories: emptyCategories(),
      moderated_at: new Date().toISOString(), duration_ms: Date.now() - started,
      provider: "configuration-missing", reason: "GEMINI_API_KEY is not configured",
    };
  }

  const mediaResponse = await fetch(mediaUrl, { signal });
  if (!mediaResponse.ok) throw new Error(`Media fetch returned ${mediaResponse.status}`);
  const mediaBytes = new Uint8Array(await mediaResponse.arrayBuffer());
  if (!mediaBytes.length) throw new Error("Media is empty");
  if (mediaBytes.length > 12 * 1024 * 1024) throw new Error("Image is too large for moderation");

  const mediaMime = mediaResponse.headers.get("content-type")?.split(";")[0].trim() || "image/jpeg";
  if (!mediaMime.startsWith("image/")) throw new Error(`Unsupported moderation media type: ${mediaMime}`);

  const prompt = [
    "You are a strict social-platform content safety moderator.",
    "Analyze the supplied image and accompanying text.",
    "Return ONLY a JSON object with this exact shape:",
    '{"safe":true,"violence":0,"sexual":0,"graphic":0,"hate":0,"self_harm":0,"exploitation":0,"reason":"brief reason"}',
    "Every score must be a number from 0 to 1.",
    "Use 0 for clearly absent content, 1 for clear severe violations.",
    "sexual includes explicit nudity/sexual acts; exploitation includes sexual content involving minors.",
    "graphic covers gore or extreme injury.",
    "Do not treat ordinary clothing, romance, medical context, sports, food, or non-graphic accidents as violations.",
    `Text context:\n${text.slice(0, 8000) || "(none)"}`,
  ].join("\n");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mediaMime, data: toBase64(mediaBytes) } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        maxOutputTokens: 256,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Gemini returned ${response.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }

  const data = await response.json();
  const textOutput = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("").trim();
  if (!textOutput) throw new Error("Gemini returned no moderation result");

  const parsed = extractJson(textOutput);
  const categories: CategoryScores = {
    violence: clampScore(parsed.violence),
    sexual: clampScore(parsed.sexual),
    graphic: clampScore(parsed.graphic),
    hate: clampScore(parsed.hate),
    self_harm: clampScore(parsed.self_harm),
    exploitation: clampScore(parsed.exploitation),
  };
  const calculatedStatus = decide(categories);
  const status: Decision = parsed.safe === false && calculatedStatus === "safe" ? "review" : calculatedStatus;

  return {
    status,
    safe: status === "safe",
    score: Math.max(...Object.values(categories)),
    categories,
    moderated_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    provider: `google-${model}`,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 500) : undefined,
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
  const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);
  try {
    return await moderateImage(request.mediaUrl, text, controller.signal);
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "AbortError";
    return {
      status: "timeout", safe: false, score: 1, categories: emptyCategories(),
      moderated_at: new Date().toISOString(), duration_ms: Date.now() - started,
      provider: `google-${Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL}`,
      reason: timedOut ? "Gemini moderation timed out" : (error instanceof Error ? error.message : "Moderation failed"),
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
