import { NextResponse } from 'next/server';
import { verifyUser } from '@/lib/server/security'; // ✅ Centralized Gatekeeper
import { redis } from '@/lib/redis'; // ✅ Redis Client
import crypto from 'crypto'; // For hashing images

// ⚠️ SECURITY: Use 'nodejs' runtime for stable database checks & crypto
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { image, userId } = await req.json();

    // --- 1. CENTRALIZED SECURITY CHECK ---
    try {
      // ✅ Uses the shared gatekeeper logic (throws if banned/missing/unauthorized)
      await verifyUser(userId); 
    } catch (authError: any) {
      // Differentiate between 401 (Unauthorized) and 403 (Forbidden/Banned)
      const status = authError.message.includes("Access Denied") ? 403 : 401;
      return NextResponse.json({ error: authError.message }, { status });
    }

    // --- 2. VALIDATION ---
    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API Key missing' }, { status: 500 });
    }

    // --- 3. CACHE LAYER (De-duplication) ⚡️ ---
    // We hash the base64 image string to create a unique fingerprint.
    // If we've seen this exact image before, we return the cached OCR result instantly.
    let cacheKey = '';
    try {
      // Create a fast MD5 hash of the image content
      const hash = crypto.createHash('md5').update(image).digest('hex');
      cacheKey = `ocr:${hash}`;

      const cachedResult = await redis.get(cacheKey);
      if (cachedResult) {
        console.log("⚡️ OCR Cache Hit");
        return NextResponse.json(JSON.parse(cachedResult));
      }
    } catch (cacheError) {
      console.warn("⚠️ OCR Cache Read Failed (Proceeding to API):", cacheError);
    }

    // --- 4. PREPARE GOOGLE VISION REQUEST ---
    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;
    const base64Image = image.includes('base64,') 
      ? image.split('base64,')[1] 
      : image;

    const requestBody = {
      requests: [
        {
          image: { content: base64Image },
          features: [{ type: 'TEXT_DETECTION' }],
        },
      ],
    };

    // --- 5. CALL GOOGLE VISION API ---
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Google Vision Error:", data);
      throw new Error(data.error?.message || 'Failed to scan text');
    }

    const responses = data.responses?.[0];
    const annotations = responses?.textAnnotations;

    if (!annotations || annotations.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // --- 6. PROCESS COORDINATES ---
    let imgWidth = 0;
    let imgHeight = 0;

    // Try to get dimensions from metadata
    if (responses.fullTextAnnotation?.pages?.[0]) {
        imgWidth = responses.fullTextAnnotation.pages[0].width;
        imgHeight = responses.fullTextAnnotation.pages[0].height;
    } 
    
    // Fallback: Estimate from bounding box if metadata is missing
    if (!imgWidth || !imgHeight) {
        const fullVertices = annotations[0].boundingPoly?.vertices || [];
        imgWidth = Math.max(...fullVertices.map((v: any) => v.x || 0));
        imgHeight = Math.max(...fullVertices.map((v: any) => v.y || 0));
    }

    // Map annotations to "Lens" format (Percentages)
    const items = annotations.slice(1).map((ann: any) => {
      const vertices = ann.boundingPoly?.vertices;
      if (!vertices) return null;

      const xs = vertices.map((v: any) => v.x || 0);
      const ys = vertices.map((v: any) => v.y || 0);
      
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const w = Math.max(...xs) - x;
      const h = Math.max(...ys) - y;

      return {
        text: ann.description,
        box: [
          (x / imgWidth) * 100, // left %
          (y / imgHeight) * 100, // top %
          (w / imgWidth) * 100, // width %
          (h / imgHeight) * 100 // height %
        ]
      };
    }).filter(Boolean);

    const result = { items };

    // --- 7. SAVE TO CACHE 💾 ---
    // Store result for 24 hours (86400 seconds)
    // OCR results for the same image never change, so this is safe.
    try {
      if (cacheKey) {
        // Use 'EX' for ioredis compatibility
        await redis.set(cacheKey, JSON.stringify(result), 'EX', 86400); 
      }
    } catch (writeError) {
      console.error("⚠️ OCR Cache Write Failed:", writeError);
    }

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('OCR API Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process image' }, { status: 500 });
  }
}