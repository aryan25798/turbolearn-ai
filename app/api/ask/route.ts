import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { adminDb } from '@/lib/firebaseAdmin'; 
import { z } from 'zod'; 
import { verifyUser } from '@/lib/server/security'; 
import { after } from 'next/server'; 
import { redis } from '@/lib/redis'; 

// ⚠️ SECURITY: Must be 'nodejs' to use Firebase Admin
export const runtime = 'nodejs';

// 📝 CONFIGURATION: System Prompts
// Moved here for easier updates/hotfixing. ideally fetch from DB/Remote Config.
const PROMPTS = {
  ACADEMIC: `
You are TurboLearn AI, an elite academic engine.
RULES:
1. **Direct Answer**: Output the final answer immediately. No filler words.
2. **Concise**: Use bullet points. Keep it punchy.
3. **Format**: Use Markdown. **Bold** key terms. LaTeX for math ($x^2$).
4. **Context**: If an image is present, treat it as the primary source.
`,
  REASONING: "You are a helpful academic assistant. Answer directly and concisely using Markdown."
};

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

    // 2. SECURITY, TIER CHECK & RATE LIMITING
    try {
      const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
      const dailyUsageKey = `usage:${userId}:${today}`;

      // 🔒 SEQUENTIAL EXECUTION (Fixes Race Condition)
      // We verify the user FIRST. If they are banned/unauthorized, we do NOT increment the counter.
      // This prevents malicious users from inflating the Redis keyspace.
      const userData = await verifyUser(userId); 
      
      // Only increment if verification passed
      const requestCount = await redis.incr(dailyUsageKey);

      // ✅ TIER LOGIC
      const userTier = userData.tier || 'free';
      const dailyLimit = userData.customQuota ?? 50; 
      const currentUsage = requestCount as number;

      // 🛑 BLOCKING CHECK
      if (userTier !== 'pro' && currentUsage > dailyLimit) {
         return new Response(JSON.stringify({ 
             error: "Daily limit exhausted. Upgrade to Pro for unlimited access.",
             code: "QUOTA_EXCEEDED"
         }), { status: 429 });
      }

      // ⚡️ EXPIRY MANAGEMENT (Background)
      if (currentUsage === 1) {
        after(async () => {
           try {
             await redis.expire(dailyUsageKey, 86400); // 24 Hours
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
    let systemPrompt = PROMPTS.ACADEMIC;

    if (provider === 'google') {
      model = google('gemini-2.5-flash'); 
    } else if (provider === 'groq') {
      model = groq('llama-3.3-70b-versatile'); 
    } else if (provider === 'deepseek') {
      // ✅ "DEEPSEEK" ROUTE -> Uses Gemini 2.0 Flash (Reasoning Model)
      model = google('gemini-2.0-flash-exp'); 
      systemPrompt = PROMPTS.REASONING;
    } else {
      return new Response('Invalid provider', { status: 400 });
    }

    // 5. Context Window Management
    const MAX_CONTEXT_WINDOW = 15;
    const recentMessages = messages.length > MAX_CONTEXT_WINDOW 
        ? messages.slice(-MAX_CONTEXT_WINDOW) 
        : messages;

    // 6. MESSAGE SANITIZATION & FILTERING
    // Fix: We now filter out empty messages entirely to prevent LLM hallucinations.
    const coreMessages = recentMessages
      .map((m: any, index: number) => {
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
                { type: 'text', text: userText || ' ' }, // Ensure at least one text part exists
                { type: 'image', image: image } 
              ]
            };
          }
        } 
        // CASE B: GROQ (Strict Text-Only)
        else {
          if (Array.isArray(m.content)) {
            finalContent = m.content
              .filter((c: any) => c.type === 'text')
              .map((c: any) => c.text || '')
              .join('\n');
          }
        }

        return {
          role: m.role,
          content: finalContent
        };
      })
      .filter((m: any) => {
        // 🗑️ FILTER: Remove messages that are empty or whitespace only
        if (!m.content) return false;
        if (typeof m.content === 'string' && m.content.trim() === '') return false;
        if (Array.isArray(m.content) && m.content.length === 0) return false;
        return true;
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