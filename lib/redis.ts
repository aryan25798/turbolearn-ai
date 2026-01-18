// lib/redis.ts
import Redis from 'ioredis';

const getRedisClient = () => {
  if (process.env.REDIS_URL) {
    console.log("Redis Client Connecting...");
    return new Redis(process.env.REDIS_URL);
  }
  throw new Error("REDIS_URL is not defined");
};

// Singleton pattern for Next.js hot reloading
export const redis = (global as any).redis || getRedisClient();

if (process.env.NODE_ENV !== 'production') {
  (global as any).redis = redis;
}