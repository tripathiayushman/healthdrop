// =====================================================
// MONGODB SERVICE LAYER
// Non-blocking support writes for AI, audit, and streams
// =====================================================

import { connectMongo } from '../mongo';

const DEFAULT_HEALTHCHECK_COLLECTIONS = ['ai_insights', 'audit_logs', 'notifications_stream'] as const;

type MongoWriteResult = {
  success: boolean;
  insertedId?: string;
  error?: string;
};

export type MongoHealthCheckResult = {
  success: boolean;
  databaseReachable: boolean;
  checkedAt: string;
  collections: Record<string, boolean>;
  error?: string;
};

export type AIInsightWrite = {
  district?: string | null;
  type: string;
  data: unknown;
  created_at?: Date | string;
  [key: string]: unknown;
};

export type AuditEventWrite = {
  user_id?: string | null;
  action_type: string;
  table_name: string;
  record_id?: string | null;
  old_value?: unknown;
  new_value?: unknown;
  created_at?: Date | string;
  [key: string]: unknown;
};

export type NotificationStreamWrite = {
  user_id?: string | null;
  message: string;
  read?: boolean;
  created_at?: Date | string;
  [key: string]: unknown;
};

function toDate(value?: Date | string): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

async function writeOne(collectionName: string, payload: Record<string, unknown>): Promise<MongoWriteResult> {
  try {
    const db = await connectMongo();
    if (!db) {
      return {
        success: false,
        error: 'MongoDB unavailable',
      };
    }

    const result = await db.collection(collectionName).insertOne(payload);
    return {
      success: true,
      insertedId: result.insertedId?.toString(),
    };
  } catch (error: any) {
    console.error(`[MongoService] Failed to write to ${collectionName}:`, error);
    return {
      success: false,
      error: error?.message ?? 'MongoDB write failed',
    };
  }
}

export async function saveAIInsight(data: AIInsightWrite): Promise<MongoWriteResult> {
  return writeOne('ai_insights', {
    ...data,
    created_at: toDate(data.created_at),
  });
}

export async function logAuditEvent(data: AuditEventWrite): Promise<MongoWriteResult> {
  return writeOne('audit_logs', {
    ...data,
    created_at: toDate(data.created_at),
  });
}

export async function pushNotification(data: NotificationStreamWrite): Promise<MongoWriteResult> {
  return writeOne('notifications_stream', {
    ...data,
    read: typeof data.read === 'boolean' ? data.read : false,
    created_at: toDate(data.created_at),
  });
}

export async function healthCheckMongoCollections(
  collectionNames: readonly string[] = DEFAULT_HEALTHCHECK_COLLECTIONS
): Promise<MongoHealthCheckResult> {
  const checkedAt = new Date().toISOString();

  try {
    const db = await connectMongo();
    if (!db) {
      return {
        success: false,
        databaseReachable: false,
        checkedAt,
        collections: {},
        error: 'MongoDB unavailable',
      };
    }

    const pingResult = await db.command({ ping: 1 });
    const databaseReachable = Boolean(pingResult?.ok);

    const checks = await Promise.all(
      collectionNames.map(async (name) => {
        try {
          // Read-only metadata check for collection accessibility.
          const exists = await db.listCollections({ name }, { nameOnly: true }).hasNext();
          return [name, exists] as const;
        } catch (error) {
          console.warn(`[MongoService] Health check failed for collection ${name}:`, error);
          return [name, false] as const;
        }
      })
    );

    const collections = Object.fromEntries(checks);
    const collectionsHealthy = Object.values(collections).every(Boolean);

    return {
      success: databaseReachable && collectionsHealthy,
      databaseReachable,
      checkedAt,
      collections,
      error: databaseReachable && collectionsHealthy
        ? undefined
        : 'One or more collections are not reachable or missing.',
    };
  } catch (error: any) {
    console.error('[MongoService] Health check failed:', error);
    return {
      success: false,
      databaseReachable: false,
      checkedAt,
      collections: {},
      error: error?.message ?? 'MongoDB health check failed',
    };
  }
}
