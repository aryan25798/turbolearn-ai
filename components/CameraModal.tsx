'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { X, Check, RotateCcw, ScanLine, Zap, ZapOff, Sun, Moon } from 'lucide-react';
import { auth } from '@/lib/firebase'; // ✅ Added to get userId for secure API calls

// --- TYPES ---
type BoundingBox = {
  text: string;
  box: number[]; // [x, y, width, height] in %
};

// ✅ IMPROVEMENT: Type definitions for advanced Camera capabilities
interface MediaTrackCapabilities {
  torch?: boolean;
  exposureCompensation?: {
    min: number;
    max: number;
    step: number;
  };
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  pointsOfInterest?: boolean; // Chrome specific
}

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
  
  // Drag Selection State
  const selectionRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{x: number, y: number} | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{x: number, y: number} | null>(null);

  // Camera Capabilities State
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [exposureRange, setExposureRange] = useState<{min: number, max: number, step: number} | null>(null);
  const [brightness, setBrightness] = useState(0); 
  const [focusPoint, setFocusPoint] = useState<{x: number, y: number} | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);

  // 1. Optimized Constraints for Screens (Laptop/Monitor Anti-Glare)
  const videoConstraints = {
    facingMode: 'environment',
    width: { ideal: 1920 }, 
    height: { ideal: 1080 },
    frameRate: { ideal: 60, min: 30 } // High FPS reduces screen banding
  };

  // 2. Initialize Camera Capabilities
  const handleUserMedia = useCallback((stream: MediaStream) => {
    setIsCameraReady(true);
    const track = stream.getVideoTracks()[0];
    
    // ✅ IMPROVEMENT: Type-safe capabilities check
    // We still cast track to 'any' to access getCapabilities (which might be missing in some TS libs),
    // but we cast the RESULT to our strict interface.
    const capabilities = ((track as any).getCapabilities ? (track as any).getCapabilities() : {}) as MediaTrackCapabilities;
    const settings = track.getSettings();

    if (capabilities.torch) setHasTorch(true);

    if (capabilities.exposureCompensation) {
      setExposureRange(capabilities.exposureCompensation);
      // @ts-ignore - exposureCompensation is standard in new browsers but missing in strict TS definitions
      setBrightness(settings.exposureCompensation || 0);
    }

    // Apply "Monitor Mode" Defaults
    const advancedConstraints: any[] = [];
    if (capabilities.focusMode?.includes('continuous')) advancedConstraints.push({ focusMode: 'continuous' });
    if (capabilities.exposureMode?.includes('continuous')) advancedConstraints.push({ exposureMode: 'continuous' });
    if (capabilities.whiteBalanceMode?.includes('continuous')) advancedConstraints.push({ whiteBalanceMode: 'continuous' });

    if (advancedConstraints.length > 0) {
      track.applyConstraints({ advanced: advancedConstraints }).catch(() => {});
    }
  }, []);

  // 3. Adjust Exposure
  const handleBrightnessChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVal = parseFloat(e.target.value);
    setBrightness(newVal);
    try {
      const stream = webcamRef.current?.video?.srcObject as MediaStream;
      const track = stream?.getVideoTracks()[0];
      if (track) {
         await track.applyConstraints({
            advanced: [{ exposureCompensation: newVal }] as any
         });
      }
    } catch (err) {}
  };

  // 4. Toggle Flashlight
  const toggleTorch = async () => {
    try {
        const stream = webcamRef.current?.video?.srcObject as MediaStream;
        const track = stream?.getVideoTracks()[0];
        if (track && hasTorch) {
            await track.applyConstraints({ advanced: [{ torch: !torchOn }] as any });
            setTorchOn(!torchOn);
        }
    } catch (e) {}
  };

  // 5. Capture Logic (with Anti-Glare Filter)
  const capture = useCallback(() => {
    const src = webcamRef.current?.getScreenshot();
    if (!src) return;

    const img = new Image();
    img.src = src;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        
        // ⚡️ SPEED FIX: Reduce max resolution from 1920 to 1024.
        // This makes the payload ~4x smaller, preventing Vercel timeouts.
        const maxDim = 1024; 
        const scale = Math.min(maxDim / Math.max(img.width, img.height), 1); 
        
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            // Reduce brightness slightly to handle monitor glow, boost contrast for text
            ctx.filter = 'brightness(0.95) contrast(1.05)';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            ctx.filter = 'none'; 
            
            // ⚡️ SPEED FIX: Lower JPEG quality to 0.7
            const optimizedImage = canvas.toDataURL('image/jpeg', 0.7);
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

  // 6. OCR Logic (Secure)
  const performOCR = async (base64Image: string) => {
    try {
      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ✅ FIX: Pass userId for security check
        body: JSON.stringify({ 
            image: base64Image,
            userId: auth.currentUser?.uid
        }),
      });
      const data = await res.json();
      
      if (data.items && data.items.length > 0) {
        setOcrResult(data.items);
        setViewState('selection');
      } else {
        alert("No text found. Try adjusting brightness.");
        setViewState('camera');
        setImage(null);
      }
    } catch (error) {
      console.error("OCR Error:", error);
      setViewState('camera');
    }
  };

  // 7. DRAG TO SELECT LOGIC (Google Lens Style)
  const handlePointerDown = (e: React.PointerEvent) => {
    if (viewState !== 'selection' || !selectionRef.current) return;
    e.preventDefault();
    const rect = selectionRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setIsDragging(true);
    setDragStart({ x, y });
    setDragCurrent({ x, y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !selectionRef.current || !dragStart) return;
    e.preventDefault();
    const rect = selectionRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    
    setDragCurrent({ x, y });

    // Calculate Selection Box
    const boxLeft = Math.min(dragStart.x, x);
    const boxRight = Math.max(dragStart.x, x);
    const boxTop = Math.min(dragStart.y, y);
    const boxBottom = Math.max(dragStart.y, y);

    // Find intersecting words inside the drag box
    const newSelected = new Set(selectedIndices);
    ocrResult.forEach((item, index) => {
       const itemCenterX = item.box[0] + item.box[2] / 2;
       const itemCenterY = item.box[1] + item.box[3] / 2;
       
       if (itemCenterX >= boxLeft && itemCenterX <= boxRight &&
           itemCenterY >= boxTop && itemCenterY <= boxBottom) {
           newSelected.add(index);
       }
    });
    setSelectedIndices(newSelected);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
    setDragStart(null);
    setDragCurrent(null);
  };

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

          if (capabilities.pointsOfInterest) {
              const normX = x / rect.width;
              const normY = y / rect.height;
              await track.applyConstraints({
                  advanced: [{ pointsOfInterest: [{ x: normX, y: normY }] }] as any
              }).catch(() => {});
          } else if (capabilities.focusMode?.includes('auto')) {
              await track?.applyConstraints({ advanced: [{ focusMode: 'auto' }] as any }).catch(() => {});
              if (capabilities.focusMode?.includes('continuous')) {
                  setTimeout(() => track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] as any }).catch(() => {}), 1000);
              }
          }
      } catch(e) {}
      setTimeout(() => setFocusPoint(null), 1000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col animate-in fade-in duration-300 font-sans select-none touch-none">
      
      {/* HEADER */}
      <div className="flex-none h-16 px-4 flex justify-between items-center bg-gradient-to-b from-black/80 to-transparent absolute top-0 w-full z-30">
        <button onClick={onClose} className="p-2 text-white/90 hover:text-white bg-black/20 rounded-full backdrop-blur-md transition-all active:scale-95">
          <X size={22} />
        </button>
        <span className="font-medium text-white/90 tracking-wide text-sm bg-black/30 px-3 py-1 rounded-full backdrop-blur-md border border-white/10">
          {viewState === 'selection' ? 'Swipe to select' : mode === 'scan' ? 'Scan Monitor' : 'Camera'}
        </span>
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
        onMouseDown={viewState === 'camera' ? handleTapToFocus : undefined}
      >
        {viewState === 'camera' && (
          <>
            <Webcam
              audio={false}
              ref={webcamRef}
              screenshotFormat="image/jpeg"
              videoConstraints={videoConstraints}
              onUserMedia={handleUserMedia}
              onUserMediaError={(e) => console.warn("Camera Error", e)}
              className="absolute inset-0 w-full h-full object-cover"
            />
            {focusPoint && (
                <div 
                    className="absolute w-16 h-16 border-2 border-yellow-400 rounded-full animate-ping opacity-75 pointer-events-none transform -translate-x-1/2 -translate-y-1/2 shadow-[0_0_10px_rgba(250,204,21,0.5)]"
                    style={{ left: focusPoint.x, top: focusPoint.y }}
                />
            )}
            {exposureRange && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2 h-48 w-8 bg-black/30 backdrop-blur-md rounded-full flex flex-col items-center justify-between py-3 border border-white/10 animate-in slide-in-from-right-4 z-40" onClick={(e) => e.stopPropagation()}>
                    <Sun size={14} className="text-yellow-200" />
                    <input 
                        type="range" 
                        min={exposureRange.min} 
                        max={exposureRange.max} 
                        step={exposureRange.step} 
                        value={brightness}
                        onChange={handleBrightnessChange}
                        className="h-32 w-1 appearance-none bg-white/30 rounded-full outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                        style={{ WebkitAppearance: 'slider-vertical' }}
                    />
                    <Moon size={14} className="text-gray-400" />
                </div>
            )}
          </>
        )}

        {/* IMAGE PREVIEW & SELECTION LAYER */}
        {(viewState === 'processing' || viewState === 'selection') && image && (
          <div className="relative w-full h-full animate-in fade-in duration-500">
            <img src={image} alt="Captured" className="w-full h-full object-contain bg-[#121212]" />
            
            {viewState === 'processing' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-30 bg-black/40 backdrop-blur-[2px]">
                 <div className="relative w-full max-w-sm h-64 border border-blue-400/30 rounded-lg overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-blue-400 shadow-[0_0_20px_rgba(96,165,250,0.8)] animate-[scan_2s_linear_infinite]" />
                 </div>
                 <p className="mt-6 text-blue-200 font-mono text-sm tracking-widest animate-pulse flex items-center gap-2"><ScanLine size={16} /> PROCESSING...</p>
              </div>
            )}

            {viewState === 'selection' && (
              <div 
                ref={selectionRef}
                className="absolute inset-0 z-20 touch-none"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
              >
                {/* Drag Selection Box (Visual) */}
                {isDragging && dragStart && dragCurrent && (
                    <div 
                        className="absolute border-2 border-blue-500 bg-blue-500/20"
                        style={{
                            left: `${Math.min(dragStart.x, dragCurrent.x)}%`,
                            top: `${Math.min(dragStart.y, dragCurrent.y)}%`,
                            width: `${Math.abs(dragCurrent.x - dragStart.x)}%`,
                            height: `${Math.abs(dragCurrent.y - dragStart.y)}%`
                        }}
                    />
                )}

                {/* Detected Words */}
                {ocrResult.map((item, i) => (
                  <div
                    key={i}
                    onClick={(e) => { e.stopPropagation(); toggleSelection(i); }}
                    className={`absolute transition-all duration-150 rounded-sm cursor-pointer
                      ${selectedIndices.has(i) 
                        ? 'bg-blue-500/50' 
                        : 'bg-transparent'
                      }`}
                    style={{ left: `${item.box[0]}%`, top: `${item.box[1]}%`, width: `${item.box[2]}%`, height: `${item.box[3]}%` }}
                  >
                     {/* Debug/Highlight overlay */}
                     <div className={`w-full h-full ${!selectedIndices.has(i) && 'hover:bg-white/20'}`}></div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="flex-none bg-black/90 px-6 py-8 pb-[calc(env(safe-area-inset-bottom)+20px)] border-t border-white/5 backdrop-blur-lg">
        {viewState === 'camera' ? (
          <div className="flex justify-center items-center gap-8">
            <div className="w-12" /> 
            <button onClick={capture} className="w-20 h-20 rounded-full border-4 border-white/20 p-1.5 flex items-center justify-center hover:border-white transition-all active:scale-90 group relative">
              <div className="w-full h-full bg-white rounded-full group-hover:scale-95 transition-transform shadow-[0_0_20px_rgba(255,255,255,0.3)]" />
            </button>
            <div className="w-12" /> 
          </div>
        ) : viewState === 'selection' ? (
          <div className="flex items-center justify-between gap-4 animate-in slide-in-from-bottom-4 duration-300">
             <button onClick={() => { setViewState('camera'); setImage(null); setSelectedIndices(new Set()); }} className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors p-2">
               <RotateCcw size={22} /> <span className="text-[10px] font-bold">RETAKE</span>
             </button>
             <div className="flex-1 px-4">
                 <button onClick={selectAll} className="w-full py-3 rounded-xl bg-[#2c2d2e] border border-white/10 text-gray-200 text-xs font-semibold hover:bg-[#3c3e40] active:scale-95 transition-all">
                     {selectedIndices.size === ocrResult.length ? 'Deselect All' : `Select All (${ocrResult.length})`}
                 </button>
             </div>
             <button onClick={confirmSelection} disabled={selectedIndices.size === 0} className="bg-blue-600 hover:bg-blue-500 disabled:opacity-30 text-white px-6 py-3 rounded-full font-bold shadow-lg transition-all active:scale-95 flex items-center gap-2">
               <span className="text-sm">Copy</span> <Check size={18} strokeWidth={3} />
             </button>
          </div>
        ) : null}
      </div>
      <style jsx global>{` @keyframes scan { 0% { top: 0%; opacity: 0; } 10% { opacity: 1; } 90% { opacity: 1; } 100% { top: 100%; opacity: 0; } } `}</style>
    </div>
  );
}