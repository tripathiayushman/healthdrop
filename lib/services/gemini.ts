// =====================================================
// OPENROUTER AI SERVICE — REST API (React Native safe)
// (kept in gemini.ts to avoid breaking existing imports)
// =====================================================

import { supabase } from '../supabase';

const OPENROUTER_PROXY_FUNCTION = 'openrouter-proxy';

const MODEL_CASCADE = [
    process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? 'openrouter/free',
    'meta-llama/llama-3.3-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
].filter(Boolean);

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
    role: 'user' | 'assistant';
    text: string;
}

// ── Cache (success = 30 min TTL, failure = 5 min TTL) ───────────────────────
interface CacheEntry { insight: AIInsight; createdAt: number; expiresAt: number }
interface FailureCacheEntry { createdAt: number; expiresAt: number }
const successCache = new Map<string, CacheEntry>();
const failureCache = new Map<string, FailureCacheEntry>();
const SUCCESS_TTL = 30 * 60 * 1000;
const FAILURE_TTL = 5 * 60 * 1000;
const MAX_CACHE_SIZE = 200;
const CACHE_PURGE_INTERVAL_MS = 60 * 1000;
let _lastCachePurgeAt = 0;

function trimMapToMaxSize<T>(map: Map<string, T>, maxSize: number) {
    while (map.size > maxSize) {
        const oldestKey = map.keys().next().value as string | undefined;
        if (!oldestKey) return;
        map.delete(oldestKey);
    }
}

function upsertCacheEntry<T>(map: Map<string, T>, key: string, value: T) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
}

function purgeExpiredCacheEntries(force = false) {
    const now = Date.now();
    if (!force && now - _lastCachePurgeAt < CACHE_PURGE_INTERVAL_MS) return;
    _lastCachePurgeAt = now;

    for (const [key, entry] of successCache) {
        if (entry.expiresAt <= now) successCache.delete(key);
    }
    for (const [key, entry] of failureCache) {
        if (entry.expiresAt <= now) failureCache.delete(key);
    }

    trimMapToMaxSize(successCache, MAX_CACHE_SIZE);
    trimMapToMaxSize(failureCache, MAX_CACHE_SIZE);
}

function cacheKey(ctx: InsightContext): string {
    return `${ctx.scope}|${ctx.userDistrict ?? ''}|${ctx.userState ?? ''}`;
}
function getSuccessCached(ctx: InsightContext): AIInsight | null {
    purgeExpiredCacheEntries();
    const key = cacheKey(ctx);
    const e = successCache.get(key);
    if (e && Date.now() < e.expiresAt) return e.insight;
    if (e) successCache.delete(key);
    return null;
}
function isFailureCached(ctx: InsightContext): boolean {
    purgeExpiredCacheEntries();
    const key = cacheKey(ctx);
    const entry = failureCache.get(key);
    if (!entry) return false;
    if (Date.now() < entry.expiresAt) return true;
    failureCache.delete(key);
    return false;
}
function setSuccessCache(ctx: InsightContext, insight: AIInsight) {
    purgeExpiredCacheEntries();
    const now = Date.now();
    upsertCacheEntry(successCache, cacheKey(ctx), { insight, createdAt: now, expiresAt: now + SUCCESS_TTL });
    trimMapToMaxSize(successCache, MAX_CACHE_SIZE);
}
function setFailureCache(ctx: InsightContext) {
    purgeExpiredCacheEntries();
    const now = Date.now();
    upsertCacheEntry(failureCache, cacheKey(ctx), { createdAt: now, expiresAt: now + FAILURE_TTL });
    trimMapToMaxSize(failureCache, MAX_CACHE_SIZE);
}

// ── GLOBAL SERIALIZED REQUEST QUEUE ─────────────────────────────────────────
let _queueBusy = false;
let _lastRequestAt = 0;
const MIN_REQUEST_GAP_MS = 4200;
const MAX_PENDING_QUEUE = 25;
const _pendingQueue: Array<() => void> = [];

