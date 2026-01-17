// app/api/ask/route.ts
import { streamText } from 'ai';
import { google } from '@ai-sdk/google';
import { groq } from '@ai-sdk/groq';

// ✅ Edge runtime is critical for exam apps (0ms cold start)
export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { messages, provider, image } = await req.json();

    // 1. Model Selection (Optimized for 2026 speeds)
    let model;
    if (provider === 'google') {
      // Gemini 2.5 Flash: The fastest multimodal model
      model = google('gemini-2.5-flash');
    } else if (provider === 'groq') {
      // Llama 3.3 70B: Extremely smart, hosted on Groq's LPU for instant text speed
      model = groq('llama-3.3-70b-versatile'); 
    } else {
      return new Response('Invalid provider', { status: 400 });
    }

    // 2. System Prompt: "Answer First" approach for exams
    const systemPrompt = `
You are TurboLearn AI, an elite academic engine.
RULES:
1. **Direct Answer**: Output the final answer immediately. No filler words.
2. **Concise**: Use bullet points for explanations.
3. **Format**: Use Markdown. **Bold** key terms. LaTeX for math ($x^2$).
4. **Context**: If an image is present, treat it as the primary source of the question.
`;

    // 3. Message Formatting (Vercel AI SDK Standard)
    // We explicitly map the messages to ensure image handling works for each provider.
    const coreMessages = messages.map((m: any, index: number) => {
      // Handle the latest User message
      if (index === messages.length - 1 && m.role === 'user') {
        
        // CASE A: Google (Native Image Support)
        if (provider === 'google' && image) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: m.content },
              { type: 'image', image: image } // Accepts Base64 or URL
            ]
          };
        } 
        
        // CASE B: Groq (Text-Only / OCR Injection)
        if (provider === 'groq' && image) {
          return {
            role: 'user',
            // We inject the OCR text context explicitly for Llama
            content: `${m.content}\n\n[SYSTEM: The user attached an image. The text extracted from it is above. Solve based on this text.]`
          };
        }
      }

      // Standard history messages
      return { role: m.role, content: m.content };
    });

    // 4. Stream Response
    const result = await streamText({
      model: model,
      system: systemPrompt,
      messages: coreMessages,
      temperature: 0.1, 
      maxOutputTokens: 1024, // ✅ FIX: maxOutputTokens is correct for your SDK version
    });

    // ✅ FIX: Use toTextStreamResponse() instead of toDataStreamResponse()
    return result.toTextStreamResponse();

  } catch (error) {
    console.error("AI Error:", error);
    return new Response(JSON.stringify({ error: "Failed to process" }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}