// app/api/ocr/route.ts
import { NextResponse } from 'next/server';

export const runtime = 'edge';

export async function POST(req: Request) {
  try {
    const { image } = await req.json();

    if (!image) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }

    // 1. Get API Key from Environment Variables
    const apiKey = process.env.GOOGLE_VISION_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'API Key missing' }, { status: 500 });
    }

    const url = `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`;

    // 2. Prepare Image (Remove "data:image/jpeg;base64," prefix)
    const base64Image = image.includes('base64,') 
      ? image.split('base64,')[1] 
      : image;

    // 3. Construct Request Body for Google Vision
    const requestBody = {
      requests: [
        {
          image: { content: base64Image },
          features: [{ type: 'TEXT_DETECTION' }], // Lens mode relies on this
        },
      ],
    };

    // 4. Send to Google
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

    // 5. Extract Text
    const fullText = data.responses[0]?.fullTextAnnotation?.text || '';

    return NextResponse.json({ text: fullText });
  } catch (error: any) {
    console.error('OCR API Error:', error);
    return NextResponse.json({ error: error.message || 'Failed to process image' }, { status: 500 });
  }
}