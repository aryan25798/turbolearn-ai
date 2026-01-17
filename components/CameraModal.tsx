'use client';

import { useState, useRef, useCallback } from 'react';
import Webcam from 'react-webcam';
import { X, Camera, Check, RotateCcw, Zap, ScanLine } from 'lucide-react';

// Types for OCR Data
type BoundingBox = {
  text: string;
  box: number[]; // [x, y, width, height] (Percentages or Pixels)
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
  const [loading, setLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<BoundingBox[]>([]);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [viewState, setViewState] = useState<'camera' | 'processing' | 'selection'>('camera');

  // 1. Capture Image
  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      setImage(imageSrc);
      if (mode === 'scan') {
        setViewState('processing');
        performOCR(imageSrc);
      } else {
        onCapture(imageSrc);
      }
    }
  }, [webcamRef, mode, onCapture]);

  // 2. Perform OCR (Server-Side)
  const performOCR = async (base64Image: string) => {
    setLoading(true);
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
        alert("No text detected. Try again.");
        setViewState('camera');
        setImage(null);
      }
    } catch (error) {
      console.error("OCR Error:", error);
      alert("Failed to scan text.");
      setViewState('camera');
    } finally {
      setLoading(false);
    }
  };

  // 3. Toggle Text Selection
  const toggleSelection = (index: number) => {
    const newSet = new Set(selectedIndices);
    if (newSet.has(index)) newSet.delete(index);
    else newSet.add(index);
    setSelectedIndices(newSet);
  };

  // 4. Select All
  const selectAll = () => {
    if (selectedIndices.size === ocrResult.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(ocrResult.map((_, i) => i)));
    }
  };

  // 5. Confirm Selection
  const confirmSelection = () => {
    // Sort by vertical position (y) then horizontal (x) to maintain reading order
    const selectedItems = ocrResult
      .map((item, index) => ({ item, index }))
      .filter(({ index }) => selectedIndices.has(index))
      .sort((a, b) => {
        // Simple heuristic: if y difference is large, sort by y. Else sort by x.
        const yDiff = a.item.box[1] - b.item.box[1];
        if (Math.abs(yDiff) > 10) return yDiff; // Different lines
        return a.item.box[0] - b.item.box[0]; // Same line
      })
      .map(({ item }) => item.text);

    onScan(selectedItems.join(' '));
  };

  // --- RENDERS ---

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col animate-in fade-in duration-200">
      
      {/* HEADER */}
      <div className="flex-none p-4 flex justify-between items-center bg-black/40 backdrop-blur-md absolute top-0 w-full z-20 border-b border-white/10">
        <button onClick={onClose} className="p-2 text-white/80 hover:text-white bg-white/10 rounded-full backdrop-blur-md transition-all active:scale-95">
          <X size={24} />
        </button>
        <span className="font-semibold text-white tracking-wide">
          {viewState === 'selection' ? 'Select Text' : mode === 'scan' ? 'Scan Text' : 'Take Photo'}
        </span>
        <div className="w-10" /> {/* Spacer */}
      </div>

      {/* MAIN VIEWPORT */}
      <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
        
        {/* CAMERA FEED */}
        {viewState === 'camera' && (
          <Webcam
            audio={false}
            ref={webcamRef}
            screenshotFormat="image/jpeg"
            videoConstraints={{ facingMode: 'environment' }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* STATIC IMAGE (Processing/Selection) */}
        {(viewState === 'processing' || viewState === 'selection') && image && (
          <div className="relative w-full h-full">
            <img src={image} alt="Captured" className="w-full h-full object-contain bg-black/90" />
            
            {/* PROCESSING OVERLAY */}
            {viewState === 'processing' && (
              <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center backdrop-blur-sm z-30">
                <ScanLine size={48} className="text-blue-400 animate-pulse mb-4" />
                <div className="w-64 h-1 bg-white/20 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 animate-[loading_1.5s_ease-in-out_infinite]" style={{width: '50%'}} />
                </div>
                <p className="text-blue-200 mt-4 font-mono text-sm animate-pulse">Analyzing text...</p>
              </div>
            )}

            {/* SELECTION OVERLAY (THE LENS FEATURE) */}
            {viewState === 'selection' && (
              <div className="absolute inset-0 z-10">
                {ocrResult.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => toggleSelection(i)}
                    className={`absolute transition-all duration-150 border rounded-sm flex items-center justify-center group
                      ${selectedIndices.has(i) 
                        ? 'bg-blue-500/40 border-blue-400 shadow-[0_0_15px_rgba(59,130,246,0.5)]' 
                        : 'bg-transparent border-white/30 hover:bg-white/10'
                      }`}
                    style={{
                      left: `${item.box[0]}%`,
                      top: `${item.box[1]}%`,
                      width: `${item.box[2]}%`,
                      height: `${item.box[3]}%`,
                    }}
                  >
                    {/* Tiny indicator for selection */}
                    {selectedIndices.has(i) && (
                      <div className="absolute -top-2 -right-2 bg-blue-500 text-white rounded-full p-0.5 shadow-sm scale-75">
                         <Check size={8} strokeWidth={4} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BOTTOM CONTROLS */}
      <div className="flex-none bg-[#18181b] px-6 py-8 pb-[calc(env(safe-area-inset-bottom)+20px)] border-t border-white/10">
        
        {viewState === 'camera' ? (
          <div className="flex justify-center items-center">
            <button 
              onClick={capture}
              className="w-20 h-20 rounded-full border-4 border-white/30 p-1 flex items-center justify-center hover:border-white transition-all active:scale-95 group"
            >
              <div className="w-full h-full bg-white rounded-full group-hover:scale-90 transition-transform shadow-lg" />
            </button>
          </div>
        ) : viewState === 'selection' ? (
          <div className="flex items-center justify-between gap-4">
             <button 
                onClick={() => { setViewState('camera'); setImage(null); setSelectedIndices(new Set()); }}
                className="flex flex-col items-center gap-1 text-gray-400 hover:text-white transition-colors"
             >
               <RotateCcw size={20} />
               <span className="text-[10px]">Retake</span>
             </button>

             <div className="flex-1 flex justify-center">
               <button 
                 onClick={selectAll}
                 className="px-4 py-2 bg-[#2c2d2e] rounded-full text-xs font-medium text-gray-300 border border-white/10 hover:bg-[#3f4142] transition-colors"
               >
                 {selectedIndices.size === ocrResult.length ? 'Deselect All' : 'Select All'}
               </button>
             </div>

             <button 
                onClick={confirmSelection}
                disabled={selectedIndices.size === 0}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-full font-semibold shadow-lg transition-all active:scale-95 flex items-center gap-2"
             >
               <Check size={18} />
               Done
             </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}