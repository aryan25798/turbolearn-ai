'use client';

import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math'; 
import rehypeKatex from 'rehype-katex'; 
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import 'katex/dist/katex.min.css'; 

import { 
  Copy, Check, Terminal, Cpu, Sparkles, Plus, Trash2, LogOut, Menu, X, User as UserIcon, 
  Mic, Volume2, StopCircle, VolumeX, Camera, ScanText, Maximize2, Minimize2, ArrowLeft, Shield,
  Clock, ShieldAlert, History, Brain 
} from 'lucide-react';
import { db, auth, storage } from '@/lib/firebase';
import { signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, getDoc, setDoc, updateDoc, Unsubscribe, limit
} from 'firebase/firestore';
import { ref, uploadString } from 'firebase/storage';
import Login from '@/components/Login';
import CameraModal from '@/components/CameraModal';

// --- TYPES ---
type Message = {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  image?: string | null;
  provider?: 'groq' | 'google' | 'deepseek'; 
  createdAt?: any;
};

type Session = {
  id: string;
  userId: string;
  title: string;
  createdAt: any;
  deletedByUser?: boolean;
};

type UserStatus = 'loading' | 'approved' | 'pending' | 'banned' | 'new';

// --- UTILS ---
const sanitizeInput = (str: string) => str.replace(/[<>]/g, '');

// --- COMPONENTS ---

