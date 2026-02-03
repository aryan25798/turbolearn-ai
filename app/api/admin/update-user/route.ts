import { NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebaseAdmin';
import { verifyUser } from '@/lib/server/security';
import { z } from 'zod';

// ⚠️ SECURITY: Ensure we use the Node.js runtime for Firebase Admin SDK
export const runtime = 'nodejs';

// ✅ Validation Schema
// Strict input validation prevents admins from accidentally sending malformed data
const UpdateUserSchema = z.object({
  adminUid: z.string().min(1, "Admin UID is required"),
  targetUserId: z.string().min(1, "Target User ID is required"),
  updates: z.object({
    tier: z.enum(['free', 'pro']).optional(),
    customQuota: z.union([z.number().min(0), z.null()]).optional(),
    status: z.enum(['approved', 'pending', 'banned']).optional(),
  }).refine(data => Object.keys(data).length > 0, {
    message: "At least one update field must be provided"
  })
});

export async function POST(req: Request) {
  try {
    // 1. Parse & Validate Request Body
    const body = await req.json();
    const parseResult = UpdateUserSchema.safeParse(body);

    if (!parseResult.success) {
      return NextResponse.json({ 
        error: "Invalid Request Data", 
        details: parseResult.error.format() 
      }, { status: 400 });
    }

    const { adminUid, targetUserId, updates } = parseResult.data;

    // 2. SECURITY: Verify Requester is an ADMIN
    // We reuse the centralized security logic to fetch the requester's profile
    try {
      const requesterProfile = await verifyUser(adminUid);
      
      if (requesterProfile.role !== 'admin') {
        console.warn(`🚨 Unauthorized Update Attempt by User: ${adminUid}`);
        return NextResponse.json({ error: "Access Denied: Admins only." }, { status: 403 });
      }
    } catch (authError: any) {
      return NextResponse.json({ error: "Authentication Failed", details: authError.message }, { status: 401 });
    }

    // 3. EXECUTE UPDATE (Firestore)
    // We perform the update on the target user's document
    const userRef = adminDb.collection('users').doc(targetUserId);
    
    // Check if user exists first to prevent writing to ghost documents
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "Target user not found" }, { status: 404 });
    }

    await userRef.update({
      ...updates,
      updatedAt: new Date(), // Good practice to track when changes happen
      updatedBy: adminUid    // Audit trail: track WHO made the change
    });

    console.log(`✅ User ${targetUserId} updated by Admin ${adminUid}:`, updates);

    return NextResponse.json({ 
      success: true, 
      message: "User updated successfully",
      updatedFields: updates 
    });

  } catch (error: any) {
    console.error("🔥 Admin Update Error:", error);
    return NextResponse.json({ 
      error: "Internal Server Error", 
      details: error.message 
    }, { status: 500 });
  }
}