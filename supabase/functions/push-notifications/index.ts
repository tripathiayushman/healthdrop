// supabase/functions/push-notifications/index.ts
//
// Expo Push Notification Dispatcher (deployed as v2).
// SECURITY: callers hold any valid project JWT (verify_jwt), so this
// function refuses to send to any token that does not have a PENDING row
// in push_notification_outbox — rows only the trusted DB layer
// (notify_users_push, SECURITY DEFINER) creates. A caller can therefore
// only accelerate deliveries the database already authorized, never relay
// arbitrary pushes or probe tokens.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_CHUNK_SIZE = 100;

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function isValidExpoToken(token: string): boolean {
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

async function sendToExpo(messages: ExpoPushMessage[], accessToken?: string): Promise<ExpoTicket[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  const response = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    throw new Error(`Expo API error: ${response.status} ${await response.text()}`);
  }
  const json = await response.json();
  return json.data as ExpoTicket[];
}

function channelForTrigger(triggerType?: string): string {
  switch (triggerType) {
    case "alert_created":
      return "health-alerts";
    case "report_approved":
      return "report-updates";
    default:
      return "default";
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Authorization gate: only tokens with a pending outbox row ──────
    const shapeValid = tokens.filter(isValidExpoToken);
    let authorized: string[] = [];
    if (shapeValid.length) {
      const { data: pendingRows, error: outboxErr } = await supabase
        .from("push_notification_outbox")
        .select("expo_push_token")
        .eq("status", "pending")
        .in("expo_push_token", shapeValid);
      if (outboxErr) {
        console.error("outbox check failed:", outboxErr.message);
        return new Response(
          JSON.stringify({ error: "Could not verify dispatch authorization" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      const pendingSet = new Set((pendingRows ?? []).map((r) => r.expo_push_token));
      authorized = shapeValid.filter((t) => pendingSet.has(t));
    }
    const skippedCount = tokens.length - authorized.length;

    if (authorized.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          sent: 0,
          skipped: skippedCount,
          message: "No tokens with pending outbox entries",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const channel = channelForTrigger(triggerType);
    const messages: ExpoPushMessage[] = authorized.map((token) => ({
      to: token,
      title,
      body: msgBody,
      data: { ...data, triggerType, referenceId, referenceTable },
      sound: "default",
      priority: triggerType === "alert_created" ? "high" : "default",
      channelId: channel,
    }));

    const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    const allTickets: ExpoTicket[] = [];
    for (const messageChunk of chunk(messages, EXPO_CHUNK_SIZE)) {
      const tickets = await sendToExpo(messageChunk, expoAccessToken);
      allTickets.push(...tickets);
    }

    const updatePromises = authorized.map((token, i) => {
      const ticket = allTickets[i];
      const status = ticket?.status === "ok" ? "sent" : "failed";
      const ticketId = ticket?.id ?? null;
      const errorMsg =
        ticket?.status === "error"
          ? ticket.message ?? ticket.details?.error ?? "Unknown Expo error"
          : null;
      return supabase.rpc("update_push_outbox_status", {
        p_expo_token: token,
        p_ticket_id: ticketId,
        p_status: status,
        p_error: errorMsg,
      });
    });
    await Promise.allSettled(updatePromises);

    const sentCount = allTickets.filter((t) => t.status === "ok").length;
    const failedCount = allTickets.filter((t) => t.status === "error").length;
    console.log(
      `Push dispatch [${triggerType ?? "manual"}]:`,
      `sent=${sentCount} failed=${failedCount} skipped=${skippedCount}`
    );

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, failed: failedCount, skipped: skippedCount }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("push-notifications edge function error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
