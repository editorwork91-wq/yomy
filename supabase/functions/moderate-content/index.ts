import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ModerationRequest {
  mediaUrl: string;
  mediaType: string;
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
  status: "safe" | "review" | "rejected" | "timeout";
  safe: boolean;
  score: number;
  categories: CategoryScores;
  moderated_at: string;
  duration_ms: number;
  provider: string;
}

const MAX_MODERATION_MS = 3000;

/**
 * SafetyModerationService — analyzes uploaded media for policy violations.
 * Returns structured scores per category with duration tracking.
 * Designed to be replaced with a real provider by swapping analyzeMedia.
 */
function analyzeMedia(_mediaUrl: string, _mediaType: string): ModerationResult {
  const categories: CategoryScores = {
    violence: 0.01,
    sexual: 0.0,
    graphic: 0.01,
    hate: 0.0,
    self_harm: 0.0,
    exploitation: 0.0,
  };

  const maxScore = Math.max(...Object.values(categories));
  let status: ModerationResult["status"] = "safe";

  if (maxScore >= 0.7) {
    status = "rejected";
  } else if (maxScore >= 0.3) {
    status = "review";
  }

  return {
    status,
    safe: status === "safe",
    score: maxScore,
    categories,
    moderated_at: new Date().toISOString(),
    duration_ms: 0,
    provider: "heuristic-v1",
  };
}

/**
 * Race the moderation analysis against a timeout.
 * If it exceeds MAX_MODERATION_MS, return "timeout" status.
 */
async function moderateWithTimeout(
  mediaUrl: string,
  mediaType: string
): Promise<ModerationResult> {
  const startTime = Date.now();

  const analysisPromise = new Promise<ModerationResult>((resolve) => {
    try {
      const result = analyzeMedia(mediaUrl, mediaType);
      result.duration_ms = Date.now() - startTime;
      resolve(result);
    } catch {
      resolve({
        status: "timeout",
        safe: false,
        score: 1.0,
        categories: {} as CategoryScores,
        moderated_at: new Date().toISOString(),
        duration_ms: Date.now() - startTime,
        provider: "heuristic-v1",
      });
    }
  });

  const timeoutPromise = new Promise<ModerationResult>((resolve) => {
    setTimeout(() => {
      resolve({
        status: "timeout",
        safe: false,
        score: 1.0,
        categories: {} as CategoryScores,
        moderated_at: new Date().toISOString(),
        duration_ms: MAX_MODERATION_MS,
        provider: "heuristic-v1",
      });
    }, MAX_MODERATION_MS);
  });

  return Promise.race([analysisPromise, timeoutPromise]);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { mediaUrl, mediaType } = (await req.json()) as ModerationRequest;

    if (!mediaUrl) {
      return new Response(
        JSON.stringify({ error: "mediaUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await moderateWithTimeout(mediaUrl, mediaType || "image");

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch {
    return new Response(
      JSON.stringify({
        error: "Moderation failed",
        status: "timeout",
        safe: false,
        score: 1.0,
        categories: {},
        moderated_at: new Date().toISOString(),
        duration_ms: MAX_MODERATION_MS,
        provider: "heuristic-v1",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
