import { NextResponse } from 'next/server';
import { verifyUser } from '@/lib/server/security';
import { redis } from '@/lib/redis';

// ⚡️ Force Dynamic: Quota data must always be fresh, never cached by Vercel CDN.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    // 1. Extract User ID from Query Params
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // 2. Prepare Data Fetching
    // We need today's date for the Redis key: "usage:USER_ID:YYYY-MM-DD"
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `usage:${userId}:${today}`;

    // 3. Parallel Execution 🚀
    // Fetch Firestore Permissions AND Redis Usage Counter simultaneously.
    // This reduces latency by overlapping the database waits.
    const [userData, currentUsageRaw] = await Promise.all([
      verifyUser(userId),
      redis.get(usageKey)
    ]);

    // 4. Parse Data & Apply Defaults
    // Handle cases where usage is null (0) or fields are missing.
    const usage = typeof currentUsageRaw === 'number' ? currentUsageRaw : parseInt(currentUsageRaw as string || '0', 10);
    const tier = userData.tier || 'free';
    
    // Determine Limit based on Tier
    // - Pro: Infinity (Unlimited)
    // - Free: Custom Quota OR Default 50
    let limit: number | 'Unlimited' = 50;
    if (tier === 'pro') {
      limit = 'Unlimited';
    } else if (userData.customQuota !== undefined && userData.customQuota !== null) {
      limit = userData.customQuota;
    }

    // Calculate Remaining
    // If Unlimited, remaining is also Unlimited. Otherwise, Math.max(0, limit - usage).
    let remaining: number | 'Unlimited' = 'Unlimited';
    if (typeof limit === 'number') {
      remaining = Math.max(0, limit - usage);
    }

    // 5. Return JSON Response
    return NextResponse.json({
      tier,
      limit,
      usage,
      remaining,
      // Metadata for frontend debugging/display
      resetAt: "00:00 UTC", 
      isPro: tier === 'pro'
    });

  } catch (error: any) {
    console.error("🔥 Quota Check Failed:", error);
    
    // Handle Specific Security Errors from verifyUser
    if (error.message.includes("Access Denied") || error.message.includes("Unauthorized")) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({ error: "Failed to fetch quota" }, { status: 500 });
  }
}