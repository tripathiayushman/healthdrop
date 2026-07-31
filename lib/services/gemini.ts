// =====================================================
// OPENROUTER AI SERVICE — server-side only. Every call
// goes through the 'openrouter-proxy' Supabase Edge
// Function, which holds OPENROUTER_API_KEY. No API key
// is bundled into the app.
// =====================================================

import { supabase } from '../supabase';

const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

function normalizeModel(model?: string): string {
    const value = String(model ?? '').trim();
    if (!value || value.toLowerCase() === 'openrouter/free') {
        return DEFAULT_MODEL;
    }
    return value;
}

const OPENROUTER_MODEL = normalizeModel(process.env.EXPO_PUBLIC_OPENROUTER_MODEL);

// -- Types --------------------------------------------------------------------
export type InsightScope = 'district' | 'state' | 'global';

export interface InsightContext {
    scope: InsightScope;
    userDistrict?: string;
    userState?: string;
    alerts: { title: string; urgency_level: string; disease_or_issue?: string; description: string; district: string }[];
    diseaseReports: { disease_name?: string; severity?: string; district: string; symptoms?: string }[];
    waterReports: { overall_quality?: string; ph_level?: number; source_name?: string; district: string }[];
}

export interface AIInsight {
    headline: string;
    body: string;
    tips: string[];
    scope: InsightScope;
    emoji: string;
    accentColor: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
}

interface ORMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenRouterChoice {
    message?: {
        content?: string | Array<{ type?: string; text?: string }>;
    };
}

interface OpenRouterResponse {
    choices?: OpenRouterChoice[];
    error?: { message?: string };
}

function trim(str: string | undefined, max = 80): string {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '...' : str;
}

function buildContextString(ctx: InsightContext): string {
    if (ctx.scope === 'global') return '';
    const parts: string[] = [];

    if (ctx.alerts.length) {
        parts.push('ALERTS:\n' + ctx.alerts.map(a =>
            `- [${a.urgency_level?.toUpperCase()}] ${a.title}: ${trim(a.description)} (${a.district})`
        ).join('\n'));
    }

    if (ctx.diseaseReports.length) {
        parts.push('DISEASE:\n' + ctx.diseaseReports.map(r =>
            `- ${r.disease_name ?? 'Unknown'} (${r.severity ?? 'unknown'}) in ${r.district}`
        ).join('\n'));
    }

    if (ctx.waterReports.length) {
        parts.push('WATER:\n' + ctx.waterReports.map(r =>
            `- ${r.source_name ?? 'Source'} in ${r.district}: ${r.overall_quality ?? 'unknown'}`
        ).join('\n'));
    }

    return parts.join('\n\n');
}

function extractResponseText(data: OpenRouterResponse): string {
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content === 'string' && content.trim()) {
        return content;
    }

    if (Array.isArray(content)) {
        const joined = content
            .map(part => (typeof part?.text === 'string' ? part.text : ''))
            .join('')
            .trim();
        if (joined) return joined;
    }

    return '';
}

/**
 * Tolerant extraction of the reply text from a proxy response payload.
 * Accepts { content: string }, a raw OpenRouter passthrough shape, or a
 * plain/JSON-encoded string body.
 */
function extractProxyContent(data: unknown): string {
    if (typeof data === 'string') {
        const raw = data.trim();
        if (!raw) return '';
        try {
            return extractProxyContent(JSON.parse(raw));
        } catch {
            return raw; // plain-text body — treat as the content itself
        }
    }

    if (data && typeof data === 'object') {
        const obj = data as { content?: unknown; error?: unknown } & OpenRouterResponse;

        if (obj.error) {
            const msg = typeof obj.error === 'string'
                ? obj.error
                : (obj.error as { message?: string })?.message ?? 'unknown error';
            throw new Error(`AI proxy returned an error: ${msg}`);
        }

        if (typeof obj.content === 'string' && obj.content.trim()) {
            return obj.content;
        }

        // Tolerate a raw OpenRouter response passed through unchanged.
        return extractResponseText(obj);
    }

    return '';
}

