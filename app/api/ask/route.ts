import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';
import { deepseek } from '@ai-sdk/deepseek'; // ✅ Added DeepSeek Provider
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
  // 👇 Updated Enum to accept 'deepseek'
  provider: z.enum(['google', 'groq', 'deepseek']), 
  image: z.string().nullable().optional(),
  userId: z.string().min(1, "User ID is required"),
});

export async function POST(req: Request) {
  try {
    // 1. Extract & Validate Data
    const body = await req.json();
    
    // 🛡️ Zod Validation: Fail fast
    const parseResult = AskSchema.safeParse(body);
    if (!parseResult.success) {
      return new Response(JSON.stringify({ error: "Invalid Request Data", details: parseResult.error }), { status: 400 });
    }
    
    const { messages, provider, image, userId } = parseResult.data;

    // 2. SECURITY & RATE LIMITING (Parallel Execution for Speed)
    try {
      const rateLimitRef = adminDb.collection('rate_limits').doc(userId);
      const now = Date.now();

      // ⚡️ SPEED FIX: Parallel Reads
      const [userData, rateLimitSnap] = await Promise.all([
        verifyUser(userId), 
        rateLimitRef.get()
      ]);

      // --- 🛡️ RATE LIMITING ---
      const RATE_LIMIT_WINDOW = 60 * 1000; // 1 Minute
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
      const status = error.message.includes("Access Denied") ? 403 : 
                     error.message.includes("Unauthorized") ? 401 : 500;
      return new Response(JSON.stringify({ error: error.message || "Security verification failed" }), { status });
    }

    // 3. Model Selection & System Prompt
    let model;
    
    // Default optimized system prompt
    let systemPrompt = `
You are TurboLearn AI, an elite academic engine.
RULES:
1. **Direct Answer**: Output the final answer immediately. No filler words.
2. **Concise**: Use bullet points. Keep it punchy.
3. **Format**: Use Markdown. **Bold** key terms. LaTeX for math ($x^2$).
4. **Context**: If an image is present, treat it as the primary source.
`;

    if (provider === 'google') {
      // ⚡️ Gemini 2.5 Flash: Fastest Multimodal Model
      model = google('gemini-2.5-flash'); 
    } else if (provider === 'groq') {
      // ⚡️ Llama 3.3: Fastest Inference (LPUs)
      model = groq('llama-3.3-70b-versatile'); 
    } else if (provider === 'deepseek') {
      // 🧠 DeepSeek R1: "Thinking" Model
      // We relax the system prompt slightly for R1 as it relies on internal chain-of-thought
      model = deepseek('deepseek-reasoner'); 
      systemPrompt = "You are a helpful academic assistant. Answer directly and concisely using Markdown.";
    } else {
      return new Response('Invalid provider', { status: 400 });
    }

    // 5. Context Window Management
    const MAX_CONTEXT_WINDOW = 15;
    const recentMessages = messages.length > MAX_CONTEXT_WINDOW 
        ? messages.slice(-MAX_CONTEXT_WINDOW) 
        : messages;

    // 6. Message Formatting & Smart Image Routing
    const coreMessages = recentMessages.map((m: any, index: number) => {
      // Target the user's latest message
      if (index === recentMessages.length - 1 && m.role === 'user') {
        
        // 🖼️ IMAGE GATEKEEPER
        // ONLY attach the image if the provider is Google (Gemini).
        // DeepSeek and Groq are text-only; sending an image will cause them to crash.
        if (image && provider === 'google') {
          return {
            role: 'user',
            content: [
              { type: 'text', text: m.content as string },
              { type: 'image', image: image } // ✅ Gemini gets Image + Text
            ]
          };
        }
        
        // Fallback: Text Only (for DeepSeek, Groq, or if no image exists)
        return { role: 'user', content: m.content };
      }
      return { role: m.role, content: m.content };
    });

    // 7. Stream Response
    const result = await streamText({
      model: model,
      system: systemPrompt,
      messages: coreMessages,
      // DeepSeek R1 requires higher temp (0.6) for reasoning creativity
      // Gemini/Llama use 0.1 for strict factual accuracy
      temperature: provider === 'deepseek' ? 0.6 : 0.1, 
      // DeepSeek R1 outputs a "thinking" trace which needs more token headroom
      maxOutputTokens: provider === 'deepseek' ? 4000 : 1024, 
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