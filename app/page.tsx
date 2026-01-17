'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { 
  Copy, Check, Terminal, Cpu, Sparkles, Plus, MessageSquare, Trash2, LogIn, LogOut, Menu, X, User as UserIcon, 
  Image as ImageIcon, Mic, Volume2, StopCircle, VolumeX, EyeOff, Camera, ScanText
} from 'lucide-react';
import { db, auth } from '@/lib/firebase';
import { signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, deleteDoc, doc, getDocs, writeBatch 
} from 'firebase/firestore';
import Login from '@/components/Login';
import CameraModal from '@/components/CameraModal';

// --- TYPES ---
type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string | null;
  provider?: 'groq' | 'google';
  createdAt?: any;
};

type Session = {
  id: string;
  userId: string;
  title: string;
  createdAt: any;
};

// --- UTILS ---
const sanitizeInput = (str: string) => str.replace(/[<>]/g, '');

// --- COMPONENTS ---
const CodeBlock = ({ language, code }: { language: string, code: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden bg-[#1e1f20] border border-[#2c2d2e] font-mono text-xs md:text-sm shadow-md w-full">
      <div className="flex justify-between items-center bg-[#2c2d2e] px-3 py-1.5 text-gray-300 select-none">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400">{language || 'code'}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white transition-colors">
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="overflow-x-auto w-full">
        <SyntaxHighlighter 
          language={language?.toLowerCase() || 'text'} 
          style={vscDarkPlus} 
          PreTag="div" 
          showLineNumbers={true} 
          wrapLines={true} 
          customStyle={{ margin: 0, padding: '1rem', background: '#1e1f20', fontSize: 'inherit', lineHeight: '1.5' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

const MarkdownRenderer = ({ content, onSpeak }: { content: string, onSpeak: (text: string) => void }) => {
  return (
    <div className="relative group max-w-full overflow-hidden">
      <button 
        onClick={() => onSpeak(content)}
        className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 p-1.5 bg-[#383a3c] rounded-full text-gray-400 hover:text-white transition-all shadow-md z-10"
        title="Read Aloud"
      >
        <Volume2 size={12} />
      </button>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
        code({ node, inline, className, children, ...props }: any) {
          const match = /language-(\w+)/.exec(className || '');
          return !inline && match ? <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} /> : <code className="bg-[#2c2d2e] text-orange-200 px-1 py-0.5 rounded text-xs font-mono border border-white/5 break-words whitespace-pre-wrap" {...props}>{children}</code>;
        },
        p({ children }) { return <p className="mb-3 text-sm md:text-[15px] leading-6 md:leading-7 text-gray-200">{children}</p>; },
        ul({ children }) { return <ul className="list-disc pl-4 mb-3 space-y-1 text-gray-300 text-sm md:text-[15px]">{children}</ul>; },
        ol({ children }) { return <ol className="list-decimal pl-4 mb-3 space-y-1 text-gray-300 text-sm md:text-[15px]">{children}</ol>; },
        h1({ children }) { return <h1 className="text-lg md:text-xl font-bold mb-3 text-white pb-2 border-b border-gray-700">{children}</h1>; },
        h2({ children }) { return <h2 className="text-base md:text-lg font-bold mb-2 text-white mt-4">{children}</h2>; },
        h3({ children }) { return <h3 className="text-sm md:text-base font-bold mb-2 text-white mt-3">{children}</h3>; },
      }}>{content}</ReactMarkdown>
    </div>
  );
};

// --- MAIN APP ---
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Media & Tools
  const [image, setImage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); 
  const [cameraMode, setCameraMode] = useState<'capture' | 'scan' | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null); 

  // Data
  const [groqMessages, setGroqMessages] = useState<Message[]>([]);
  const [googleMessages, setGoogleMessages] = useState<Message[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const groqEndRef = useRef<HTMLDivElement>(null);
  const googleEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // 1. AUTH & INIT
  useEffect(() => {
    if (typeof window !== 'undefined') {
        setSidebarOpen(window.innerWidth >= 1024);
    }

    const unsubAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      
      if (currentUser) {
        const savedSessionId = localStorage.getItem('turboLastSession');
        if (savedSessionId) setCurrentSessionId(savedSessionId);

        const q = query(collection(db, 'sessions'), where('userId', '==', currentUser.uid), orderBy('createdAt', 'desc'));
        const unsubSessions = onSnapshot(q, (snapshot) => {
          setSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Session)));
        });
        return () => unsubSessions();
      } else {
        setSessions([]); setGroqMessages([]); setGoogleMessages([]);
        localStorage.removeItem('turboLastSession');
      }
    });
    return () => unsubAuth();
  }, []);

  // 2. LOAD CHAT
  useEffect(() => {
    if (currentSessionId && user) {
      setGroqMessages([]); setGoogleMessages([]); 
      const qGroq = query(collection(db, 'chats'), where('sessionId', '==', currentSessionId), where('provider', '==', 'groq'), orderBy('createdAt', 'asc'));
      const unsubGroq = onSnapshot(qGroq, (snapshot) => setGroqMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message))));
      const qGoogle = query(collection(db, 'chats'), where('sessionId', '==', currentSessionId), where('provider', '==', 'google'), orderBy('createdAt', 'asc'));
      const unsubGoogle = onSnapshot(qGoogle, (snapshot) => setGoogleMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message))));
      return () => { unsubGroq(); unsubGoogle(); };
    } else {
      setGroqMessages([]); setGoogleMessages([]);
    }
  }, [currentSessionId, user]);

  useEffect(() => { groqEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [groqMessages]);
  useEffect(() => { googleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [googleMessages]);

  // --- ACTIONS ---
  const handleLogout = async () => { await signOut(auth); startNewChat(); };
  
  const startNewChat = () => {
    setCurrentSessionId(null);
    localStorage.removeItem('turboLastSession');
    setGroqMessages([]); setGoogleMessages([]);
    setImage(null);
    stopSpeaking();
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const selectSession = (sessId: string) => {
    setCurrentSessionId(sessId);
    localStorage.setItem('turboLastSession', sessId);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const deleteSession = async (e: React.MouseEvent, sessId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this chat?")) return;
    
    if (currentSessionId === sessId) startNewChat();

    try {
      await deleteDoc(doc(db, 'sessions', sessId));

      const q = query(collection(db, 'chats'), where('sessionId', '==', sessId));
      const snapshot = await getDocs(q);

      const BATCH_SIZE = 450;
      let batch = writeBatch(db);
      let count = 0;

      for (const doc of snapshot.docs) {
        batch.delete(doc.ref);
        count++;

        if (count >= BATCH_SIZE) {
          await batch.commit();
          batch = writeBatch(db); 
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }

    } catch (error) {
      console.error("Error deleting session:", error);
      alert("Failed to delete chat history.");
    }
  };

  // --- MEDIA ---
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) { alert("File too large. Max 5MB."); return; } 
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    if (!('webkitSpeechRecognition' in window)) {
      alert("Voice input requires Chrome/Edge.");
      return;
    }
    const recognition = new (window as any).webkitSpeechRecognition();
    recognitionRef.current = recognition;
    recognition.continuous = false; recognition.interimResults = false; recognition.lang = 'en-US';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
    };
    recognition.start();
  };

  const speakText = (text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => { window.speechSynthesis.cancel(); setIsSpeaking(false); };

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const streamAnswer = async (provider: 'groq' | 'google', currentHistory: Message[], sessId: string, signal: AbortSignal, imgData: string | null) => {
    try {
      const apiHistory = currentHistory.map(({ role, content }) => ({ role, content }));
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiHistory, provider, image: imgData }),
        signal: signal
      });
      if (!response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullResponse = '';
      const tempId = 'temp_' + Date.now();
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        const chunkValue = decoder.decode(value, { stream: true });
        fullResponse += chunkValue;
        const updateState = provider === 'groq' ? setGroqMessages : setGoogleMessages;
        updateState(prev => {
          const newHistory = [...prev];
          const lastMsg = newHistory[newHistory.length - 1];
          if (lastMsg && lastMsg.id === tempId) lastMsg.content = fullResponse;
          else newHistory.push({ id: tempId, role: 'assistant', content: fullResponse, provider });
          return newHistory;
        });
      }
      await addDoc(collection(db, 'chats'), { sessionId: sessId, role: 'assistant', content: fullResponse, provider, createdAt: serverTimestamp() });
      if (isListening) speakText(fullResponse);
    } catch (err: any) { if (err.name !== 'AbortError') console.error(err); }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = sanitizeInput(input); 
    if ((!cleanInput.trim() && !image) || !user) return;
    
    if (loading) stopGenerating();
    stopSpeaking(); 
    setLoading(true);
    setInput('');
    setImage(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      const docRef = await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        title: cleanInput.substring(0, 30) + (cleanInput.length > 30 ? '...' : '') || "Image Query",
        createdAt: serverTimestamp()
      });
      activeSessionId = docRef.id;
      setCurrentSessionId(activeSessionId);
      localStorage.setItem('turboLastSession', activeSessionId);
    }

    const tempId = 'temp_user_' + Date.now();
    const userMsg: Message = { id: tempId, role: 'user', content: cleanInput, image: image, provider: 'google' };

    setGoogleMessages(prev => [...prev, userMsg]);
    setGroqMessages(prev => [...prev, { ...userMsg, provider: 'groq' }]);

    const promises = [
        addDoc(collection(db, 'chats'), { sessionId: activeSessionId, role: 'user', content: cleanInput, image: image, provider: 'google', createdAt: serverTimestamp() }),
        streamAnswer('google', [...googleMessages, userMsg], activeSessionId!, controller.signal, image),
        addDoc(collection(db, 'chats'), { sessionId: activeSessionId, role: 'user', content: cleanInput, provider: 'groq', createdAt: serverTimestamp() }),
        streamAnswer('groq', [...groqMessages, { ...userMsg, provider: 'groq' }], activeSessionId!, controller.signal, image) 
    ];

    await Promise.all(promises);
    setLoading(false);
    abortControllerRef.current = null;
  };

  if (authLoading) return <div className="flex h-[100dvh] items-center justify-center bg-[#131314] text-white"><Cpu size={48} className="text-purple-500 animate-pulse" /></div>;
  if (!user) return <Login />;

  return (
    <div className="flex h-[100dvh] bg-[#131314] text-gray-100 font-sans overflow-hidden">
      
      {/* CAMERA MODAL */}
      {cameraMode && (
        <CameraModal 
          mode={cameraMode}
          onClose={() => setCameraMode(null)}
          onCapture={(imgSrc) => { setImage(imgSrc); setCameraMode(null); }}
          onScan={(text) => { setInput(text); setCameraMode(null); }}
        />
      )}

      {/* MOBILE OVERLAY (Click to close sidebar on mobile) */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-30 lg:hidden backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      {/* - Mobile: 'fixed' + 'translate' animation. 
          - Desktop: 'lg:static' + width transition (shifts main content). 
      */}
      <aside 
        className={`fixed inset-y-0 left-0 z-40 bg-[#1e1f20] border-r border-white/5 flex flex-col transition-all duration-300 ease-in-out
          lg:static lg:z-auto
          ${sidebarOpen ? 'translate-x-0 w-[280px]' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:border-none'} 
          overflow-hidden whitespace-nowrap
        `}
      >
        <div className="p-4 flex flex-col gap-4 min-w-[280px]">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSidebarOpen(false)} 
              className="p-2 text-gray-400 hover:bg-[#333537] hover:text-white rounded-full transition-colors"
              title="Close Menu"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-bold text-gray-200 px-2 lg:block hidden">TurboLearn</span>
          </div>

          <button onClick={startNewChat} className="flex items-center gap-3 px-4 py-3 rounded-full bg-[#1a1b1c] hover:bg-[#333537] transition-all text-sm font-medium text-gray-300 shadow-sm border border-white/5 active:scale-95">
            <Plus size={18} className="text-gray-400" /> New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 min-w-[280px]">
          <div className="text-[10px] font-bold text-gray-500 mb-2 px-3 mt-2 uppercase tracking-widest">History</div>
          <div className="space-y-1">
            {sessions.map((sess) => (
              <div key={sess.id} onClick={() => selectSession(sess.id)}
                className={`group flex items-center justify-between px-3 py-3 rounded-lg cursor-pointer text-sm transition-all ${currentSessionId === sess.id ? 'bg-[#004a77]/40 text-blue-100' : 'text-gray-400 hover:bg-[#282a2c] hover:text-gray-200'}`}>
                <div className="flex items-center gap-3 overflow-hidden">
                  <MessageSquare size={16} className="flex-none opacity-70" />
                  <span className="truncate w-40">{sess.title}</span>
                </div>
                {/* DELETE BUTTON:
                   - opacity-100 (Always visible on mobile/touch)
                   - lg:opacity-0 (Hidden by default on desktop)
                   - lg:group-hover:opacity-100 (Visible on hover on desktop)
                */}
                <button 
                    onClick={(e) => deleteSession(e, sess.id)} 
                    className="opacity-100 lg:opacity-0 lg:group-hover:opacity-100 hover:text-red-400 p-1.5 transition-opacity"
                    title="Delete Chat"
                >
                    <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 mt-auto border-t border-white/5 bg-[#171819] min-w-[280px]">
          <div className="flex items-center gap-3 px-2 py-2 hover:bg-[#2c2d2e] rounded-lg cursor-pointer transition-colors" onClick={handleLogout}>
             {user.photoURL ? <img src={user.photoURL} className="w-8 h-8 rounded-full border border-gray-600" /> : <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center"><UserIcon size={16} /></div>}
             <div className="text-sm font-medium truncate flex-1 text-gray-200">{user.displayName}</div>
             <LogOut size={16} className="text-gray-500" />
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      {/* flex-1 allows it to fill remaining space. Since Sidebar is static on desktop, this container shrinks/grows automatically */}
      <main className="flex-1 flex flex-col h-[100dvh] relative bg-[#131314] w-full min-w-0">
        
        {/* HEADER */}
        <div className="flex-none h-16 flex items-center px-4 z-20 bg-gradient-to-b from-[#131314] via-[#131314]/95 to-transparent backdrop-blur-none">
          {/* Main Menu Button: Hidden on Desktop if sidebar is OPEN (prevents duplicate buttons) */}
          <button 
            onClick={() => setSidebarOpen(true)} 
            className={`p-2 text-gray-400 hover:bg-[#2c2d2e] hover:text-white rounded-full transition-colors mr-3 active:scale-95 ${sidebarOpen ? 'lg:hidden opacity-0 pointer-events-none' : 'opacity-100'}`}
          >
            <Menu size={24} />
          </button>

          {!currentSessionId && groqMessages.length === 0 && <span className="text-base md:text-lg font-medium text-gray-500 mx-auto pointer-events-none tracking-tight">TurboLearn AI</span>}
          
          {isSpeaking && (
            <button onClick={stopSpeaking} className="ml-auto flex items-center gap-2 bg-red-600/90 backdrop-blur-md hover:bg-red-700 text-white px-3 py-1.5 rounded-full shadow-lg transition-all animate-pulse text-xs font-bold z-50">
              <VolumeX size={14} /> <span className="hidden md:inline">Stop</span>
            </button>
          )}
        </div>

        {/* CHAT SCROLL AREA */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 md:p-4 pb-0">
          <div className={`mx-auto grid grid-cols-1 lg:grid-cols-2 gap-4 h-full pb-36 md:pb-40 transition-all duration-300 ${sidebarOpen ? 'max-w-6xl' : 'max-w-7xl'}`}>
            
            {/* GROQ CARD */}
            <div className="flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-lg relative min-h-[250px] lg:min-h-0">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#1e1f20] border-b border-[#2c2d2e] rounded-t-2xl sticky top-0 z-10">
                <Cpu size={16} className="text-orange-400" />
                <span className="font-semibold text-gray-200 text-xs md:text-sm">Llama 3.3 (Fast)</span>
              </div>
              <div className="flex-1 p-3 md:p-4 overflow-y-auto custom-scrollbar">
                {!currentSessionId && groqMessages.length === 0 && <div className="h-40 md:h-full flex items-center justify-center text-gray-700 opacity-30"><Cpu size={40} /></div>}
                {groqMessages.map((m, i) => (
                  <div key={i} className={`mb-4 md:mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[95%] md:max-w-[90%] ${m.role === 'user' ? 'bg-[#2c2d2e] px-3 py-2 md:px-4 md:py-2.5 rounded-2xl' : ''}`}>
                      <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                          {m.role === 'user' ? <p>{m.content}</p> : <MarkdownRenderer content={m.content} onSpeak={speakText} />}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={groqEndRef} />
              </div>
            </div>

            {/* GEMINI CARD */}
            <div className="flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-lg min-h-[250px] lg:min-h-0">
              <div className="flex items-center gap-2 px-4 py-3 bg-[#1e1f20] border-b border-[#2c2d2e] rounded-t-2xl sticky top-0 z-10">
                <Sparkles size={16} className="text-blue-400" />
                <span className="font-semibold text-gray-200 text-xs md:text-sm">Gemini 2.5 (Vision)</span>
              </div>
              <div className="flex-1 p-3 md:p-4 overflow-y-auto custom-scrollbar">
                {!currentSessionId && googleMessages.length === 0 && <div className="h-40 md:h-full flex items-center justify-center text-gray-700 opacity-30"><Sparkles size={40} /></div>}
                {googleMessages.map((m, i) => (
                  <div key={i} className={`mb-4 md:mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[95%] md:max-w-[90%] ${m.role === 'user' ? 'bg-[#2c2d2e] px-3 py-2 md:px-4 md:py-2.5 rounded-2xl' : ''}`}>
                       {m.image && (<div className="mb-2"><img src={m.image} alt="Upload" className="max-h-40 md:max-h-48 rounded-lg border border-[#3c3d3e] object-contain bg-black/50" /></div>)}
                       <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                         {m.role === 'user' ? <p>{m.content}</p> : <MarkdownRenderer content={m.content} onSpeak={speakText} />}
                      </div>
                    </div>
                  </div>
                ))}
                <div ref={googleEndRef} />
              </div>
            </div>
          </div>
        </div>

        {/* INPUT AREA (Fixed Bottom) */}
        <div className="flex-none p-3 md:p-6 bg-[#131314] pb-[calc(env(safe-area-inset-bottom)+12px)] absolute bottom-0 w-full z-20">
          <div className={`mx-auto relative transition-all duration-300 ${sidebarOpen ? 'max-w-4xl' : 'max-w-5xl'}`}>
            {image && (
              <div className="absolute -top-14 left-0 bg-[#1e1f20] p-1.5 rounded-lg border border-[#2c2d2e] flex items-center gap-2 shadow-xl animate-in slide-in-from-bottom-2">
                <img src={image} alt="Preview" className="h-10 w-10 object-cover rounded" />
                <button onClick={() => setImage(null)} className="p-1 hover:text-red-400 text-gray-400"><X size={14}/></button>
              </div>
            )}
            <form onSubmit={handleSearch} className="relative group">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening..." : "Ask anything or scan..."}
                className={`w-full bg-[#1e1f20] text-gray-100 placeholder-gray-500 rounded-full py-3.5 pl-32 pr-28 focus:outline-none focus:bg-[#262729] focus:ring-1 focus:ring-white/10 transition-all text-[15px] border border-[#2c2d2e] shadow-lg ${isListening ? 'border-red-500/50 bg-red-500/5' : ''}`}
                style={{ fontSize: '16px' }} 
              />
              
              {/* LEFT ACTIONS (Media) */}
              <div className="absolute left-2 top-1.5 bottom-1.5 flex items-center gap-0.5">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="p-2 text-gray-400 hover:text-white rounded-full transition-colors active:bg-white/10" title="Upload Image"><ImageIcon size={20} /></button>
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
                <button type="button" onClick={() => setCameraMode('capture')} className="p-2 text-gray-400 hover:text-blue-400 rounded-full transition-colors active:bg-white/10" title="Take Photo"><Camera size={20} /></button>
                <button type="button" onClick={() => setCameraMode('scan')} className="p-2 text-gray-400 hover:text-green-400 rounded-full transition-colors active:bg-white/10" title="Scan Text (Lens)"><ScanText size={20} /></button>
              </div>

              {/* RIGHT ACTIONS (Voice/Send) */}
              <div className="absolute right-2 top-1.5 bottom-1.5 flex items-center gap-1">
                <button type="button" onClick={toggleVoiceInput} className={`p-2 rounded-full transition-all active:scale-90 ${isListening ? 'text-red-500 bg-red-500/10' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
                  <Mic size={20} />
                </button>
                <button 
                  type={loading ? 'button' : 'submit'} 
                  onClick={loading ? stopGenerating : undefined} 
                  className={`p-2 rounded-full transition-all active:scale-90 ${loading ? 'bg-white text-black' : 'bg-[#3c3d3e] text-white disabled:opacity-50 disabled:bg-transparent'}`} 
                  disabled={(!input.trim() && !image) && !loading}
                >
                  {loading ? <StopCircle size={20} fill="black" /> : <Terminal size={20} />}
                </button>
              </div>
            </form>
            <p className="text-center text-[10px] text-gray-600 mt-2 hidden md:block">TurboLearn AI • Gemini 2.5 Flash • Llama 3.3</p>
          </div>
        </div>
      </main>
    </div>
  );
}