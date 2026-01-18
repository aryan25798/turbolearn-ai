import { adminDb, adminAuth } from '@/lib/firebaseAdmin';
import { NextRequest, NextResponse } from 'next/server';

// Force nodejs runtime for Firebase Admin SDK
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { uid, adminUid } = await req.json();

    if (!uid || !adminUid) {
      return NextResponse.json({ error: "Missing Parameters" }, { status: 400 });
    }

    // 1. Verify Requestor is Admin
    const adminSnap = await adminDb.collection('users').doc(adminUid).get();
    if (!adminSnap.exists || adminSnap.data()?.role !== 'admin') {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // 2. Recursive Delete Function (Subcollections)
    // Firestore doesn't delete subcollections automatically. We must do it manually.
    
    // A. Delete 'sessions' for this user and their 'chats' subcollections
    const sessionsQuery = await adminDb.collection('sessions').where('userId', '==', uid).get();
    const batch = adminDb.batch();
    
    for (const sessionDoc of sessionsQuery.docs) {
      // Delete chats within session
      const chatsQuery = await adminDb.collection('chats').where('sessionId', '==', sessionDoc.id).get();
      chatsQuery.docs.forEach(chatDoc => {
        batch.delete(chatDoc.ref);
      });
      // Delete session doc
      batch.delete(sessionDoc.ref);
    }

    // B. Delete User Document
    batch.delete(adminDb.collection('users').doc(uid));

    // Commit Firestore Changes
    await batch.commit();

    // 3. Delete Authentication Record (Firebase Auth)
    try {
        await adminAuth.deleteUser(uid);
    } catch (authError) {
        console.warn("Auth user not found or already deleted:", authError);
        // Continue even if auth deletion fails (maybe user was already deleted from Auth)
    }

    return NextResponse.json({ success: true });

  } catch (error: any) {
    console.error("Delete User Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}