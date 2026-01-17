import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod'; 
import { verifyUser } from '@/lib/server/security'; // ✅ Import Centralized Gatekeeper

// ⚠️ SECURITY: Must be 'nodejs' to use Firebase Admin
export const runtime = 'nodejs';

// ✅ Validation Schema
const AskSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([z.string(), z.array(z.any())]), 
  })),
  provider: z.enum(['google', 'groq']),
  image: z.string().nullable().optional(),
  userId: z.string().min(1, "User ID is required"),
});

export async function POST(req: Request) {
  try {
    // 1. Extract & Validate Data
    const body = await req.json();
    
    // 🛡️ Zod Validation: Fail fast if input is invalid
    const parseResult = AskSchema.safeParse(body);
    if (!parseResult.success) {
      return new Response(JSON.stringify({ error: "Invalid Request Data", details: parseResult.error }), { status: 400 });
    }
    
    const { messages, provider, image, userId } = parseResult.data;

    // 2. SECURITY & RATE LIMITING
    try {
      // ⚡️ SPEED FIX: Parallel Reads
      // Checks User Permissions AND fetches Rate Limit data simultaneously.
      const rateLimitRef = adminDb.collection('rate_limits').doc(userId);
      const now = Date.now();

      const [userData, rateLimitSnap] = await Promise.all([
        verifyUser(userId), // ✅ Uses centralized logic (throws error if banned/missing)
        rateLimitRef.get()
      ]);

      // --- 🛡️ RATE LIMITING (Optimized) ---
      const RATE_LIMIT_WINDOW = 60 * 1000; // 1 Minute
      const MAX_REQUESTS = 20; // Max requests per window

      const rateData = rateLimitSnap.data();
      
      // Check if window has expired OR if it's the first request ever
      const isWindowOpen = !rateData || (now - (rateData.startTime || 0) > RATE_LIMIT_WINDOW);

      if (isWindowOpen) {
        // Reset window (Fire & Forget)
        rateLimitRef.set({ count: 1, startTime: now });
      } else {
        // Check Limit
        if ((rateData?.count || 0) >= MAX_REQUESTS) {
           return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), { status: 429 });
        }
        // Atomic Increment
        rateLimitRef.update({ count: FieldValue.increment(1) });
      }
      // ----------------------------------------------------

    } catch (error: any) {
      console.error("🔥 Security/RateLimit Check Failed:", error);
      // Map security errors to correct status codes
      const status = error.message.includes("Access Denied") ? 403 : 
                     error.message.includes("Unauthorized") ? 401 : 500;
      return new Response(JSON.stringify({ error: error.message || "Security verification failed" }), { status });
    }

    // 3. Model Selection
    let model;
    if (provider === 'google') {
      // ✅ FIX: Use gemini-2.5-flash (Stable Production Model)
      model = google('gemini-1.5-flash'); 
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
              { type: 'text', text: m.content as string },
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
      maxOutputTokens: 1024, // ✅ FIX: Renamed from maxTokens to maxOutputTokens
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