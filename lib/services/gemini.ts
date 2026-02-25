// =====================================================
// GEMINI AI SERVICE — REST API (React Native safe)
// =====================================================
// KEY INSIGHT: Free-tier API keys from Google AI Studio
// may only have access to specific model families.
// We use a GLOBAL SERIALIZED QUEUE to prevent rate-limit
// bursts when multiple dashboard panels mount simultaneously.
//
// Model priority order (Feb 2026, AI Studio free tier):
//   1. gemini-2.0-flash          PRIMARY — fastest, most capable
//   2. gemini-2.0-flash-lite     FALLBACK — lighter model
//
// Rate limit safeguards:
//   1. Global request queue (max 1 concurrent call)
//   2. Min 4s gap between requests (15 RPM = 1 every 4s)
//   3. 30-min insight cache (success) + 5-min failure cache
//   4. Static fallback when all models fail
//   5. Insight panel deduplication via shared context key
// =====================================================

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Only models confirmed available on AI Studio free tier keys
const MODEL_CASCADE = [
    'gemini-2.0-flash',       // Primary — stable
    'gemini-2.0-flash-lite',  // Lite fallback
];

// ── Types ────────────────────────────────────────────────────────────────────
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
    role: 'user' | 'model';
    text: string;
}

// ── Cache (success = 30 min TTL, failure = 5 min TTL) ───────────────────────
interface CacheEntry { insight: AIInsight; expiresAt: number }
const successCache = new Map<string, CacheEntry>();
const failureCache = new Map<string, number>(); // key → expiresAt
const SUCCESS_TTL = 30 * 60 * 1000;
const FAILURE_TTL = 5 * 60 * 1000;

function cacheKey(ctx: InsightContext): string {
    return `${ctx.scope}|${ctx.userDistrict ?? ''}|${ctx.userState ?? ''}`;
}
function getSuccessCached(ctx: InsightContext): AIInsight | null {
    const e = successCache.get(cacheKey(ctx));
    if (e && Date.now() < e.expiresAt) return e.insight;
    return null;
}
function isFailureCached(ctx: InsightContext): boolean {
    const exp = failureCache.get(cacheKey(ctx));
    return !!exp && Date.now() < exp;
}
function setSuccessCache(ctx: InsightContext, insight: AIInsight) {
    successCache.set(cacheKey(ctx), { insight, expiresAt: Date.now() + SUCCESS_TTL });
}
function setFailureCache(ctx: InsightContext) {
    failureCache.set(cacheKey(ctx), Date.now() + FAILURE_TTL);
}

// ── GLOBAL SERIALIZED REQUEST QUEUE ─────────────────────────────────────────
// Prevents multiple simultaneous API calls when many dashboards mount at once.
let _queueBusy = false;
let _lastRequestAt = 0;
const MIN_REQUEST_GAP_MS = 4200; // ~14 RPM to stay comfortably under 15 RPM limit

const _pendingQueue: Array<() => void> = [];

function enqueueRequest(fn: () => void) {
    _pendingQueue.push(fn);
    drainQueue();
}

function drainQueue() {
    if (_queueBusy) return;
    const next = _pendingQueue.shift();
    if (!next) return;

    _queueBusy = true;
    const elapsed = Date.now() - _lastRequestAt;
    const delay = Math.max(0, MIN_REQUEST_GAP_MS - elapsed);

    setTimeout(() => {
        _lastRequestAt = Date.now();
        next();
    }, delay);
}

function drainQueueWhenDone() {
    _queueBusy = false;
    drainQueue();
}

// ── Core fetch helper ────────────────────────────────────────────────────────
interface GeminiBody {
    system_instruction?: { parts: { text: string }[] };
    contents: { role: string; parts: { text: string }[] }[];
    generationConfig?: { temperature?: number; maxOutputTokens?: number };
}