/** Primary transport: Supabase Edge Function keeps the API key server-side. */
async function callProxy(
    messages: ORMessage[],
    temperature: number,
    max_tokens: number,
): Promise<string> {
    const { data, error } = await supabase.functions.invoke('openrouter-proxy', {
        body: { messages, model: OPENROUTER_MODEL, temperature, max_tokens },
    });

    if (error) {
        // FunctionsHttpError (4xx/5xx, e.g. server key not configured),
        // relay or network errors — all fall through to the direct path.
        throw new Error(`AI proxy request failed: ${error.message ?? String(error)}`);
    }

    const content = extractProxyContent(data);
    if (!content) {
        throw new Error('AI proxy returned empty content.');
    }
    return content;
}

/**
 * Sole transport: the Supabase Edge Function. There is deliberately no
 * direct-to-OpenRouter path — a client-side fallback would mean shipping the
 * API key inside every APK, where anyone can extract it. Callers already
 * degrade to non-AI content when this throws.
 */
async function callOpenRouter(
    messages: ORMessage[],
    temperature = 0.7,
    max_tokens = 350,
): Promise<string> {
    return callProxy(messages, temperature, max_tokens);
}

// -- getAIInsights ------------------------------------------------------------
export async function getAIInsights(ctx: InsightContext): Promise<AIInsight> {
    const hasCritical = ctx.alerts.some(a => ['critical', 'high'].includes(a.urgency_level?.toLowerCase()));
    const emoji = ctx.scope === 'district' ? (hasCritical ? 'ALERT' : 'WARN') : ctx.scope === 'state' ? 'STATE' : 'GLOBAL';
    const accentColor = ctx.scope === 'district' ? (hasCritical ? '#DC2626' : '#EA580C') : ctx.scope === 'state' ? '#3B82F6' : '#10B981';

    const ctxStr = buildContextString(ctx);
    const promptMap: Record<InsightScope, string> = {
        district: `Public health advisor for HealthDrop India. User in ${ctx.userDistrict}, ${ctx.userState}.\n\n${ctxStr}\n\nRespond ONLY with valid JSON:\n{"headline":"sentence max 10 words","body":"2 sentences practical advice","tips":["tip1","tip2","tip3"]}\n\nTone: ${hasCritical ? 'urgent but calm' : 'cautious'}.`,
        state: `Public health educator. User in ${ctx.userState}.\n\n${ctxStr || `General health in ${ctx.userState}`}\n\nRespond ONLY with valid JSON:\n{"headline":"sentence max 10 words","body":"2 sentences on prevention","tips":["tip1","tip2","tip3"]}`,
        global: `Friendly health educator. No local alerts.\n\nRespond ONLY with valid JSON:\n{"headline":"health headline max 10 words","body":"2 upbeat educational sentences","tips":["habit","habit","fun fact"]}\n\nTopics: nutrition, exercise, sleep, hydration.`,
    };

    const text = await callOpenRouter([
        { role: 'user', content: promptMap[ctx.scope] },
    ], 0.7, 350);

    const cleaned = text.replace(/```(?:json)?/gi, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
        throw new Error('OpenRouter insight response did not contain JSON.');
    }

    let parsed: any;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        throw new Error('OpenRouter insight JSON parse failed.');
    }

    const aiResponse: AIInsight = {
        headline: parsed.headline ?? 'Health Update',
        body: parsed.body ?? '',
        tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 3) : [],
        scope: ctx.scope,
        emoji,
        accentColor,
    };

    return aiResponse;
}

// -- getChatResponse ----------------------------------------------------------
export async function getChatResponse(
    messages: ChatMessage[],
    userContext: { role: string; district?: string; state?: string; fullName?: string; consentToExternalProcessing?: boolean }
): Promise<string> {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
        return 'Hello! I am your HealthDrop assistant. How can I help?';
    }

    const userDisplayName = userContext.consentToExternalProcessing ? (userContext.fullName ?? 'user') : 'user';
    const systemPrompt = `You are HealthDrop AI, a friendly health assistant for India.\nAssisting: ${userDisplayName} (${userContext.role}${userContext.district ? `, ${userContext.district}` : ''}).\nHelp with: disease symptoms, prevention, water quality, health campaigns, app guidance.\nBe concise (3-4 sentences max), simple language, never diagnose, recommend doctor for medical issues.`;

    const history: ORMessage[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.text } as ORMessage)),
    ];

    const reply = await callOpenRouter(history, 0.8, 320);
    return reply || 'I am not sure how to answer that. Could you rephrase?';
}
