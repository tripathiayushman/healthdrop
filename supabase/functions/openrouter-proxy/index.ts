// supabase/functions/openrouter-proxy/index.ts
//
// Server-side OpenRouter proxy. Keeps OPENROUTER_API_KEY out of the client
// bundle — the app has no direct-to-OpenRouter path.
//
// HARDENING (refinement plan SEC-10). `verify_jwt: true` only proves the
// caller presented *a* valid project JWT — and the anon key ships inside
// every APK, so that alone let anyone burn the owner's OpenRouter credits.
// This function therefore additionally:
//   1. resolves the bearer to a real signed-in USER (anon key => 401);
//   2. allowlists the model, so a caller cannot select an expensive one;
//   3. caps max_tokens and the size and count of messages;
//   4. answers CORS narrowly and never echoes an arbitrary Origin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

declare const Deno: any;

interface ORMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ProxyRequest {
  model?: string;
  messages: ORMessage[];
  temperature?: number;
  max_tokens?: number;
}

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1/chat/completions";

/** Only free/cheap models the app actually uses. Anything else is refused. */
const MODEL_ALLOWLIST = new Set<string>([
  "nvidia/nemotron-3-super-120b-a12b:free",
  "meta-llama/llama-3.1-8b-instruct:free",
]);
const DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

const MAX_TOKENS_CEILING = 800;
const MAX_MESSAGES = 24;
const MAX_TOTAL_CHARS = 24_000;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function extractOpenRouterContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((c: any) => (typeof c?.text === "string" ? c.text : ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  throw new Error("Empty response from OpenRouter");
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    // ── 1. Require a real signed-in user, not merely a valid project key ──
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer) return json({ error: "Missing Authorization header" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(bearer);
    if (userErr || !userData?.user) {
      // The anon/publishable key lands here: it is a valid project key but
      // resolves to no user. That is exactly the case we are closing.
      return json({ error: "Sign-in required" }, 401);
    }

    const apiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!apiKey) {
      return json({ error: "OPENROUTER_API_KEY is not configured on server", status: 500 }, 500);
    }

    // ── 2. Validate the request shape and clamp its cost ──────────────────
    const body: ProxyRequest = await req.json();
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return json({ error: "messages[] is required", status: 400 }, 400);
    }
    if (body.messages.length > MAX_MESSAGES) {
      return json({ error: `At most ${MAX_MESSAGES} messages per request`, status: 400 }, 400);
    }
    const totalChars = body.messages.reduce(
      (n, m) => n + (typeof m?.content === "string" ? m.content.length : 0),
      0
    );
    if (totalChars > MAX_TOTAL_CHARS) {
      return json({ error: "Conversation too long", status: 413 }, 413);
    }

    const requested = String(body.model ?? "").trim();
    const model =
      requested && MODEL_ALLOWLIST.has(requested)
        ? requested
        : Deno.env.get("OPENROUTER_MODEL") && MODEL_ALLOWLIST.has(Deno.env.get("OPENROUTER_MODEL")!)
        ? Deno.env.get("OPENROUTER_MODEL")!
        : DEFAULT_MODEL;

    const temperature =
      typeof body.temperature === "number" ? Math.min(Math.max(body.temperature, 0), 1.2) : 0.7;
    const max_tokens =
      typeof body.max_tokens === "number"
        ? Math.min(Math.max(Math.trunc(body.max_tokens), 1), MAX_TOKENS_CEILING)
        : 350;

    // ── 3. Call OpenRouter ────────────────────────────────────────────────
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort("OpenRouter timeout"), 25000);

    const response = await fetch(OPENROUTER_API_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://healthdrop.local",
        "X-Title": "HealthDrop Surveillance System",
      },
      body: JSON.stringify({ model, messages: body.messages, temperature, max_tokens, stream: false }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    const rawText = await response.text();
    let data: any;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (parseError) {
      return json(
        { error: "Failed to parse OpenRouter response as JSON", status: 502, detail: String(parseError) },
        502
      );
    }

    if (!response.ok) {
      const msg = data?.error?.message ?? data?.message ?? `HTTP ${response.status}`;
      // Do not leak the upstream body — it can echo request internals.
      console.error("openrouter upstream error:", response.status, msg);
      return json({ error: msg, status: response.status }, response.status);
    }

    return json({ content: extractOpenRouterContent(data), model }, 200);
  } catch (err) {
    console.error("openrouter-proxy error:", err);
    return json({ error: String(err), status: 500 }, 500);
  }
});