async function callGeminiModel(model: string, body: GeminiBody): Promise<string> {
    const url = `${API_BASE}/${model}:generateContent?key=${API_KEY}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok) {
        const code = data?.error?.code;
        const msg = data?.error?.message ?? '';
        throw Object.assign(new Error(`${code}: ${msg}`), { code, msg });
    }

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');
    return text;
}

async function callGemini(body: GeminiBody): Promise<string> {
    if (!API_KEY) throw new Error('EXPO_PUBLIC_GEMINI_API_KEY not set');

    let lastError: any;
    for (const model of MODEL_CASCADE) {
        try {
            console.log(`[Gemini] Trying model: ${model}`);
            return await callGeminiModel(model, body);
        } catch (err: any) {
            const code = err.code ?? 0;
            const msg = String(err.message ?? '');
            if (code === 404 || msg.includes('not found') || msg.includes('INVALID_ARGUMENT')) {
                console.warn(`[Gemini] model ${model} not found (404), trying next...`);
            } else if (code === 429 || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota')) {
                console.warn(`[Gemini] model ${model} rate limited (429), trying next...`);
            } else {
                throw err;
            }
            lastError = err;
        }
    }
    throw lastError ?? new Error('All Gemini models unavailable');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function trim(str: string | undefined, max = 80): string {
    if (!str) return '';
    return str.length > max ? str.slice(0, max) + '…' : str;
}

function buildContextString(ctx: InsightContext): string {
    if (ctx.scope === 'global') return '';
    const parts: string[] = [];
    if (ctx.alerts.length)
        parts.push('ALERTS:\n' + ctx.alerts.map(a =>
            `- [${a.urgency_level?.toUpperCase()}] ${a.title}: ${trim(a.description)} (${a.district})`
        ).join('\n'));
    if (ctx.diseaseReports.length)
        parts.push('DISEASE:\n' + ctx.diseaseReports.map(r =>
            `- ${r.disease_name ?? 'Unknown'} (${r.severity ?? 'unknown'}) in ${r.district}`
        ).join('\n'));
    if (ctx.waterReports.length)
        parts.push('WATER:\n' + ctx.waterReports.map(r =>
            `- ${r.source_name ?? 'Source'} in ${r.district}: ${r.overall_quality ?? 'unknown'}`
        ).join('\n'));
    return parts.join('\n\n');
}

function fallbackInsight(ctx: InsightContext, emoji: string, accentColor: string): AIInsight {
    return {
        headline: ctx.scope === 'global' ? 'Stay healthy every day' : 'Stay informed about local health',
        body: ctx.scope === 'global'
            ? 'No active alerts in your area. Maintain good hygiene and drink clean water daily.'
            : 'Health activity detected in your region. Follow official guidance and consult a health worker if needed.',
        tips: ['Wash hands frequently with soap', 'Drink clean boiled water', 'Seek care promptly if unwell'],
        scope: ctx.scope,
        emoji,
        accentColor,
    };
}

// ── getAIInsights — uses serialized queue ────────────────────────────────────
export function getAIInsights(ctx: InsightContext): Promise<AIInsight> {
    // Check success cache first (instant return, no queue)
    const cachedOk = getSuccessCached(ctx);
    if (cachedOk) return Promise.resolve(cachedOk);

    // If we recently failed for this context, return fallback without hitting API
    const hasCritical = ctx.alerts.some(a => ['critical', 'high'].includes(a.urgency_level?.toLowerCase()));
    const emoji = ctx.scope === 'district' ? (hasCritical ? '🚨' : '⚠️') : ctx.scope === 'state' ? '📊' : '💡';
    const accentColor = ctx.scope === 'district' ? (hasCritical ? '#DC2626' : '#EA580C') : ctx.scope === 'state' ? '#3B82F6' : '#10B981';

    if (isFailureCached(ctx)) {
        console.log('[Gemini] Returning fallback (recent failure cached)');
        return Promise.resolve(fallbackInsight(ctx, emoji, accentColor));
    }

    // Queue the actual API call
    return new Promise<AIInsight>((resolve) => {
        enqueueRequest(async () => {
            // Double-check cache (another queued call may have resolved it)
            const cached2 = getSuccessCached(ctx);
            if (cached2) {
                drainQueueWhenDone();
                resolve(cached2);
                return;
            }

            const ctxStr = buildContextString(ctx);
            const promptMap: Record<InsightScope, string> = {
                district: `Public health advisor for HealthDrop India. User in ${ctx.userDistrict}, ${ctx.userState}.\n\n${ctxStr}\n\nRespond ONLY with valid JSON:\n{"headline":"sentence max 10 words","body":"2 sentences practical advice","tips":["tip1","tip2","tip3"]}\n\nTone: ${hasCritical ? 'urgent but calm' : 'cautious'}.`,
                state: `Public health educator. User in ${ctx.userState}.\n\n${ctxStr || `General health in ${ctx.userState}`}\n\nRespond ONLY with valid JSON:\n{"headline":"sentence max 10 words","body":"2 sentences on prevention","tips":["tip1","tip2","tip3"]}`,
                global: `Friendly health educator. No local alerts.\n\nRespond ONLY with valid JSON:\n{"headline":"health headline max 10 words","body":"2 upbeat educational sentences","tips":["habit","habit","fun fact"]}\n\nTopics: nutrition, exercise, sleep, hydration.`,
            };

            try {
                const text = await callGemini({
                    contents: [{ role: 'user', parts: [{ text: promptMap[ctx.scope] }] }],
                    generationConfig: { temperature: 0.7, maxOutputTokens: 350 },
                });
                const cleaned = text.replace(/```(?:json)?/gi, '').trim();
                const match = cleaned.match(/\{[\s\S]*\}/);
                if (!match) throw new Error('No JSON in response');
                const parsed = JSON.parse(match[0]);
                const insight: AIInsight = {
                    headline: parsed.headline ?? 'Health Update',
                    body: parsed.body ?? '',
                    tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 3) : [],
                    scope: ctx.scope, emoji, accentColor,
                };
                setSuccessCache(ctx, insight);
                resolve(insight);
            } catch (err) {
                console.warn('[Gemini] getAIInsights failed:', err);
                setFailureCache(ctx);
                resolve(fallbackInsight(ctx, emoji, accentColor));
            } finally {
                drainQueueWhenDone();
            }
        });
    });
}

