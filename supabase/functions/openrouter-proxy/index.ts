// supabase/functions/openrouter-proxy/index.ts
//
// Server-side OpenRouter proxy.
// Keeps OPENROUTER_API_KEY out of the client bundle.

declare const Deno: any;

interface ORMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface ProxyRequest {
  model?: string;
  messages: ORMessage[];
  temperature?: number;
  max_tokens?: number;
}

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/chat/completions';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function extractOpenRouterContent(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content.trim()) return content;

  if (Array.isArray(content)) {
    const joined = content
      .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
      .join('')
      .trim();
    if (joined) return joined;
  }

  throw new Error('Empty response from OpenRouter');
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const apiKey = Deno.env.get('OPENROUTER_API_KEY');
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured on server', status: 500 }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: ProxyRequest = await req.json();
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'messages[] is required', status: 400 }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const model = body.model || Deno.env.get('OPENROUTER_MODEL') || 'openrouter/free';
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.7;
    const max_tokens = typeof body.max_tokens === 'number' ? body.max_tokens : 350;

    const response = await fetch(OPENROUTER_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://healthdrop.local',
        'X-Title': 'HealthDrop Surveillance System',
      },
      body: JSON.stringify({
        model,
        messages: body.messages,
        temperature,
        max_tokens,
        stream: false,
      }),
    });

    const rawText = await response.text();

    let data: any;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (parseError) {
      return new Response(
        JSON.stringify({
          error: 'Failed to parse OpenRouter response as JSON',
          status: 502,
          detail: String(parseError),
          raw: rawText,
        }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!response.ok) {
      const msg = data?.error?.message ?? data?.message ?? `HTTP ${response.status}`;
      return new Response(
        JSON.stringify({
          error: msg,
          status: response.status,
          detail: rawText,
        }),
        { status: response.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const content = extractOpenRouterContent(data);

    return new Response(
      JSON.stringify({ content, model }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: String(err), status: 500 }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
