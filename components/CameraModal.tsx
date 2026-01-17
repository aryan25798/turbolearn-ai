'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { X, Check, RotateCcw, ScanLine, Zap, ZapOff } from 'lucide-react';

// Types
type BoundingBox = {
  text: string;
  box: number[]; // [x, y, width, height] in %
};

interface CameraModalProps {
  mode: 'capture' | 'scan' | null;
  onClose: () => void;
  onCapture: (imageSrc: string) => void;
  onScan: (text: string) => void;
}

export default function CameraModal({ mode, onClose, onCapture, onScan }: CameraModalProps) {
  const webcamRef = useRef<Webcam>(null);
  const [image, setImage] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<BoundingBox[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [viewState, setViewState] = useState<'camera' | 'processing' | 'selection'>('camera');
  
  // Camera Capabilities State
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{x: number, y: number} | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);

  // 1. Safe Camera Constraints
  const videoConstraints = {
    facingMode: 'environment',
    width: { ideal: 1920 }, 
    height: { ideal: 1080 }
  };

  // 2. Initialize Camera Capabilities (Focus & Torch) safely
  const handleUserMedia = useCallback((stream: MediaStream) => {
    setIsCameraReady(true);
    const track = stream.getVideoTracks()[0];
    
    // ✅ Fix: Cast to 'any' to avoid TypeScript deployment errors
    const capabilities = (track as any).getCapabilities ? (track as any).getCapabilities() : {};
    
    if (capabilities.torch) {
      setHasTorch(true);
    }

    // Attempt Continuous Focus
    try {
      if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) {
         track.applyConstraints({
            advanced: [{ focusMode: 'continuous' }] as any
         }).catch(() => {}); // ✅ Fix: Catch promise rejection
      }
    } catch (e) {
      // Ignore
    }
  }, []);

  // 3. Toggle Flashlight
  const toggleTorch = async () => {
    try {
        const stream = webcamRef.current?.video?.srcObject as MediaStream;
        const track = stream?.getVideoTracks()[0];
        if (track && hasTorch) {
            await track.applyConstraints({
                advanced: [{ torch: !torchOn }] as any
            });
            setTorchOn(!torchOn);
        }
    } catch (e) { console.error("Torch toggle failed", e); }
  };

  // 4. Unified High-Quality Capture
  const capture = useCallback(() => {
    const src = webcamRef.current?.getScreenshot();
    if (!src) return;

    const img = new Image();
    img.src = src;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        
        // HD Quality
        const maxDim = 1920; 
        const scale = Math.min(maxDim / Math.max(img.width, img.height), 1); 
        
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            
            const optimizedImage = canvas.toDataURL('image/jpeg', 0.90);
            setImage(optimizedImage);

            if (mode === 'scan') {
              setViewState('processing');
              performOCR(optimizedImage);
            } else {
              onCapture(optimizedImage);
            }
        }
    };
  }, [webcamRef, mode, onCapture]);

  // 5. OCR Logic
  const performOCR = async (base64Image: string) => {
    try {
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64Image }),
      });
      const data = await res.json();
      
      if (data.items && data.items.length > 0) {
        setOcrResult(data.items);
        setViewState('selection');
      } else {
        alert("No text found. Try holding steady.");
        setViewState('camera');
        setImage(null);
      }
    } catch (error) {
      console.error("OCR Error:", error);
      setViewState('camera');
    }
  };

  // 6. Selection Logic
  const toggleSelection = (index: number) => {
    const newSet = new Set(selectedIndices);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setSelectedIndices(newSet);
  };

  const selectAll = () => {
    if (selectedIndices.size === ocrResult.length) setSelectedIndices(new Set());
    else setSelectedIndices(new Set(ocrResult.map((_, i) => i)));
  };

  const confirmSelection = () => {
    const selectedItems = ocrResult
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => selectedIndices.has(index))
      .sort((a, b) => {
        const yDiff = a.item.box[1] - b.item.box[1];
        if (Math.abs(yDiff) > 5) return yDiff; 
        return a.item.box[0] - b.item.box[0];
      })
      .map(({ item }) => item.text);

    onScan(selectedItems.join(' '));
  };

  // 7. Robust Tap to Focus (Fixed Error)
  const handleTapToFocus = async (e: React.MouseEvent<HTMLDivElement>) => {
      if (viewState !== 'camera' || !isCameraReady) return;
      
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setFocusPoint({ x, y });
      
      try {
          const stream = webcamRef.current?.video?.srcObject as MediaStream;
          const track = stream?.getVideoTracks()[0];
          const capabilities = (track as any).getCapabilities ? (track as any).getCapabilities() : {};

          // If the device supports 'pointsOfInterest'
          if (capabilities.pointsOfInterest) {
              const normX = x / rect.width;
              const normY = y / rect.height;
              await track.applyConstraints({
                  advanced: [{ pointsOfInterest: [{ x: normX, y: normY }] }] as any
              }).catch(() => {});
          } 
          // Fallback: Toggle focus mode
          else if (capabilities.focusMode && capabilities.focusMode.includes('auto')) {
             await track?.applyConstraints({ advanced: [{ focusMode: 'auto' }] as any }).catch(() => {});
             
             // Re-enable continuous focus after a short delay
             if (capabilities.focusMode.includes('continuous')) {
                 setTimeout(() => {
                      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] as any }).catch(() => {});
                 }, 1000);
             }
          }
      } catch(e) {
          // Silent fail - visual ring is enough
      }

      setTimeout(() => setFocusPoint(null), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col animate-in fade-in duration-300 font-sans select-none">
      
      {/* HEADER */}
      <div className="flex-none h-16 px-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent absolute top-0 w-full z-30">
        <button onClick={onClose} className="p-2 text-white/90 hover:text-white bg-black/20 rounded-full backdrop-blur-md transition-all active:scale-95">
          <X size={22} />
        </button>
        <span className="font-medium text-white/90 tracking-wide text-sm bg-black/30 px-3 py-1 rounded-full backdrop-blur-md border border-white/10">
          {viewState === 'selection' ? 'Tap words to select' : mode === 'scan' ? 'Google Lens Mode' : 'Camera'}
        </span>
        
        {/* Flashlight Button */}
        <div className="w-10 flex justify-end">
            {hasTorch && viewState === 'camera' && (
                <button 
                    onClick={toggleTorch}
                    className={`p-2 rounded-full backdrop-blur-md transition-all ${torchOn ? 'bg-yellow-400 text-black shadow-[0_0_15px_rgba(250,204,21,0.5)]' : 'bg-black/20 text-white/80'}`}
                >
                    {torchOn ? <Zap size={20} fill="black" /> : <ZapOff size={20} />}
                </button>
            )}
        </div>
      </div>

      {/* MAIN VIEWPORT */}
      <div 
        className="flex-1 relative overflow-hidden flex items-center justify-center bg-black cursor-crosshair"
        onClick={handleTapToFocus}
      >
        {/* CAMERA FEED */}
        {viewState === 'camera' && (
          <>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={videoConstraints}
              onUserMedia={handleUserMedia}
              onUserMediaError={(e) => console.warn("Camera Load Error", e)}
              className="absolute inset-0 w-full h-full object-cover"
            />
            
            {/* Visual Focus Ring */}
            {focusPoint && (
                <div 
                    className="absolute w-16 h-16 border-2 border-yellow-400 rounded-full animate-ping opacity-75 pointer-events-none transform -translate-x-1/2 -translate-y-1/2"
                    style={{ left: focusPoint.x, top: focusPoint.y }}
                />
            )}
            
            {/* Grid Overlay */}
            <div className="absolute inset-0 pointer-events-none opacity-10">
                <div className="w-full h-1/3 border-b border-white"></div>
                <div className="w-full h-1/3 border-b border-white top-1/3 absolute"></div>
                <div className="h-full w-1/3 border-r border-white absolute left-0 top-0"></div>
                <div className="h-full w-1/3 border-r border-white absolute right-1/3 top-0"></div>
            </div>
          </>
        )}

        {/* CAPTURED IMAGE & LENS OVERLAY */}
        {(viewState === 'processing' || viewState === 'selection') && image && (
          <div className="relative w-full h-full animate-in fade-in duration-500">
            <img src={image} alt="Captured" className="w-full h-full object-contain bg-[#121212]" />
            
            {/* SCANNER EFFECT */}
            {viewState === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/40 backdrop-blur-[2px]">
                 <div className="relative w-full max-w-sm h-64 border border-blue-400/30 rounded-lg overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.8)] animate-[scan_2s_linear_infinite]" />
                 </div>
                 <p className="mt-6 text-blue-200 font-mono text-sm tracking-widest animate-pulse flex items-center gap-2">
                    <ScanLine size={16} /> DETECTING TEXT...
                 </p>
              </div>
            )}

            {/* SELECTION UI */}
            {viewState === 'selection' && (
              <div className="absolute inset-0 z-20">
                {ocrResult.map((item, i) => (
                  <div
                    key={i}
                    onClick={(e) => { e.stopPropagation(); toggleSelection(i); }}
                    className={`absolute transition-all duration-200 cursor-pointer rounded-sm flex items-center justify-center
                      ${selectedIndices.has(i) 
                        ? 'bg-blue-500/40 shadow-[0_0_10px_rgba(59,130,246,0.3)] ring-1 ring-blue-400'
                        : 'bg-white/10 hover:bg-white/20'
                      }
                    `}
                    style={{
                      left: `${item.box[0]}%`,
                      top: `${item.box[1]}%`,
                      width: `${item.box[2]}%`,
                      height: `${item.box[3]}%`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM CONTROLS */}
      <div className="flex-none bg-black/90 px-6 py-8 pb-[calc(env(safe-area-inset-bottom)+20px)] border-t border-white/5 backdrop-blur-lg">
        {viewState === 'camera' ? (
          <div className="flex justify-center items-center gap-8">
            <div className="w-12" /> 
            <button 
              onClick={capture}
              className="w-20 h-20 rounded-full border-4 border-white/20 p-1.5 flex items-center justify-center hover:border-white transition-all active:scale-90 group relative"
            >
              <div className="w-full h-full bg-white rounded-full group-hover:scale-95 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.3)]" />
            </button>
            <div className="w-12" /> 
          </div>
        ) : viewState === 'selection' ? (
          <div className="flex items-center justify-between gap-4 animate-in slide-in-from-bottom-4 duration-300">
             <button 
                onClick={() => { setViewState('camera'); setImage(null); setSelectedIndices(new Set()); }}
                className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors p-2"
             >
               <RotateCcw size={22} />
               <span className="text-[10px] uppercase tracking-wider font-bold">Retake</span>
             </button>

             <div className="flex-1 px-4">
                 <button 
                     onClick={selectAll}
                     className="w-full py-3 rounded-xl bg-[#2c2d2e] border border-white/10 text-gray-200 text-xs font-semibold hover:bg-[#3c3e40] active:scale-95 transition-all"
                 >
                     {selectedIndices.size === ocrResult.length ? 'Deselect All' : `Select All (${ocrResult.length})`}
                 </button>
             </div>

             <button 
                onClick={confirmSelection}
                disabled={selectedIndices.size === 0}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:saturate-0 text-white px-6 py-3 rounded-full font-bold shadow-lg shadow-blue-900/20 transition-all active:scale-95 flex items-center gap-2"
             >
               <span className="text-sm">Copy Text</span>
               <Check size={18} strokeWidth={3} />
             </button>
          </div>
        ) : null}
      </div>
      
      <style jsx global>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
}