// ── getChatResponse — also queued ────────────────────────────────────────────
let _chatCooldownUntil = 0;

export function getChatResponse(
    messages: ChatMessage[],
    userContext: { role: string; district?: string; state?: string; fullName?: string }
): Promise<string> {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
        return Promise.resolve("Hello! I am your HealthDrop assistant. How can I help?");
    }

    return new Promise<string>((resolve) => {
        enqueueRequest(async () => {
            // Enforce per-chat cooldown
            const now = Date.now();
            if (now < _chatCooldownUntil) {
                await new Promise(r => setTimeout(r, _chatCooldownUntil - now));
            }
            _chatCooldownUntil = Date.now() + 3000;

            const systemPrompt = `You are HealthDrop AI, a friendly health assistant for India.\nAssisting: ${userContext.fullName ?? 'user'} (${userContext.role}${userContext.district ? `, ${userContext.district}` : ''}).\nHelp with: disease symptoms, prevention, water quality, health campaigns, app guidance.\nBe concise (3-4 sentences max), simple language, never diagnose, recommend doctor for medical issues.`;

            const history = messages.map(m => ({ role: m.role, parts: [{ text: m.text }] }));

            try {
                const reply = await callGemini({
                    system_instruction: { parts: [{ text: systemPrompt }] },
                    contents: history,
                    generationConfig: { temperature: 0.8, maxOutputTokens: 300 },
                });
                resolve(reply || "I am not sure how to answer that. Could you rephrase?");
            } catch (err: any) {
                console.warn('[Gemini] getChatResponse failed:', err);
                const msg = String(err?.message ?? '');
                if (msg.includes('quota') || msg.includes('429') || msg.includes('unavailable')) {
                    resolve("I am currently at capacity. Please wait a moment and try again.");
                } else if (msg.includes('not set')) {
                    resolve("AI features require an API key. Please check your .env file.");
                } else {
                    resolve("I am having trouble connecting. Please check your internet and try again.");
                }
            } finally {
                drainQueueWhenDone();
            }
        });
    });
}