// 1. Code Block with Copy Feature
const CodeBlock = ({ language, code }: { language: string, code: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-4 rounded-xl overflow-hidden bg-[#1e1f20] border border-[#2c2d2e] shadow-lg w-full group">
      <div className="flex justify-between items-center bg-[#262729] px-4 py-2 border-b border-[#2c2d2e] select-none">
        <span className="text-[11px] uppercase tracking-wider font-bold text-gray-400 font-mono">{language || 'text'}</span>
        <button onClick={handleCopy} className="flex items-center gap-1.5 text-[11px] font-medium text-gray-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-2 py-1 rounded-md">
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <div className="overflow-x-auto w-full custom-scrollbar">
        <SyntaxHighlighter 
          language={language?.toLowerCase() || 'text'} 
          style={vscDarkPlus} 
          PreTag="div" 
          showLineNumbers={true} 
          wrapLines={true} 
          customStyle={{ margin: 0, padding: '1rem', background: '#1e1f20', fontSize: '13px', lineHeight: '1.6' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

// 2. Markdown Renderer
const MarkdownRenderer = ({ 
  content, 
  msgId, 
  isSpeaking, 
  onToggleSpeak 
}: { 
  content: string, 
  msgId: string, 
  isSpeaking: boolean, 
  onToggleSpeak: (text: string, id: string) => void 
}) => {
  return (
    <div className="relative group max-w-full">
      <button 
        onClick={() => onToggleSpeak(content, msgId)}
        className={`absolute top-0 right-0 p-2 rounded-lg transition-all duration-200 z-10
          ${isSpeaking 
            ? 'bg-red-500/10 text-red-400 opacity-100 ring-1 ring-red-500/50' 
            : 'text-gray-400 hover:text-white hover:bg-white/10 opacity-0 group-hover:opacity-100 focus:opacity-100 active:opacity-100 mobile-visible'
          }`}
        title={isSpeaking ? "Stop Reading" : "Read Aloud"}
      >
        {isSpeaking ? <StopCircle size={16} className="animate-pulse" /> : <Volume2 size={16} />}
      </button>

      <div className="pr-8 overflow-hidden">
        <ReactMarkdown 
          remarkPlugins={[remarkGfm, remarkMath]} 
          rehypePlugins={[rehypeKatex]} 
          components={{
            code({ node, inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '');
              return !inline && match ? 
                <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} /> : 
                <code className="bg-[#2c2d2e] text-orange-200 px-1.5 py-0.5 rounded-md text-[13px] font-mono border border-white/5 break-words whitespace-pre-wrap" {...props}>{children}</code>;
            },
            p({ children }) { return <p className="mb-4 text-[14px] md:text-[15px] leading-7 text-gray-200">{children}</p>; },
            ul({ children }) { return <ul className="list-disc pl-5 mb-4 space-y-2 text-gray-300 text-[14px] md:text-[15px] marker:text-gray-500">{children}</ul>; },
            ol({ children }) { return <ol className="list-decimal pl-5 mb-4 space-y-2 text-gray-300 text-[14px] md:text-[15px] marker:text-gray-500">{children}</ol>; },
            h1({ children }) { return <h1 className="text-xl md:text-2xl font-bold mb-4 text-white pb-2 border-b border-gray-700/50">{children}</h1>; },
            h2({ children }) { return <h2 className="text-lg md:text-xl font-bold mb-3 text-white mt-6">{children}</h2>; },
            h3({ children }) { return <h3 className="text-base md:text-lg font-bold mb-2 text-white mt-4">{children}</h3>; },
            a({ children, href }) { return <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline underline-offset-4 decoration-blue-400/30 hover:decoration-blue-400 transition-all break-all">{children}</a>; },
            blockquote({ children }) { return <blockquote className="border-l-4 border-blue-500/30 pl-4 py-1 my-4 bg-blue-500/5 rounded-r-lg italic text-gray-400">{children}</blockquote>; },
            table({ children }) { return <div className="overflow-x-auto my-4 rounded-lg border border-gray-700/50 custom-scrollbar"><table className="min-w-full text-left text-sm text-gray-300">{children}</table></div>; },
            th({ children }) { return <th className="bg-[#262729] p-3 font-semibold text-white border-b border-gray-700 whitespace-nowrap">{children}</th>; },
            td({ children }) { return <td className="p-3 border-b border-gray-700/50 min-w-[120px]">{children}</td>; },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
};

// 3. Status Screens
const StatusScreen = ({ icon, title, description, subtext, color }: any) => (
  <div className="flex h-[100dvh] w-full items-center justify-center bg-[#050505] p-6 text-center animate-in fade-in zoom-in duration-500">
    <div className="max-w-md w-full bg-[#0c0c0e] border border-white/10 rounded-2xl p-8 shadow-2xl flex flex-col items-center">
      <div className={`w-20 h-20 rounded-full bg-${color}-500/10 flex items-center justify-center mb-6 border border-${color}-500/20`}>
        {icon}
      </div>
      <h2 className="text-2xl font-bold text-white mb-3">{title}</h2>
      <p className="text-gray-400 text-sm leading-relaxed mb-6">{description}</p>
      
      <div className="w-full bg-[#111] rounded-lg p-3 border border-white/5 mb-6">
         <div className="flex items-center gap-2 justify-center mb-1">
            <div className={`w-2 h-2 rounded-full bg-${color}-500 animate-pulse`} />
            <span className={`text-xs font-bold uppercase tracking-widest text-${color}-400`}>Live Status</span>
         </div>
         <p className="text-[10px] text-gray-500">{subtext}</p>
      </div>

      <button onClick={() => signOut(auth)} className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 hover:text-white text-sm font-medium transition-all">
        <LogOut size={16} /> Sign Out
      </button>
    </div>
  </div>
);

// --- MAIN APP ---
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountStatus, setAccountStatus] = useState<UserStatus>('loading');
  
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Focus Mode State
  const [focusedProvider, setFocusedProvider] = useState<'groq' | 'google' | 'deepseek' | null>(null);

  // User Role State
  const [userRole, setUserRole] = useState<'user' | 'admin' | null>(null);

  // Media & Tools
  const [image, setImage] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); 
  const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);

  const [cameraMode, setCameraMode] = useState<'capture' | 'scan' | null>(null);

  // 🔴 Maintenance State
  const [deepseekError, setDeepseekError] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null); 

  // Data
  const [groqMessages, setGroqMessages] = useState<Message[]>([]);
  const [googleMessages, setGoogleMessages] = useState<Message[]>([]);
  const [deepseekMessages, setDeepseekMessages] = useState<Message[]>([]);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const groqEndRef = useRef<HTMLDivElement>(null);
  const googleEndRef = useRef<HTMLDivElement>(null);
  const deepseekEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const unsubUserRef = useRef<Unsubscribe | null>(null);
  const unsubSessionsRef = useRef<Unsubscribe | null>(null);

  // 1. AUTH & INIT
  useEffect(() => {
    if (typeof window !== 'undefined') {
        setSidebarOpen(window.innerWidth >= 1024); 
    }

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubUserRef.current) { unsubUserRef.current(); unsubUserRef.current = null; }
      if (unsubSessionsRef.current) { unsubSessionsRef.current(); unsubSessionsRef.current = null; }

      if (currentUser) {
        setUser(currentUser);
        const userRef = doc(db, 'users', currentUser.uid);
        
        try {
            const docSnap = await getDoc(userRef);
            if (!docSnap.exists()) {
                await setDoc(userRef, {
                    uid: currentUser.uid,
                    email: currentUser.email,
                    displayName: currentUser.displayName || 'User',
                    photoURL: currentUser.photoURL,
                    role: 'user', 
                    status: 'pending', 
                    createdAt: serverTimestamp(),
                    lastLogin: serverTimestamp()
                });
            } else {
                await updateDoc(userRef, { lastLogin: serverTimestamp() });
            }
        } catch (err) {
            console.error("Error creating/updating user profile:", err);
        }

        const unsubUser = onSnapshot(userRef, (docSnap) => {
             const data = docSnap.data();
             if (data) {
                 setUserRole(data.role);
                 if (data.role === 'admin') {
                     setAccountStatus('approved');
                 } else {
                     setAccountStatus(data.status as UserStatus);
                 }
             }
             setAuthLoading(false);
        });
        unsubUserRef.current = unsubUser;

        // --- PERSIST CHAT ON REFRESH ---
        const savedSessionId = localStorage.getItem('turboLastSession');
        if (savedSessionId) setCurrentSessionId(savedSessionId);

        const q = query(
            collection(db, 'sessions'), 
            where('userId', '==', currentUser.uid), 
            orderBy('createdAt', 'desc'),
            limit(50) 
        );

        const unsubSessions = onSnapshot(q, (snapshot) => {
          const fetchedSessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Session));
          setSessions(fetchedSessions.filter(s => !s.deletedByUser));
        });
        unsubSessionsRef.current = unsubSessions;

      } else {
        setSessions([]); setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
        localStorage.removeItem('turboLastSession');
        setUser(null);
        setAccountStatus('loading'); 
        setAuthLoading(false);
      }
    });

    return () => {
        unsubAuth();
        if (unsubUserRef.current) unsubUserRef.current();
        if (unsubSessionsRef.current) unsubSessionsRef.current();
    };
  }, []);

  // 2. LOAD CHAT
  useEffect(() => {
    if (currentSessionId && user && accountStatus === 'approved') {
      setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
      setDeepseekError(false); // Reset error on load
      
      const qGroq = query(collection(db, 'chats'), where('sessionId', '==', currentSessionId), where('provider', '==', 'groq'), orderBy('createdAt', 'asc'));
      const unsubGroq = onSnapshot(qGroq, (snapshot) => setGroqMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message))));
      
      const qGoogle = query(collection(db, 'chats'), where('sessionId', '==', currentSessionId), where('provider', '==', 'google'), orderBy('createdAt', 'asc'));
      const unsubGoogle = onSnapshot(qGoogle, (snapshot) => setGoogleMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message))));

      // 👈 Load DeepSeek Messages
      const qDeepseek = query(collection(db, 'chats'), where('sessionId', '==', currentSessionId), where('provider', '==', 'deepseek'), orderBy('createdAt', 'asc'));
      const unsubDeepseek = onSnapshot(qDeepseek, (snapshot) => setDeepseekMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Message))));

      return () => { unsubGroq(); unsubGoogle(); unsubDeepseek(); };
    } else {
      setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
      setDeepseekError(false);
    }
  }, [currentSessionId, user, accountStatus]);

  useEffect(() => { 
      if (!focusedProvider || focusedProvider === 'groq') groqEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [groqMessages, focusedProvider]);
  
  useEffect(() => { 
      if (!focusedProvider || focusedProvider === 'google') googleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [googleMessages, focusedProvider]);

  // 👈 DeepSeek Scroll
  useEffect(() => { 
      if (!focusedProvider || focusedProvider === 'deepseek') deepseekEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [deepseekMessages, focusedProvider]);

  // --- ACTIONS ---
  const handleLogout = async () => { 
      if (unsubUserRef.current) { unsubUserRef.current(); unsubUserRef.current = null; }
      if (unsubSessionsRef.current) { unsubSessionsRef.current(); unsubSessionsRef.current = null; }
      await signOut(auth); 
      startNewChat(); 
  };
  
  const startNewChat = () => {
    setCurrentSessionId(null);
    localStorage.removeItem('turboLastSession');
    setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
    setDeepseekError(false); // ✅ Reset error
    setImage(null);
    stopSpeaking();
    setFocusedProvider(null);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const selectSession = (sessId: string) => {
    setCurrentSessionId(sessId);
    setDeepseekError(false); // ✅ Reset error
    localStorage.setItem('turboLastSession', sessId);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const deleteSession = async (e: React.MouseEvent, sessId: string) => {
    e.stopPropagation();
    if (!confirm("Delete this chat from history?")) return;
    if (currentSessionId === sessId) startNewChat();

    try {
      await updateDoc(doc(db, 'sessions', sessId), { deletedByUser: true });
    } catch (error) {
      console.error("Error deleting session:", error);
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

  const toggleSpeak = (text: string, msgId: string) => {
    if (isSpeaking && speakingMessageId === msgId) {
        stopSpeaking();
        return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha'));
    if (preferredVoice) utterance.voice = preferredVoice;

    utterance.onstart = () => { setIsSpeaking(true); setSpeakingMessageId(msgId); };
    utterance.onend = () => { setIsSpeaking(false); setSpeakingMessageId(null); };
    utterance.onerror = () => { setIsSpeaking(false); setSpeakingMessageId(null); };
    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => { 
      window.speechSynthesis.cancel(); 
      setIsSpeaking(false); 
      setSpeakingMessageId(null);
  };

  const stopGenerating = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setLoading(false);
    }
  };

  const streamAnswer = async (provider: 'groq' | 'google' | 'deepseek', currentHistory: Message[], sessId: string, signal: AbortSignal, imgData: string | null) => {
    try {
      const apiHistory = currentHistory.map(({ role, content }) => ({ role, content }));
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            messages: apiHistory, 
            provider, 
            image: imgData,
            userId: user?.uid 
        }),
        signal: signal
      });

      // 🛑 HANDLE MAINTENANCE / ERRORS (Visual Indicator Logic)
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); 
        
        // Check for specific Maintenance Code or 503
        if (response.status === 503 || errorData.code === 'DEEPSEEK_MAINTENANCE') {
           if (provider === 'deepseek') {
               setDeepseekError(true); // ✅ Activate visual maintenance mode
           }
           return; // Stop execution, do not add text message
        }
      }

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
        
        // 👈 Update correct state based on provider
        let updateState;
        if (provider === 'groq') updateState = setGroqMessages;
        else if (provider === 'google') updateState = setGoogleMessages;
        else updateState = setDeepseekMessages;

        updateState(prev => {
          const newHistory = [...prev];
          const lastMsg = newHistory[newHistory.length - 1];
          if (lastMsg && lastMsg.id === tempId) lastMsg.content = fullResponse;
          else newHistory.push({ id: tempId, role: 'assistant', content: fullResponse, provider });
          return newHistory;
        });
      }

      // "Fire and Forget" saving
      addDoc(collection(db, 'chats'), { 
          sessionId: sessId, 
          role: 'assistant', 
          content: fullResponse, 
          provider, 
          createdAt: serverTimestamp() 
      }).catch(e => console.error("Error saving chat:", e));

    } catch (err: any) { 
        if (err.name !== 'AbortError') console.error(err); 
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanInput = sanitizeInput(input); 
    if ((!cleanInput.trim() && !image) || !user) return;
    
    if (loading) stopGenerating();
    stopSpeaking(); 
    setLoading(true);
    setInput('');
    setDeepseekError(false); // ✅ Reset maintenance state on new query
    
    const localImageBase64 = image; 
    setImage(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let activeSessionId = currentSessionId;
    if (!activeSessionId) {
      const docRef = await addDoc(collection(db, 'sessions'), {
        userId: user.uid,
        title: cleanInput.substring(0, 30) + (cleanInput.length > 30 ? '...' : '') || "Image Query",
        createdAt: serverTimestamp(),
        deletedByUser: false
      });
      activeSessionId = docRef.id;
      setCurrentSessionId(activeSessionId);
      localStorage.setItem('turboLastSession', activeSessionId);
    }

    const tempId = 'temp_user_' + Date.now();
    const userMsg: Message = { id: tempId, role: 'user', content: cleanInput, image: localImageBase64, provider: 'google' };

    // --- 1. LOCAL UI UPDATES ---
    // If Image -> Only Update Google
    // If Text -> Update All 3 (unless one is focused)
    
    // Google (Always gets it)
    if (!focusedProvider || focusedProvider === 'google') setGoogleMessages(prev => [...prev, userMsg]);
    
    // Groq & DeepSeek (Only if NO Image)
    if (!localImageBase64) {
        if (!focusedProvider || focusedProvider === 'groq') {
            setGroqMessages(prev => [...prev, { ...userMsg, provider: 'groq' }]);
        }
        if (!focusedProvider || focusedProvider === 'deepseek') {
            setDeepseekMessages(prev => [...prev, { ...userMsg, provider: 'deepseek' }]);
        }
    }

    // Fire and forget image upload
    if (localImageBase64) {
      const storageRef = ref(storage, `chat-images/${user.uid}/${activeSessionId}/${Date.now()}.jpg`);
      uploadString(storageRef, localImageBase64, 'data_url').catch(err => console.error("Image upload failed:", err));
    }

    const promises = [];

    // --- 2. FIRESTORE SAVES & STREAMS ---
    
    // Save Google User Msg & Start Stream (Always)
    addDoc(collection(db, 'chats'), { 
        sessionId: activeSessionId, role: 'user', content: cleanInput, image: null, provider: 'google', createdAt: serverTimestamp() 
    });
    // If image exists, auto-focus Google if focused on something else that can't handle images
    if (localImageBase64 && (focusedProvider === 'groq' || focusedProvider === 'deepseek')) {
        setFocusedProvider('google');
    }
    // Google Stream (Sends Image if exists)
    if (localImageBase64 || !focusedProvider || focusedProvider === 'google') {
        promises.push(streamAnswer('google', [...googleMessages, userMsg], activeSessionId!, controller.signal, localImageBase64));
    }

    // Groq & DeepSeek Logic (SKIP IF IMAGE EXISTS)
    if (!localImageBase64) {
        // Groq
        if (!focusedProvider || focusedProvider === 'groq') {
            addDoc(collection(db, 'chats'), { sessionId: activeSessionId, role: 'user', content: cleanInput, provider: 'groq', createdAt: serverTimestamp() });
            promises.push(streamAnswer('groq', [...groqMessages, { ...userMsg, provider: 'groq' }], activeSessionId!, controller.signal, null));
        }
        // DeepSeek
        if (!focusedProvider || focusedProvider === 'deepseek') {
            addDoc(collection(db, 'chats'), { sessionId: activeSessionId, role: 'user', content: cleanInput, provider: 'deepseek', createdAt: serverTimestamp() });
            promises.push(streamAnswer('deepseek', [...deepseekMessages, { ...userMsg, provider: 'deepseek' }], activeSessionId!, controller.signal, null));
        }
    }

    try {
        await Promise.all(promises);
    } catch (err) {
        console.error("Stream error", err);
    } finally {
        setLoading(false); 
        abortControllerRef.current = null;
    }
  };

  // --- RENDER LOGIC ---

  if (authLoading) return <div className="flex h-[100dvh] items-center justify-center bg-[#131314] text-white"><Cpu size={48} className="text-purple-500 animate-pulse" /></div>;
  if (!user) return <Login />;

  if (accountStatus === 'banned') return <StatusScreen color="red" icon={<ShieldAlert size={40} className="text-red-500" />} title="Access Revoked" description="Your account has been flagged and banned." subtext="You are currently locked out." />;
  if (accountStatus === 'pending') return <StatusScreen color="yellow" icon={<Clock size={40} className="text-yellow-500 animate-pulse" />} title="Verification Pending" description="Your account is waiting for approval." subtext="Wait here. This page will unlock automatically." />;

  return (
    <div className="flex h-[100dvh] bg-[#131314] text-gray-100 font-sans overflow-hidden selection:bg-purple-500/30 selection:text-white relative">
      
      {/* CAMERA MODAL */}
      {cameraMode && (
        <CameraModal 
          mode={cameraMode}
          onClose={() => setCameraMode(null)}
          onCapture={(imgSrc) => { setImage(imgSrc); setCameraMode(null); }}
          onScan={(text) => { setInput(text); setCameraMode(null); }}
        />
      )}

      {/* MOBILE OVERLAY (BACKDROP) */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-[#1e1f20] border-r border-white/5 transition-all duration-300 ease-in-out shadow-2xl
          ${sidebarOpen ? 'translate-x-0 w-[280px]' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:border-none lg:overflow-hidden'}
        `}
      >
        <div className="p-4 flex flex-col gap-4 min-w-[280px]">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setSidebarOpen(false)} 
              className="p-2 text-gray-400 hover:bg-[#333537] hover:text-white rounded-full transition-colors active:scale-95"
              title="Close Menu"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-bold text-gray-200 px-2 tracking-wide">TurboLearn</span>
          </div>

          {userRole === 'admin' && (
             <button 
               onClick={() => window.location.href='/admin'} 
               className="flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-red-900/20 text-red-400 border border-red-500/20 hover:bg-red-900/30 transition-all text-xs font-bold uppercase tracking-widest shadow-lg shadow-red-900/10 mb-1"
             >
               <Shield size={14} /> Admin Portal
             </button>
          )}

          <button onClick={startNewChat} className="flex items-center gap-3 px-4 py-3 rounded-full bg-[#1a1b1c] hover:bg-[#333537] transition-all text-sm font-medium text-gray-200 border border-white/5 active:scale-95 shadow-sm">
            <Plus size={18} className="text-gray-400" /> <span className="font-medium text-sm">New chat</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 min-w-[280px]">
          <div className="text-[11px] font-bold text-gray-500 mb-2 px-3 mt-2 uppercase tracking-widest flex items-center gap-2">
             <History size={12} /> Recent
          </div>
          <div className="space-y-1">
            {sessions.map((sess) => (
              <div key={sess.id} onClick={() => selectSession(sess.id)}
                className={`group flex items-center justify-between px-3 py-2 rounded-full cursor-pointer text-sm transition-all border border-transparent ${currentSessionId === sess.id ? 'bg-[#004a77]/40 text-blue-100 font-medium' : 'text-gray-400 hover:bg-[#282a2c] hover:text-gray-200'}`}>
                <span className="truncate w-44 text-[13px]">{sess.title}</span>
                {/* ✅ MOBILE FIX: Always visible on mobile (opacity-100), hover on desktop */}
                <button 
                    onClick={(e) => deleteSession(e, sess.id)} 
                    className="text-gray-500 hover:text-red-400 p-2 transition-colors opacity-100 lg:opacity-0 lg:group-hover:opacity-100"
                    title="Delete Chat"
                >
                    <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 mt-auto border-t border-white/5 bg-[#171819] min-w-[280px]">
          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#2c2d2e] rounded-xl cursor-pointer transition-colors group" onClick={handleLogout}>
              {user.photoURL ? <img src={user.photoURL} className="w-8 h-8 rounded-full border border-gray-600 group-hover:border-gray-400 transition-colors" /> : <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center"><UserIcon size={16} /></div>}
              <div className="text-sm font-medium truncate flex-1 text-gray-200">{user.displayName}</div>
              <LogOut size={16} className="text-gray-500 group-hover:text-gray-300 transition-colors" />
          </div>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      {/* ✅ FLEX LAYOUT: Solves overlap issues */}
      <main className="flex-1 flex flex-col h-[100dvh] relative bg-[#131314] w-full min-w-0 transition-all duration-300">
        
        {/* HEADER */}
        <div className="flex-none h-16 flex items-center px-4 z-40 bg-transparent justify-between relative">
          <div className={`flex items-center transition-opacity duration-300 ${sidebarOpen ? 'lg:opacity-0 pointer-events-none' : 'opacity-100'}`}>
             <button 
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-400 hover:bg-[#2c2d2e]/80 hover:text-white rounded-full transition-colors active:scale-95 pointer-events-auto"
            >
              <Menu size={24} />
            </button>
          </div>

          {/* ✅ STYLISH TITLE in Empty Header Space */}
          <div className="absolute left-1/2 transform -translate-x-1/2 font-bold text-lg md:text-2xl tracking-tighter bg-gradient-to-r from-blue-400 via-purple-400 to-orange-400 bg-clip-text text-transparent select-none pointer-events-none">
            TurboLearn AI
          </div>

          <div className="flex items-center">
            {isSpeaking && (
                <button onClick={stopSpeaking} className="flex items-center gap-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 backdrop-blur-md text-red-400 px-4 py-1.5 rounded-full shadow-lg transition-all animate-pulse text-xs font-bold z-50 pointer-events-auto">
                <VolumeX size={14} /> <span className="hidden md:inline">Stop</span>
                </button>
            )}
          </div>
        </div>

        {/* CHAT SCROLL AREA - Grows to fill remaining space */}
        <div className="flex-1 min-h-0 overflow-hidden p-2 md:p-4 pb-0 pt-0 flex flex-col relative z-0">
          <div className={`w-full h-full max-w-[1800px] mx-auto transition-all duration-300 
             ${focusedProvider ? 'max-w-4xl' : 'flex flex-col lg:grid lg:grid-cols-3 gap-2 lg:gap-6'} 
          `}>
            
            {/* GROQ CARD */}
            {(!focusedProvider || focusedProvider === 'groq') && (
              <div className={`flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-xl relative overflow-hidden transition-all duration-300
                ${focusedProvider === 'groq' ? 'h-full border-orange-500/30 shadow-[0_0_50px_rgba(249,115,22,0.1)]' : 'flex-1 min-h-0'} 
              `}>
                <div className="flex items-center justify-between px-4 py-3 bg-[#1e1f20]/95 backdrop-blur-sm border-b border-[#2c2d2e] sticky top-0 z-10">
                  <div className="flex items-center gap-2">
                    {focusedProvider === 'groq' && <button onClick={() => setFocusedProvider(null)}><ArrowLeft size={18} className="text-gray-400 hover:text-white mr-2" /></button>}
                    <Cpu size={16} className="text-orange-400" />
                    <span className="font-semibold text-gray-200 text-xs md:text-sm tracking-wide">Llama 3.3 (Reasoning)</span>
                  </div>
                  <button 
                    onClick={() => setFocusedProvider(focusedProvider === 'groq' ? null : 'groq')}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={focusedProvider === 'groq' ? "Minimize" : "Focus Mode"}
                  >
                    {focusedProvider === 'groq' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
                <div className="flex-1 p-3 md:p-5 overflow-y-auto custom-scrollbar pb-5">
                  {!currentSessionId && groqMessages.length === 0 && <div className="h-full flex flex-col gap-2 items-center justify-center text-gray-700 opacity-40"><Cpu size={48} /><span className="text-xs font-medium">Ready</span></div>}
                  {groqMessages.map((m, i) => (
                    <div key={i} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[95%] md:max-w-[90%] ${m.role === 'user' ? 'bg-[#2c2d2e] px-4 py-3 rounded-2xl rounded-tr-none' : ''}`}>
                        <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                            {m.role === 'user' ? <p>{m.content}</p> : <MarkdownRenderer content={m.content} msgId={m.id || `groq-${i}`} isSpeaking={speakingMessageId === (m.id || `groq-${i}`)} onToggleSpeak={toggleSpeak} />}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={groqEndRef} />
                </div>
              </div>
            )}

            {/* GEMINI CARD */}
            {(!focusedProvider || focusedProvider === 'google') && (
              <div className={`flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-xl overflow-hidden transition-all duration-300
                ${focusedProvider === 'google' ? 'h-full border-blue-500/30 shadow-[0_0_50px_rgba(59,130,246,0.1)]' : 'flex-1 min-h-0'}
              `}>
                <div className="flex items-center justify-between px-4 py-3 bg-[#1e1f20]/95 backdrop-blur-sm border-b border-[#2c2d2e] sticky top-0 z-10">
                  <div className="flex items-center gap-2">
                    {focusedProvider === 'google' && <button onClick={() => setFocusedProvider(null)}><ArrowLeft size={18} className="text-gray-400 hover:text-white mr-2" /></button>}
                    <Sparkles size={16} className="text-blue-400" />
                    <span className="font-semibold text-gray-200 text-xs md:text-sm tracking-wide">Gemini 2.5 (Vision)</span>
                  </div>
                  <button 
                    onClick={() => setFocusedProvider(focusedProvider === 'google' ? null : 'google')}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={focusedProvider === 'google' ? "Minimize" : "Focus Mode"}
                  >
                    {focusedProvider === 'google' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
                <div className="flex-1 p-3 md:p-5 overflow-y-auto custom-scrollbar pb-5">
                  {!currentSessionId && googleMessages.length === 0 && <div className="h-full flex flex-col gap-2 items-center justify-center text-gray-700 opacity-40"><Sparkles size={48} /><span className="text-xs font-medium">Ready</span></div>}
                  {googleMessages.map((m, i) => (
                    <div key={i} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[95%] md:max-w-[90%] ${m.role === 'user' ? 'bg-[#2c2d2e] px-4 py-3 rounded-2xl rounded-tr-none' : ''}`}>
                         {m.image && (<div className="mb-3"><img src={m.image} alt="Upload" className="max-h-48 rounded-lg border border-[#3c3d3e] object-contain bg-black/50" /></div>)}
                         <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                           {m.role === 'user' ? <p>{m.content}</p> : <MarkdownRenderer content={m.content} msgId={m.id || `google-${i}`} isSpeaking={speakingMessageId === (m.id || `google-${i}`)} onToggleSpeak={toggleSpeak} />}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={googleEndRef} />
                </div>
              </div>
            )}

            {/* DEEPSEEK CARD (UPDATED with UI Alert) */}
            {(!focusedProvider || focusedProvider === 'deepseek') && (
              <div className={`flex flex-col rounded-2xl bg-[#1e1f20] border border-[#2c2d2e] shadow-xl overflow-hidden transition-all duration-300
                ${focusedProvider === 'deepseek' ? 'h-full border-purple-500/30 shadow-[0_0_50px_rgba(168,85,247,0.1)]' : 'flex-1 min-h-0'}
              `}>
                <div className="flex items-center justify-between px-4 py-3 bg-[#1e1f20]/95 backdrop-blur-sm border-b border-[#2c2d2e] sticky top-0 z-10">
                  <div className="flex items-center gap-2">
                    {focusedProvider === 'deepseek' && <button onClick={() => setFocusedProvider(null)}><ArrowLeft size={18} className="text-gray-400 hover:text-white mr-2" /></button>}
                    <Brain size={16} className="text-purple-400" />
                    <span className="font-semibold text-gray-200 text-xs md:text-sm tracking-wide">DeepSeek R1 (Reasoning)</span>
                  </div>
                  <button 
                    onClick={() => setFocusedProvider(focusedProvider === 'deepseek' ? null : 'deepseek')}
                    className="p-1.5 text-gray-500 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                    title={focusedProvider === 'deepseek' ? "Minimize" : "Focus Mode"}
                  >
                    {focusedProvider === 'deepseek' ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                  </button>
                </div>
                <div className="flex-1 p-3 md:p-5 overflow-y-auto custom-scrollbar pb-5 relative">
                  {/* Ready State (Only if no messages AND no error) */}
                  {!currentSessionId && deepseekMessages.length === 0 && !deepseekError && (
                    <div className="h-full flex flex-col gap-2 items-center justify-center text-gray-700 opacity-40">
                      <Brain size={48} />
                      <span className="text-xs font-medium">Ready</span>
                    </div>
                  )}

                  {/* Message List */}
                  {deepseekMessages.map((m, i) => (
                    <div key={i} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[95%] md:max-w-[90%] ${m.role === 'user' ? 'bg-[#2c2d2e] px-4 py-3 rounded-2xl rounded-tr-none' : ''}`}>
                         <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                           {m.role === 'user' ? <p>{m.content}</p> : <MarkdownRenderer content={m.content} msgId={m.id || `deepseek-${i}`} isSpeaking={speakingMessageId === (m.id || `deepseek-${i}`)} onToggleSpeak={toggleSpeak} />}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* 🔴 VISUAL MAINTENANCE INDICATOR (Not a prompt alert) */}
                  {deepseekError && (
                      <div className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex flex-col items-center justify-center text-red-400 animate-in fade-in slide-in-from-bottom-2">
                           <ShieldAlert size={20} className="mb-2" />
                           <span className="text-sm font-bold">Under Maintenance</span>
                           <span className="text-[10px] opacity-70">DeepSeek R1 is currently unavailable.</span>
                      </div>
                  )}

                  <div ref={deepseekEndRef} />
                </div>
              </div>
            )}

          </div>
        </div>

        {/* INPUT AREA - Sticky Footer (Not Fixed) */}
        {/* ✅ FIX: Removes overlap by being a flex item */}
        <div className="flex-none w-full p-3 md:p-6 bg-[#131314] z-20 border-t border-white/5">
          <div className={`mx-auto relative transition-all duration-300 ${focusedProvider ? 'max-w-3xl' : 'max-w-4xl'}`}>
            
            {/* Image Preview */}
            {image && (
              <div className="absolute -top-16 left-0 bg-[#1e1f20]/90 backdrop-blur-md p-2 rounded-xl border border-[#2c2d2e] flex items-center gap-3 shadow-2xl animate-in slide-in-from-bottom-2 z-10">
                <img src={image} alt="Preview" className="h-10 w-10 object-cover rounded-lg" />
                <span className="text-xs text-gray-400 font-medium">Image attached</span>
                <button onClick={() => setImage(null)} className="p-1 hover:text-red-400 text-gray-400 transition-colors"><X size={14}/></button>
              </div>
            )}

            {/* Input Form */}
            <form onSubmit={handleSearch} className="relative group">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? "Listening..." : focusedProvider ? `Talk to ${focusedProvider === 'groq' ? 'Llama' : focusedProvider === 'deepseek' ? 'DeepSeek' : 'Gemini'}...` : "Ask anything..."}
                className={`w-full bg-[#1e1f20] text-gray-100 placeholder-gray-500 rounded-full py-3 md:py-4 pl-12 md:pl-14 pr-36 md:pr-40 
                  focus:outline-none focus:ring-1 focus:ring-white/10 focus:bg-[#2c2d2e]
                  transition-all text-[15px] border border-[#2c2d2e] shadow-lg hover:shadow-xl
                  ${isListening ? 'border-red-500/50 bg-red-900/10' : ''}`}
                style={{ fontSize: '16px' }} 
              />
              
              {/* LEFT ACTIONS (Media) */}
              <div className="absolute left-2 top-2 bottom-2 flex items-center gap-0 md:gap-1 rounded-full px-1">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1.5 md:p-2 text-gray-400 hover:text-white rounded-full transition-colors hover:bg-white/10" title="Upload Image"><Plus size={20} /></button>
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
              </div>

              {/* RIGHT ACTIONS (Voice/Send) */}
              <div className="absolute right-2 top-2 bottom-2 flex items-center gap-1 md:gap-2">
                 <button type="button" onClick={() => setCameraMode('scan')} className="p-1.5 md:p-2 text-gray-400 hover:text-white rounded-full transition-colors hover:bg-white/10" title="Scan Text"><ScanText size={18} /></button>
                 <button type="button" onClick={() => setCameraMode('capture')} className="p-1.5 md:p-2 text-gray-400 hover:text-white rounded-full transition-colors hover:bg-white/10" title="Camera"><Camera size={18} /></button>
                <button type="button" onClick={toggleVoiceInput} className={`p-2 md:p-2.5 rounded-full transition-all active:scale-90 ${isListening ? 'text-white bg-red-500 animate-pulse shadow-lg shadow-red-500/30' : 'text-gray-400 hover:text-white hover:bg-white/10'}`}>
                  <Mic size={20} />
                </button>
                <button 
                  type={loading ? 'button' : 'submit'} 
                  onClick={loading ? stopGenerating : undefined} 
                  className={`p-2 md:p-2.5 rounded-full transition-all active:scale-90 shadow-lg ${loading ? 'bg-white text-black' : 'bg-[#3c3d3e] text-white hover:bg-[#4a4b4d] disabled:opacity-50 disabled:bg-transparent disabled:shadow-none'}`} 
                  disabled={(!input.trim() && !image) && !loading}
                >
                  {loading ? <StopCircle size={20} fill="currentColor" /> : <Terminal size={20} />}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}