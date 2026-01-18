// lib/firebaseAdmin.ts
import 'server-only';
import admin from 'firebase-admin';

// 1. Initialize only if not already initialized
if (!admin.apps.length) {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    try {
      // 🛡️ ROBUST KEY PARSING START
      // 1. Remove outer quotes if they exist (some env parsers leave them)
      let formattedKey = privateKey.replace(/^"|"$/g, '');
      
      // 2. Handle literal "\n" strings (common in .env files)
      if (formattedKey.includes('\\n')) {
          formattedKey = formattedKey.replace(/\\n/g, '\n');
      }
      // 🛡️ ROBUST KEY PARSING END

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: formattedKey,
        }),
      });
      console.log("✅ Firebase Admin Initialized Successfully");
    } catch (error) {
      console.error('🔥 Firebase Admin Initialization Error:', error);
    }
  } else {
    // Optional: Log warning (useful for debugging runtime issues)
    console.warn("⚠️ FIREBASE_PRIVATE_KEY is missing. Firebase Admin initialization skipped.");
  }
}

// 2. Safe Exports
// If initialization was skipped (e.g. during build), we export casted empty objects.
// This allows the file to be imported by other routes without crashing immediately.
export const adminDb = admin.apps.length 
  ? admin.firestore() 
  : {} as FirebaseFirestore.Firestore;

export const adminAuth = admin.apps.length 
  ? admin.auth() 
  : {} as admin.auth.Auth;