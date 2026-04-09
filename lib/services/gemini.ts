// =====================================================
// OPENROUTER AI SERVICE - Direct API implementation
// =====================================================

import { saveAIInsight } from './mongoService';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free';

function normalizeModel(model?: string): string {
    const value = String(model ?? '').trim();
    if (!value || value.toLowerCase() === 'openrouter/free') {
        return DEFAULT_MODEL;
    }
    return value;
}

const OPENROUTER_MODEL = normalizeModel(process.env.EXPO_PUBLIC_OPENROUTER_MODEL);
const OPENROUTER_API_KEY = String(process.env.EXPO_PUBLIC_OPENROUTER_API_KEY ?? '').trim();

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

async function callOpenRouter(
    messages: ORMessage[],
    temperature = 0.7,
    max_tokens = 350,
): Promise<string> {
    if (!OPENROUTER_API_KEY) {
        throw new Error('EXPO_PUBLIC_OPENROUTER_API_KEY is missing.');
    }

    const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'https://healthdrop.local',
            'X-Title': 'HealthDrop Surveillance System',
        },
        body: JSON.stringify({
            model: OPENROUTER_MODEL,
            messages,
            temperature,
            max_tokens,
            stream: false,
        }),
    });

    let payload: OpenRouterResponse = {};
    const rawText = await response.text();

    try {
        payload = rawText ? JSON.parse(rawText) : {};
    } catch {
        throw new Error(`OpenRouter returned invalid JSON: ${rawText.slice(0, 200)}`);
    }

    if (!response.ok) {
        const err = payload?.error?.message || `HTTP ${response.status}`;
        throw new Error(`OpenRouter request failed: ${err}`);
    }

    const content = extractResponseText(payload);
    if (!content) {
        throw new Error('OpenRouter returned empty content.');
    }

    return content;
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

    // Non-blocking secondary persistence (MongoDB). Failures must never impact primary flow.
    void saveAIInsight({
        district: ctx.userDistrict ?? null,
        state: ctx.userState ?? null,
        scope: ctx.scope,
        type: 'ai_recommendation',
        data: aiResponse,
        created_at: new Date(),
    });

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
