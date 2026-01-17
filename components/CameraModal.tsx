'use client';

import { useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import { Camera, X, ScanText, Check, Loader2, RefreshCw, Send, Type } from 'lucide-react';

interface CameraModalProps {
  mode: 'capture' | 'scan';
  onClose: () => void;
  onCapture: (imageSrc: string) => void;
  onScan: (text: string) => void;
}

export default function CameraModal({ mode, onClose, onCapture, onScan }: CameraModalProps) {
  const webcamRef = useRef<Webcam>(null);
  const [loading, setLoading] = useState(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [scannedText, setScannedText] = useState<string | null>(null);

  // High-Quality Capture Settings (1080p ideal for laptop screens)
  const videoConstraints = {
    width: { min: 1280, ideal: 1920 },
    height: { min: 720, ideal: 1080 },
    facingMode: "environment" // Use back camera on mobile
  };

  const capture = useCallback(() => {
    // FIX: Call getScreenshot() without arguments. 
    // Quality is now handled by the 'screenshotQuality' prop in the JSX below.
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) setImgSrc(imageSrc);
  }, [webcamRef]);

  const processImage = async () => {
    if (!imgSrc) return;

    // 1. Photo Mode: Direct Upload (No OCR)
    if (mode === 'capture') {
      onCapture(imgSrc);
      onClose();
      return;
    }

    // 2. Scan Mode: Send to Google Cloud Vision API
    setLoading(true);
    try {
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imgSrc }),
      });

      const data = await response.json();
      
      if (!response.ok) throw new Error(data.error || 'Failed to scan');
      
      // Enter "Lens Mode" - Show text for selection instead of auto-closing
      const text = data.text || "No text found. Try capturing closer.";
      setScannedText(text);
      
    } catch (err) {
      console.error("OCR Error", err);
      alert("Could not extract text. Please ensure the image is clear.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmText = () => {
    if (scannedText) {
      // Clean up multiple spaces/newlines to make search better
      const cleanText = scannedText.replace(/\s+/g, ' ').trim();
      onScan(cleanText);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center p-0 md:p-4 backdrop-blur-md">
      <div className="relative w-full h-full md:h-auto md:max-w-2xl bg-[#1e1f20] md:rounded-3xl overflow-hidden shadow-2xl flex flex-col md:max-h-[90vh]">
        
        {/* Header */}
        <div className="flex-none p-5 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent z-10">
          <span className="text-white font-bold text-lg flex items-center gap-2 drop-shadow-md">
            {scannedText ? (
              <>
                <Type className="text-purple-400" /> Select Text
              </>
            ) : mode === 'capture' ? (
              <>
                <Camera className="text-blue-400" /> Photo Mode
              </>
            ) : (
              <>
                <ScanText className="text-green-400" /> Text Scanner
              </>
            )}
          </span>
          <button onClick={onClose} className="p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all backdrop-blur-sm">
            <X size={20} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-black relative flex flex-col overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
              <Loader2 size={48} className="text-purple-500 animate-spin mb-4" />
              <p className="text-gray-300 font-mono animate-pulse">Analyzing with AI...</p>
            </div>
          )}
          
          {/* STATE 1: LENS MODE (Text Selection) */}
          {scannedText !== null ? (
            <div className="flex-1 flex flex-col p-6 bg-[#131314]">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                  Detected Text (Edit or Copy)
                </p>
                <span className="text-xs text-purple-400 bg-purple-400/10 px-2 py-1 rounded">
                  Google Vision AI
                </span>
              </div>
              <textarea 
                className="flex-1 w-full bg-[#1e1f20] text-gray-100 p-4 rounded-xl border border-white/10 resize-none focus:outline-none focus:ring-2 focus:ring-purple-500/50 leading-relaxed font-sans text-lg"
                value={scannedText}
                onChange={(e) => setScannedText(e.target.value)}
                autoFocus
                spellCheck={false}
              />
            </div>
          ) : (
            /* STATE 2: CAMERA / PREVIEW */
            <div className="flex-1 relative flex items-center justify-center bg-black">
              {imgSrc ? (
                <img src={imgSrc} alt="Captured" className="w-full h-full object-contain" />
              ) : (
                <Webcam
                  audio={false}
                  ref={webcamRef}
                  screenshotFormat="image/jpeg"
                  screenshotQuality={0.8} // ✅ FIX: Quality prop moved here
                  videoConstraints={videoConstraints}
                  className="w-full h-full object-cover"
                />
              )}
            </div>
          )}
        </div>

        {/* Footer Controls */}
        <div className="p-6 bg-[#1e1f20] border-t border-white/5 flex-none">
          {scannedText !== null ? (
             <div className="flex gap-4">
               <button 
                 onClick={() => { setScannedText(null); setImgSrc(null); }}
                 className="flex-1 py-3 rounded-xl bg-[#2c2d2e] hover:bg-[#3c3d3e] text-gray-300 font-semibold transition-all"
               >
                 Rescan
               </button>
               <button 
                 onClick={handleConfirmText}
                 className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-bold transition-all shadow-lg shadow-purple-500/20 flex items-center justify-center gap-2"
               >
                 <Check size={18} /> Use Text
               </button>
             </div>
          ) : !imgSrc ? (
            <div className="flex justify-center items-center">
              <button 
                onClick={capture}
                className="w-18 h-18 md:w-20 md:h-20 rounded-full border-4 border-white/30 bg-white hover:scale-105 active:scale-95 transition-all shadow-[0_0_30px_rgba(255,255,255,0.2)] flex items-center justify-center"
              >
                <div className="w-14 h-14 md:w-16 md:h-16 rounded-full border-2 border-black/10" />
              </button>
            </div>
          ) : (
            <div className="flex gap-4">
              <button 
                onClick={() => setImgSrc(null)}
                className="flex-1 py-3 rounded-xl bg-[#2c2d2e] hover:bg-[#3c3d3e] text-gray-200 font-semibold transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={20} /> Retake
              </button>
              
              <button 
                onClick={processImage}
                className={`flex-1 py-3 rounded-xl font-bold text-black transition-all flex items-center justify-center gap-2 shadow-lg ${
                  mode === 'capture' 
                    ? 'bg-blue-500 hover:bg-blue-400 shadow-blue-500/20' 
                    : 'bg-green-500 hover:bg-green-400 shadow-green-500/20'
                }`}
              >
                {mode === 'capture' ? <Send size={20} /> : <ScanText size={20} />}
                {mode === 'capture' ? 'Use Photo' : 'Scan Text'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}