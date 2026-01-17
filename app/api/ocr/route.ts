import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // 1. Get API Key
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API Key missing' }, { status: 500 });
    }

    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    // 2. Prepare Image
    const base64Image = image.includes('base64,') 
      ? image.split('base64,')[1] 
      : image;

    // 3. Request TEXT_DETECTION (includes bounding boxes)
    const requestBody = {
      requests: [
        {
          image: { content: base64Image },
          features: [{ type: 'TEXT_DETECTION' }],
        },
      ],
    };

    // 4. Call Google Vision API
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

    // Handle no text found
    if (!annotations || annotations.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // 5. Determine Image Dimensions
    // We need the original image size to convert pixel coordinates to percentages.
    // fullTextAnnotation.pages[0] usually contains the image width/height.
    let imgWidth = 0;
    let imgHeight = 0;

    if (responses.fullTextAnnotation?.pages?.[0]) {
        imgWidth = responses.fullTextAnnotation.pages[0].width;
        imgHeight = responses.fullTextAnnotation.pages[0].height;
    } 
    
    // Fallback: If dimensions aren't provided, estimate from the full-text bounding box (Index 0)
    if (!imgWidth || !imgHeight) {
        const fullVertices = annotations[0].boundingPoly?.vertices || [];
        imgWidth = Math.max(...fullVertices.map((v: any) => v.x || 0));
        imgHeight = Math.max(...fullVertices.map((v: any) => v.y || 0));
    }

    // 6. Map Annotations to "Lens" Format
    // We skip index 0 because it contains the entire text block. We want individual words (indices 1+).
    const items = annotations.slice(1).map((ann: any) => {
      const vertices = ann.boundingPoly?.vertices;
      if (!vertices) return null;

      // Find min/max X and Y to define the rectangle
      const xs = vertices.map((v: any) => v.x || 0);
      const ys = vertices.map((v: any) => v.y || 0);
      
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const w = Math.max(...xs) - x;
      const h = Math.max(...ys) - y;

      // Convert to Percentages (0-100) for CSS positioning
      return {
        text: ann.description,
        box: [
          (x / imgWidth) * 100, // left
          (y / imgHeight) * 100, // top
          (w / imgWidth) * 100, // width
          (h / imgHeight) * 100 // height
        ]
      };
    }).filter(Boolean);

    return NextResponse.json({ items });

  } catch (error: any) {
    console.error('OCR API Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process image' }, { status: 500 });
  }
}