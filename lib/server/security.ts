import { adminDb } from '@/lib/firebaseAdmin';
import { redis } from '@/lib/redis'; // ✅ Uses the shared TCP client from lib/redis.ts

// 🚀 CACHE LAYER
// Stores user data in Redis for 60 seconds to prevent hitting Firestore on every request.
// This reduces latency from ~300ms (Firestore) to ~5ms (Redis).
const CACHE_TTL_SECONDS = 60; 

export async function verifyUser(userId: string) {
  if (!userId) {
    throw new Error("Unauthorized: No User ID");
  }

  const cacheKey = `user_profile:${userId}`;

  // 1. FAST PATH: Check Redis Cache ⚡️
  try {
    const cachedString = await redis.get(cacheKey);

    if (cachedString) {
      const userData = JSON.parse(cachedString);

      // Verify permissions using cached data
      // This runs instantly without touching the database
      if (userData?.status !== 'approved' && userData?.role !== 'admin') {
         throw new Error("Access Denied: Account not approved.");
      }

      return userData; // Return instantly (Low latency)
    }
  } catch (error) {
    // Non-blocking: If Redis fails, just log it and fall back to Firestore.
    // We use console.warn so it doesn't clutter production error logs too much.
    console.warn("⚠️ Redis Cache Read Failed:", error);
  }

  // 2. SLOW PATH: Fetch from Firestore 🐢
  // Only runs if cache is missing (expired or first visit)
  const userRef = adminDb.collection('users').doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new Error("User not found");
  }

  const rawData = userSnap.data() || {};

  // 3. Centralized Access Control Logic
  if (rawData?.status !== 'approved' && rawData?.role !== 'admin') {
    throw new Error("Access Denied: Account not approved.");
  }

  // ✅ UPDATE: Apply Defaults & Type Casting
  // We explicitly cast to 'any' to allow flexible property access (tier, role, etc.)
  // This ensures the rest of your app can access userData.tier without TS errors.
  const userData: any = {
    ...rawData,
    tier: rawData?.tier || 'free',          // Default to 'free'
    customQuota: rawData?.customQuota ?? 50 // Default to 50
  };

  // 4. Update Redis Cache (Valid for 60s)
  try {
      // ⚠️ CRITICAL: We use the 'EX' syntax here because we are using 'ioredis'.
      // This sets the key to expire automatically in 60 seconds.
      await redis.set(cacheKey, JSON.stringify(userData), 'EX', CACHE_TTL_SECONDS);
  } catch (error) {
      console.error("⚠️ Failed to update Redis cache:", error);
  }

  return userData;
}