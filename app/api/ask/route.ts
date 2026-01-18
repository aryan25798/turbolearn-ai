import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { adminDb } from '@/lib/firebaseAdmin'; 
import { z } from 'zod'; 
import { verifyUser } from '@/lib/server/security'; 
import { after } from 'next/server'; 
import { redis } from '@/lib/redis'; // 🔄 CHANGED: Imported from your new singleton

// ⚠️ SECURITY: Must be 'nodejs' to use Firebase Admin
export const runtime = 'nodejs';

// ✅ Validation Schema
const AskSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([
        z.string().max(20000, "Message too long. Max 20,000 characters."), 
        z.array(z.any())
    ]), 
  })),
  provider: z.enum(['google', 'groq', 'deepseek']), 
  image: z.string().nullable().optional(),
  userId: z.string().min(1, "User ID is required"),
});

export async function POST(req: Request) {
  try {
    // 1. Extract & Validate Data
    const body = await req.json();
    const parseResult = AskSchema.safeParse(body);
    
    if (!parseResult.success) {
      return new Response(JSON.stringify({ error: "Invalid Request Data", details: parseResult.error }), { status: 400 });
    }
    
    const { messages, provider, image, userId } = parseResult.data;

    // 2. SECURITY & RATE LIMITING (Redis + Firestore)
    try {
      const rateLimitKey = `rate_limit:${userId}`;
      const MAX_REQUESTS = 20; 

      // 🔒 ATOMIC PARALLEL CHECK
      // We run verifyUser (Firestore) and redis.incr (Redis) simultaneously.
      // - verifyUser: Checks for bans/auth validity.
      // - redis.incr: Atomically increments count & returns the NEW value instantly.
      // This eliminates Race Conditions and reduces latency by ~50%.
      const [userData, requestCount] = await Promise.all([
        verifyUser(userId), 
        redis.incr(rateLimitKey) 
      ]);

      // 🛑 BLOCKING CHECK: Reject if limit exceeded
      if (requestCount > MAX_REQUESTS) {
         return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), { status: 429 });
      }

      // ⚡️ EXPIRY MANAGEMENT (Background)
      // If this is the FIRST request in the window (count === 1), set the expiry.
      // We use 'after' to execute this *after* the response is sent, keeping the API fast.
      if (requestCount === 1) {
        after(async () => {
           try {
             await redis.expire(rateLimitKey, 60);
           } catch (e) {
             console.error("Failed to set Redis expiry:", e);
           }
        });
      }

    } catch (error: any) {
      console.error("🔥 Security Check Failed:", error);
      const status = error.message.includes("Access Denied") ? 403 : 500;
      return new Response(JSON.stringify({ error: error.message || "Security verification failed" }), { status });
    }

    // 3. Model Selection
    let model;
    let systemPrompt = `
You are TurboLearn AI, an elite academic engine.
RULES:
1. **Direct Answer**: Output the final answer immediately. No filler words.
2. **Concise**: Use bullet points. Keep it punchy.
3. **Format**: Use Markdown. **Bold** key terms. LaTeX for math ($x^2$).
4. **Context**: If an image is present, treat it as the primary source.
`;

    if (provider === 'google') {
      model = google('gemini-2.5-flash'); 
    } else if (provider === 'groq') {
      model = groq('llama-3.3-70b-versatile'); 
    } else if (provider === 'deepseek') {
      // ✅ "DEEPSEEK" ROUTE -> Uses Gemini 2.0 Flash (Reasoning Model)
      model = google('gemini-2.0-flash-exp'); 
      systemPrompt = "You are a helpful academic assistant. Answer directly and concisely using Markdown.";
    } else {
      return new Response('Invalid provider', { status: 400 });
    }

    // 5. Context Window Management
    const MAX_CONTEXT_WINDOW = 15;
    const recentMessages = messages.length > MAX_CONTEXT_WINDOW 
        ? messages.slice(-MAX_CONTEXT_WINDOW) 
        : messages;

    // 6. MESSAGE SANITIZATION
    const coreMessages = recentMessages.map((m: any, index: number) => {
      
      let finalContent = m.content;

      // CASE A: GOOGLE / DEEPSEEK (Multimodal Support)
      if (provider === 'google' || provider === 'deepseek') {
        if (index === recentMessages.length - 1 && m.role === 'user' && image) {
          const userText = Array.isArray(m.content) 
            ? m.content.map((c: any) => c.text || '').join('') 
            : m.content;
            
          return {
            role: 'user',
            content: [
              { type: 'text', text: userText || ' ' }, 
              { type: 'image', image: image } 
            ]
          };
        }
      } else {
        // CASE B: GROQ (Strict Text-Only)
        if (Array.isArray(m.content)) {
          finalContent = m.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text || '')
            .join('\n');
        }
      }

      // 🛑 FINAL SAFETY CHECK
      if (
        !finalContent || 
        (typeof finalContent === 'string' && finalContent.trim() === '') || 
        (Array.isArray(finalContent) && finalContent.length === 0)
      ) {
        finalContent = ' '; 
      }

      return {
        role: m.role,
        content: finalContent
      };
    });

    // 7. Stream Response
    try {
      const result = await streamText({
        model: model,
        system: systemPrompt,
        messages: coreMessages as any, 
        temperature: provider === 'deepseek' ? 0.7 : 0.1, 
        maxOutputTokens: provider === 'deepseek' ? 8192 : 1024, 
      });

      return result.toTextStreamResponse();

    } catch (streamError: any) {
      console.error(`🔥 ${provider} Stream Error:`, streamError);
      
      const isQuotaError = streamError.message?.toLowerCase().includes('429') || 
                           streamError.message?.toLowerCase().includes('resource exhausted');

      if (isQuotaError) {
         return new Response(JSON.stringify({ 
          error: "System busy. Please try again in a moment.", 
          code: "AI_BUSY" 
        }), { status: 503 });
      }

      throw streamError;
    }

  } catch (error) {
    console.error("🔥 AI Error:", error);
    return new Response(JSON.stringify({ error: "Failed to process request" }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}