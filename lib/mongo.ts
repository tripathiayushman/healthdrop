// =====================================================
// MONGODB CONNECTION LAYER
// Secondary NoSQL support layer for HealthDrop
// =====================================================

import type { Db, MongoClient } from 'mongodb';

const MONGO_DB_NAME = 'healthdrop_nosql';
const DEFAULT_MONGO_URI = 'mongodb://localhost:27017';

type MongoGlobalCache = {
  __healthdropMongoClient?: MongoClient | null;
  __healthdropMongoDb?: Db | null;
  __healthdropMongoConnectPromise?: Promise<Db | null> | null;
  __healthdropMongoUnsupportedLogged?: boolean;
};

const mongoGlobal = globalThis as typeof globalThis & MongoGlobalCache;

function getMongoUri(): string {
  const uri = String(
    process.env.MONGO_URI ?? process.env.EXPO_PUBLIC_MONGO_URI ?? DEFAULT_MONGO_URI
  ).trim();

  return uri || DEFAULT_MONGO_URI;
}

function canUseNodeMongoDriver(): boolean {
  const runtimeNavigator = (globalThis as any)?.navigator;
  if (runtimeNavigator?.product === 'ReactNative') {
    return false;
  }

  if (typeof (globalThis as any)?.window !== 'undefined') {
    return false;
  }

  const proc = (globalThis as any)?.process;
  return Boolean(proc?.versions?.node);
}

function getNodeRequire(): ((id: string) => any) | null {
  const candidate = (globalThis as any)?.require;
  if (typeof candidate === 'function') {
    return candidate as (id: string) => any;
  }

  try {
    // Intentionally avoid static require/import so Metro does not bundle Node-only modules.
    return Function('return require')() as (id: string) => any;
  } catch {
    return null;
  }
}

async function createMongoClient(): Promise<MongoClient> {
  const nodeRequire = getNodeRequire();
  if (!nodeRequire) {
    throw new Error('Node require() is unavailable in this runtime.');
  }

  const mongodb = nodeRequire('mongodb') as {
    MongoClient: new (
      uri: string,
      options?: {
        connectTimeoutMS?: number;
        serverSelectionTimeoutMS?: number;
        maxPoolSize?: number;
      }
    ) => MongoClient;
  };

  const client = new mongodb.MongoClient(getMongoUri(), {
    connectTimeoutMS: 4000,
    serverSelectionTimeoutMS: 4000,
    maxPoolSize: 10,
  });

  return client as MongoClient;
}

export async function connectMongo(): Promise<Db | null> {
  if (!canUseNodeMongoDriver()) {
    if (!mongoGlobal.__healthdropMongoUnsupportedLogged) {
      console.info('[Mongo] Skipping direct MongoDB connection in non-Node runtime.');
      mongoGlobal.__healthdropMongoUnsupportedLogged = true;
    }
    return null;
  }

  if (mongoGlobal.__healthdropMongoDb) {
    return mongoGlobal.__healthdropMongoDb;
  }

  if (mongoGlobal.__healthdropMongoConnectPromise) {
    return mongoGlobal.__healthdropMongoConnectPromise;
  }

  mongoGlobal.__healthdropMongoConnectPromise = (async () => {
    try {
      const client = mongoGlobal.__healthdropMongoClient ?? (await createMongoClient());

      if (!mongoGlobal.__healthdropMongoClient) {
        await client.connect();
      }

      const db = client.db(MONGO_DB_NAME);

      mongoGlobal.__healthdropMongoClient = client;
      mongoGlobal.__healthdropMongoDb = db;

      return db;
    } catch (error) {
      console.error('[Mongo] Failed to connect:', error);

      mongoGlobal.__healthdropMongoClient = null;
      mongoGlobal.__healthdropMongoDb = null;

      return null;
    } finally {
      mongoGlobal.__healthdropMongoConnectPromise = null;
    }
  })();

  return mongoGlobal.__healthdropMongoConnectPromise;
}
