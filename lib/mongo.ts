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
};

const mongoGlobal = globalThis as typeof globalThis & MongoGlobalCache;

function getMongoUri(): string {
  const uri = String(
    process.env.MONGO_URI ?? process.env.EXPO_PUBLIC_MONGO_URI ?? DEFAULT_MONGO_URI
  ).trim();

  return uri || DEFAULT_MONGO_URI;
}

async function createMongoClient(): Promise<MongoClient> {
  const mongodb = await import('mongodb');
  const client = new mongodb.MongoClient(getMongoUri(), {
    connectTimeoutMS: 4000,
    serverSelectionTimeoutMS: 4000,
    maxPoolSize: 10,
  });

  return client as MongoClient;
}

export async function connectMongo(): Promise<Db | null> {
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
