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
const PROMPTS = {
  ACADEMIC: `
You are TurboLearn AI, an elite academic engine.
RULES:
1. **Direct Answer**: Output the final answer immediately. No filler words.
2. **Concise**: Use bullet points. Keep it punchy.
3. **Format**: Use Markdown. **Bold** key terms. LaTeX for math ($x^2$).
4. **Context**: You have a massive context window. Use the full history to provide continuity.
`,
  REASONING: "You are a helpful academic assistant. Answer directly and concisely using Markdown."
};

// ✅ Validation Schema
const AskSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([
        z.string().max(100000, "Message too long."), // Increased limit for large contexts
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

      // 🔒 SEQUENTIAL EXECUTION
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

      // ⚡️ EXPIRY MANAGEMENT
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
    let maxTokens = 1024; // Default for Groq/Others

    if (provider === 'google') {
      // ✅ STRICTLY GEMINI 2.5 FLASH
      model = google('gemini-2.5-flash'); 
      maxTokens = 8192; // Max output for detailed answers
    } else if (provider === 'groq') {
      model = groq('llama-3.3-70b-versatile'); 
      maxTokens = 1024;
    } else if (provider === 'deepseek') {
      // ✅ UPDATED: Use Gemini 2.5 Flash for the "Reasoning" route as well
      // Replaces Gemini 2.0 to ensure strictly 2.5 usage
      model = google('gemini-2.5-flash'); 
      systemPrompt = PROMPTS.REASONING;
      maxTokens = 8192;
    } else {
      return new Response('Invalid provider', { status: 400 });
    }

    // 5. Context Window Management
    // 🚀 UNLIMITED MEMORY: Removed the slice(-15) limit. 
    // We now pass the full history to utilize the 2M token window.
    const recentMessages = messages; 

    // 6. MESSAGE SANITIZATION & FILTERING
    const coreMessages = recentMessages
      .map((m: any, index: number) => {
        let finalContent = m.content;

        // CASE A: GOOGLE / DEEPSEEK (Multimodal Support)
        if (provider === 'google' || provider === 'deepseek') {
          // Check if this is the LATEST message from the user and has an image attachment
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
        maxOutputTokens: maxTokens, // ✅ Dynamic Limit (8192 for Gemini)
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