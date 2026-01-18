import { adminDb } from '@/lib/firebaseAdmin';

// 🚀 CACHE LAYER: Prevents reading Firestore on every request.
// Stores user data in memory for 60 seconds.
// This works perfectly in serverless "warm" executions.
const USER_CACHE = new Map<string, { data: FirebaseFirestore.DocumentData, timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 Minute Cache Duration

export async function verifyUser(userId: string) {
  if (!userId) {
    throw new Error("Unauthorized: No User ID");
  }

  // 1. FAST PATH: Check Cache ⚡️
  const now = Date.now();
  const cached = USER_CACHE.get(userId);
  
  // If we have data and it's less than 60 seconds old, use it.
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    const userData = cached.data;
    
    // Verify permissions using cached data
    if (userData?.status !== 'approved' && userData?.role !== 'admin') {
       throw new Error("Access Denied: Account not approved.");
    }
    
    return userData; // Return instantly (0ms latency, $0 cost)
  }

  // 2. SLOW PATH: Fetch from Firestore 🐢
  // We only do this once per minute per user (per container)
  const userRef = adminDb.collection('users').doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    throw new Error("User not found");
  }

  const userData = userSnap.data();

  // 3. Centralized Access Control Logic
  if (userData?.status !== 'approved' && userData?.role !== 'admin') {
    throw new Error("Access Denied: Account not approved.");
  }

  // 4. Update Cache (Valid for next 60s)
  if (userData) {
      USER_CACHE.set(userId, { data: userData, timestamp: now });
  }

  return userData;
}