// supabase/functions/push-notifications/index.ts
//
// Supabase Edge Function — Expo Push Notification Dispatcher
//
// Invoked by:
//   1. PostgreSQL trigger via pg_net.http_post()  (automatic)
//   2. Admin RPC dispatch_push_notification()      (manual)
//
// Deploy: supabase functions deploy push-notifications
//
// Required secrets (set via Supabase dashboard → Edge Functions):
//   EXPO_ACCESS_TOKEN   — from expo.dev account settings (optional but recommended)
//   SUPABASE_URL        — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — auto-injected by Supabase

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Types ────────────────────────────────────────────────────────────────────

interface PushRequest {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
  triggerType?: string;
  referenceId?: string;
  referenceTable?: string;
}

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: "default" | null;
  badge?: number;
  priority: "default" | "normal" | "high";
  channelId?: string;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK_SIZE = 100; // Expo API limit: 100 messages per request

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Chunk an array into groups of `size` */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/** Validate that a string looks like a valid Expo push token */
function isValidExpoToken(token: string): boolean {
  return (
    token.startsWith("ExponentPushToken[") ||
    token.startsWith("ExpoPushToken[")
  );
}

/**
 * Send a batch of push messages to the Expo Push API.
 * Returns the array of tickets (one per message).
 */
async function sendToExpo(
  messages: ExpoPushMessage[],
  accessToken?: string
): Promise<ExpoTicket[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });

  if (!response.ok) {
    throw new Error(
      `Expo API error: ${response.status} ${await response.text()}`
    );
  }

  const json = await response.json();
  // Expo returns { data: ExpoTicket[] }
  return json.data as ExpoTicket[];
}

// ── Map trigger type → Android notification channel ───────────────────────────

function channelForTrigger(triggerType?: string): string {
  switch (triggerType) {
    case "alert_created":
      return "health-alerts";     // high-priority channel — configure in app
    case "report_approved":
      return "report-updates";    // default-priority channel
    default:
      return "default";
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request): Promise<Response> => {
  // ── CORS pre-flight ──────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
    });
  }

  try {
    const body: PushRequest = await req.json();
    const { tokens, title, body: msgBody, data, triggerType, referenceId, referenceTable } = body;

    if (!tokens?.length || !title || !msgBody) {
      return new Response(
        JSON.stringify({ error: "tokens, title, and body are required" }),
        { status: 400 }
      );
    }

    // ── Filter to valid Expo tokens only ──────────────────────────────────
    const validTokens = tokens.filter(isValidExpoToken);
    const skippedCount = tokens.length - validTokens.length;

    if (validTokens.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          skipped: skippedCount,
          message: "No valid Expo tokens in request",
        }),
        { status: 200 }
      );
    }

    // ── Build Expo message objects ─────────────────────────────────────────
    const channel = channelForTrigger(triggerType);
    const messages: ExpoPushMessage[] = validTokens.map((token) => ({
      to: token,
      title,
      body: msgBody,
      data: {
        ...data,
        triggerType,
        referenceId,
        referenceTable,
      },
      sound: "default",
      priority: triggerType === "alert_created" ? "high" : "default",
      channelId: channel,
    }));

    // ── Send in chunks of 100 (Expo API limit) ────────────────────────────
    const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    const allTickets: ExpoTicket[] = [];

    for (const messageChunk of chunk(messages, EXPO_CHUNK_SIZE)) {
      const tickets = await sendToExpo(messageChunk, expoAccessToken);
      allTickets.push(...tickets);
    }

    // ── Update outbox rows in DB with ticket IDs ──────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const updatePromises = validTokens.map((token, i) => {
      const ticket = allTickets[i];
      const status = ticket?.status === "ok" ? "sent" : "failed";
      const ticketId = ticket?.id ?? null;
      const errorMsg =
        ticket?.status === "error"
          ? ticket.message ?? ticket.details?.error ?? "Unknown Expo error"
          : null;

      return supabase.rpc("update_push_outbox_status", {
        p_expo_token: token,
        p_ticket_id:  ticketId,
        p_status:     status,
        p_error:      errorMsg,
      });
    });

    await Promise.allSettled(updatePromises);

    // ── Summary response ──────────────────────────────────────────────────
    const sentCount   = allTickets.filter((t) => t.status === "ok").length;
    const failedCount = allTickets.filter((t) => t.status === "error").length;

    console.log(
      `Push dispatch [${triggerType ?? "manual"}]:`,
      `sent=${sentCount} failed=${failedCount} skipped=${skippedCount}`
    );

    return new Response(
      JSON.stringify({
        success:    true,
        sent:       sentCount,
        failed:     failedCount,
        skipped:    skippedCount,
        tickets:    allTickets,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("push-notifications edge function error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
