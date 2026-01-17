import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

// ⚠️ SECURITY: Must be 'nodejs' to use Firebase Admin
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    // 1. Extract Data
    const { messages, provider, image, userId } = await req.json();

    // 2. SECURITY CHECK (Admin SDK)
    if (!userId) {
      return new Response(JSON.stringify({ error: "Unauthorized: No User ID" }), { status: 401 });
    }

    try {
      // ⚡️ SPEED FIX: Parallel Reads
      // Fetch User & Rate Limit data simultaneously (Cuts latency by ~50%)
      const userRef = adminDb.collection('users').doc(userId);
      const rateLimitRef = adminDb.collection('rate_limits').doc(userId);
      const now = Date.now();

      const [userSnap, rateLimitSnap] = await Promise.all([
        userRef.get(),
        rateLimitRef.get()
      ]);

      // --- A. User Status Check ---
      if (!userSnap.exists) {
        return new Response(JSON.stringify({ error: "User not found" }), { status: 403 });
      }

      const userData = userSnap.data();
      
      // 🛑 BLOCK if Pending or Banned (and not Admin)
      if (userData?.status !== 'approved' && userData?.role !== 'admin') {
         return new Response(JSON.stringify({ error: "Access Denied: Account not approved." }), { status: 403 });
      }

      // --- B. 🛡️ RATE LIMITING (Optimized: No Blocking Transactions) ---
      const RATE_LIMIT_WINDOW = 60 * 1000; // 1 Minute
      const MAX_REQUESTS = 20; // Max requests per window

      const rateData = rateLimitSnap.data();
      
      // Check if window has expired OR if it's the first request ever
      const isWindowOpen = !rateData || (now - (rateData.startTime || 0) > RATE_LIMIT_WINDOW);

      if (isWindowOpen) {
        // Reset window (Fire & Forget - don't await to speed up response)
        // Note: Since we stream the response below, this usually completes safely in background.
        rateLimitRef.set({ count: 1, startTime: now });
      } else {
        // Check Limit
        if ((rateData?.count || 0) >= MAX_REQUESTS) {
           return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), { status: 429 });
        }
        // Atomic Increment (Fastest method, no locking)
        rateLimitRef.update({ count: FieldValue.increment(1) });
      }
      // ----------------------------------------------------

    } catch (dbError: any) {
      console.error("🔥 Security/RateLimit Check Failed:", dbError);
      return new Response(JSON.stringify({ error: "Security verification failed" }), { status: 500 });
    }

    // 3. Model Selection
    let model;
    if (provider === 'google') {
      // ✅ Gemini 1.5 Flash: The standard, stable, high-speed model
      model = google('gemini-2.5-flash'); 
    } else if (provider === 'groq') {
      // ✅ Llama 3.3 Versatile: Text ONLY (Super fast reasoning)
      model = groq('llama-3.3-70b-versatile'); 
    } else {
      return new Response('Invalid provider', { status: 400 });
    }

    // 4. System Prompt (Optimized for Speed & Accuracy)
    const systemPrompt = `
You are TurboLearn AI, an elite academic engine.
RULES:
1. **Direct Answer**: Output the final answer immediately. No filler words like "Here is the answer".
2. **Concise**: Use bullet points for explanations. Keep it punchy.
3. **Format**: Use Markdown. **Bold** key terms. LaTeX for math ($x^2$).
4. **Context**: If an image is present, treat it as the primary source of the question.
`;

    // 5. Context Window Management (Sliding Window)
    // Only send the last 15 messages to save tokens.
    const MAX_CONTEXT_WINDOW = 15;
    const recentMessages = messages.length > MAX_CONTEXT_WINDOW 
        ? messages.slice(-MAX_CONTEXT_WINDOW) 
        : messages;

    // 6. Message Formatting (Strict Separation)
    const coreMessages = recentMessages.map((m: any, index: number) => {
      // Check if this is the very last message
      if (index === recentMessages.length - 1 && m.role === 'user') {
        
        // ✅ LOGIC FIX: Only attach image if provider is GOOGLE
        if (image && provider === 'google') {
          return {
            role: 'user',
            content: [
              { type: 'text', text: m.content },
              { type: 'image', image: image } 
            ]
          };
        }
        
        // Default (Text Only)
        return { role: 'user', content: m.content };
      }
      return { role: m.role, content: m.content };
    });

    // 7. Stream Response
    const result = await streamText({
      model: model,
      system: systemPrompt,
      messages: coreMessages,
      temperature: 0.1, // Low temp ensures accurate, non-hallucinated answers
      maxTokens: 1024,
    });

    return result.toTextStreamResponse();

  } catch (error) {
    console.error("🔥 AI Error:", error);
    return new Response(JSON.stringify({ error: "Failed to process request" }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}