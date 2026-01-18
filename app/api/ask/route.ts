import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { createOpenAI } from '@ai-sdk/openai';
import { adminDb } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { z } from 'zod'; 
import { verifyUser } from '@/lib/server/security'; 

// ⚠️ SECURITY: Must be 'nodejs' to use Firebase Admin
export const runtime = 'nodejs';

// ✅ Validation Schema
const AskSchema = z.object({
  messages: z.array(z.object({
    role: z.string(),
    content: z.union([z.string(), z.array(z.any())]), 
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

    // 2. SECURITY & RATE LIMITING
    try {
      const rateLimitRef = adminDb.collection('rate_limits').doc(userId);
      const now = Date.now();
      const [userData, rateLimitSnap] = await Promise.all([
        verifyUser(userId), 
        rateLimitRef.get()
      ]);

      const RATE_LIMIT_WINDOW = 60 * 1000; 
      const MAX_REQUESTS = 20; 
      const rateData = rateLimitSnap.data();
      const isWindowOpen = !rateData || (now - (rateData.startTime || 0) > RATE_LIMIT_WINDOW);

      if (isWindowOpen) {
        rateLimitRef.set({ count: 1, startTime: now });
      } else {
        if ((rateData?.count || 0) >= MAX_REQUESTS) {
           return new Response(JSON.stringify({ error: "Too many requests. Please wait a moment." }), { status: 429 });
        }
        rateLimitRef.update({ count: FieldValue.increment(1) });
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
      // This is Google's newest, smartest model. It replaces DeepSeek R1 perfectly.
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

    // 6. MESSAGE SANITIZATION (The Fix for "must include at least one parts field")
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
              { type: 'text', text: userText || ' ' }, // Ensure text is never empty
              { type: 'image', image: image } 
            ]
          };
        }
        // Fallthrough to standard processing...
      } else {
        // CASE B: GROQ (Strict Text-Only)
        if (Array.isArray(m.content)) {
          finalContent = m.content
            .filter((c: any) => c.type === 'text')
            .map((c: any) => c.text || '')
            .join('\n');
        }
      }

      // 🛑 FINAL SAFETY CHECK (Prevents Google 400 Error)
      // Gemini rejects empty strings "" or empty arrays [].
      // We force a single space " " if content is missing.
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
      
      // Handle Rate Limits gracefully
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