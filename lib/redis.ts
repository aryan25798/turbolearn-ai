// lib/redis.ts
import Redis from 'ioredis';

const getRedisClient = () => {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not defined");
  }

  console.log("⚡️ Redis Client (TCP) Connecting...");
  
  // OPTIMIZED CONFIGURATION for Serverless/Vercel
  // 1. maxRetriesPerRequest: Fail fast so we don't hang the UI.
  // 2. connectTimeout: 10s timeout to prevent freezing.
  // 3. lazyConnect: True (Optional, but good for cold starts).
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 1, // Fail fast if Redis is down
    connectTimeout: 10000,   // 10 seconds
  });
};

// Singleton pattern to prevent "Too Many Connections" errors in development & serverless
export const redis = (global as any).redis || getRedisClient();

if (process.env.NODE_ENV !== 'production') {
  (global as any).redis = redis;
}