function enqueueRequest(fn: () => void): boolean {
    if (_pendingQueue.length >= MAX_PENDING_QUEUE) {
        console.warn(`[OpenRouter] Queue full (${_pendingQueue.length}/${MAX_PENDING_QUEUE}); rejecting new request.`);
        return false;
    }
    _pendingQueue.push(fn);
    drainQueue();
    return true;
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

// ── OpenRouter fetch helper ──────────────────────────────────────────────────
interface ORMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

interface OpenRouterProxyResponse {
    content?: string;
    model?: string;
    error?: string;
    status?: number;
    detail?: string;
}

async function callOpenRouterModel(
    model: string,
    messages: ORMessage[],
    temperature = 0.7,
    max_tokens = 350,
): Promise<string> {
    const { data, error } = await supabase.functions.invoke<OpenRouterProxyResponse>(
        OPENROUTER_PROXY_FUNCTION,
        {
            body: {
                model,
                messages,
                temperature,
                max_tokens,
            },
        }
    );

    if (error) {
        throw Object.assign(new Error(`Proxy invocation failed: ${error.message}`), {
            status: 502,
            msg: error.message,
        });
    }

    if (!data) {
        throw new Error('Empty response from OpenRouter proxy');
    }

    if (data.error) {
        throw Object.assign(new Error(`${data.status ?? 500}: ${data.error}`), {
            status: data.status ?? 500,
            msg: data.error,
            detail: data.detail,
        });
    }

    if (!data.content?.trim()) {
        throw new Error('Empty content from OpenRouter proxy');
    }

    return data.content;
}

async function callOpenRouter(
    messages: ORMessage[],
    temperature = 0.7,
    max_tokens = 350,
): Promise<string> {
    let lastError: any;

    for (const model of MODEL_CASCADE) {
        try {
            console.log(`[OpenRouter] Trying model: ${model}`);
            return await callOpenRouterModel(model, messages, temperature, max_tokens);
        } catch (err: any) {
            const status = Number(err?.status ?? 0);
            const msg = String(err?.message ?? '');

            if (status === 404 || status === 429 || status >= 500 || msg.includes('rate') || msg.includes('quota')) {
                console.warn(`[OpenRouter] model ${model} unavailable, trying next...`);
                lastError = err;
                continue;
            }

            throw err;
        }
    }

    throw lastError ?? new Error('All OpenRouter models unavailable');
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
    const cachedOk = getSuccessCached(ctx);
    if (cachedOk) return Promise.resolve(cachedOk);

    const hasCritical = ctx.alerts.some(a => ['critical', 'high'].includes(a.urgency_level?.toLowerCase()));
    const emoji = ctx.scope === 'district' ? (hasCritical ? '🚨' : '⚠️') : ctx.scope === 'state' ? '📊' : '💡';
    const accentColor = ctx.scope === 'district' ? (hasCritical ? '#DC2626' : '#EA580C') : ctx.scope === 'state' ? '#3B82F6' : '#10B981';

    if (isFailureCached(ctx)) {
        console.log('[OpenRouter] Returning fallback (recent failure cached)');
        return Promise.resolve(fallbackInsight(ctx, emoji, accentColor));
    }

    return new Promise<AIInsight>((resolve) => {
        const enqueued = enqueueRequest(async () => {
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
                const text = await callOpenRouter([
                    { role: 'user', content: promptMap[ctx.scope] },
                ], 0.7, 350);

                const cleaned = text.replace(/```(?:json)?/gi, '').trim();
                const match = cleaned.match(/\{[\s\S]*\}/);
                if (!match) throw new Error('No JSON in response');

                const parsed = JSON.parse(match[0]);
                const insight: AIInsight = {
                    headline: parsed.headline ?? 'Health Update',
                    body: parsed.body ?? '',
                    tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 3) : [],
                    scope: ctx.scope,
                    emoji,
                    accentColor,
                };

                setSuccessCache(ctx, insight);
                resolve(insight);
            } catch (err) {
                console.warn('[OpenRouter] getAIInsights failed:', err);
                setFailureCache(ctx);
                resolve(fallbackInsight(ctx, emoji, accentColor));
            } finally {
                drainQueueWhenDone();
            }
        });

        if (!enqueued) {
            setFailureCache(ctx);
            resolve(fallbackInsight(ctx, emoji, accentColor));
        }
    });
}

// ── getChatResponse — also queued ────────────────────────────────────────────
let _chatCooldownUntil = 0;

export function getChatResponse(
    messages: ChatMessage[],
    userContext: { role: string; district?: string; state?: string; fullName?: string; consentToExternalProcessing?: boolean }
): Promise<string> {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user') {
        return Promise.resolve('Hello! I am your HealthDrop assistant. How can I help?');
    }

    return new Promise<string>((resolve) => {
        const enqueued = enqueueRequest(async () => {
            const now = Date.now();
            if (now < _chatCooldownUntil) {
                await new Promise(r => setTimeout(r, _chatCooldownUntil - now));
            }
            _chatCooldownUntil = Date.now() + 3000;

            const userDisplayName = userContext.consentToExternalProcessing ? (userContext.fullName ?? 'user') : 'user';
            const systemPrompt = `You are HealthDrop AI, a friendly health assistant for India.\nAssisting: ${userDisplayName} (${userContext.role}${userContext.district ? `, ${userContext.district}` : ''}).\nHelp with: disease symptoms, prevention, water quality, health campaigns, app guidance.\nBe concise (3-4 sentences max), simple language, never diagnose, recommend doctor for medical issues.`;

            const history: ORMessage[] = [
                { role: 'system', content: systemPrompt },
                ...messages.map((m) => ({
                    role: m.role,
                    content: m.text,
                } as ORMessage)),
            ];

            try {
                const reply = await callOpenRouter(history, 0.8, 300);
                resolve(reply || 'I am not sure how to answer that. Could you rephrase?');
            } catch (err: any) {
                console.warn('[OpenRouter] getChatResponse failed:', err);
                const msg = String(err?.message ?? '');
                if (msg.includes('quota') || msg.includes('429') || msg.includes('unavailable')) {
                    resolve('I am currently at capacity. Please wait a moment and try again.');
                } else if (msg.includes('proxy')) {
                    resolve('AI features are temporarily unavailable due to server proxy configuration.');
                } else {
                    resolve('I am having trouble connecting. Please check your internet and try again.');
                }
            } finally {
                drainQueueWhenDone();
            }
        });

        if (!enqueued) {
            resolve('I am currently handling many requests. Please try again in a moment.');
        }
    });
}
