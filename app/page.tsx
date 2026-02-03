'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic'; 

import { 
  Terminal, Cpu, Sparkles, Plus, Trash2, LogOut, Menu, X, User as UserIcon, 
  Mic, StopCircle, VolumeX, Camera, ScanText, Maximize2, Minimize2, ArrowLeft, Shield,
  Clock, ShieldAlert, History, Brain, Crown, LifeBuoy
} from 'lucide-react';
import { db, auth, storage } from '@/lib/firebase';
import { signOut, onAuthStateChanged, User } from 'firebase/auth';
import { 
  collection, addDoc, query, where, orderBy, onSnapshot, serverTimestamp, doc, getDoc, setDoc, updateDoc, Unsubscribe, limit, getDocs
} from 'firebase/firestore';
import { ref, uploadString, getDownloadURL } from 'firebase/storage';
import Login from '@/components/Login';
import CameraModal from '@/components/CameraModal';

// ✅ DYNAMIC IMPORT: Lazy loads the heavy Markdown/Math renderer
const MarkdownRenderer = dynamic(() => import('@/components/MarkdownRenderer'), {
  loading: () => <div className="h-10 w-full animate-pulse rounded bg-[#2c2d2e]/50 mb-2" />,
  ssr: false // ✅ Disable SSR for chat content to avoid hydration mismatches
});

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

type QuotaData = {
  tier: 'free' | 'pro';
  limit: number | 'Unlimited';
  remaining: number | 'Unlimited';
  usage: number;
};

type UserStatus = 'loading' | 'approved' | 'pending' | 'banned' | 'new';

// --- UTILS ---
const sanitizeInput = (str: string) => str.replace(/[<>]/g, '');

// --- COMPONENTS ---

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

// ✅ NEW LIMIT EXCEEDED SCREEN
const LimitExceededScreen = () => (
  <div className="flex h-[100dvh] w-full items-center justify-center bg-[#050505] p-6 text-center animate-in fade-in zoom-in duration-500">
    <div className="max-w-md w-full bg-[#0c0c0e] border border-white/10 rounded-2xl p-8 shadow-2xl flex flex-col items-center relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-red-500 via-orange-500 to-red-500 animate-pulse" />
      
      <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20">
        <ShieldAlert size={40} className="text-red-500" />
      </div>
      
      <h2 className="text-2xl font-bold text-white mb-2">Daily Limit Exhausted</h2>
      <p className="text-gray-400 text-sm leading-relaxed mb-6">
        You've used all your free requests for today. 
        <br/>Upgrade to Pro for unlimited access.
      </p>
      
      <div className="flex gap-3 w-full">
        <button onClick={() => window.location.reload()} className="flex-1 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm font-medium text-gray-300 transition-colors">
           Check Again
        </button>
        <button onClick={() => signOut(auth)} className="flex-1 px-4 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors">
           Sign Out
        </button>
      </div>
      
      <div className="mt-6 text-[10px] text-gray-600 uppercase tracking-widest">
         Contact Admin for Premium
      </div>
    </div>
  </div>
);

// --- MAIN APP ---
export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountStatus, setAccountStatus] = useState<UserStatus>('loading');
  
  // ✅ Quota State
  const [quotaData, setQuotaData] = useState<QuotaData | null>(null);

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
  
  // ⚡ FIX: Add loading state for sessions
  const [sessionsLoaded, setSessionsLoaded] = useState(false);

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
        
        // ❌ FIX: Removed immediate quota fetch to prevent 403 errors on new accounts.
        // The new useEffect below handles this intelligently.

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
                    tier: 'free', 
                    customQuota: 50,
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
        
        // 🚀 AUTO-LOAD LOGIC: Check LocalStorage -> Then check Firestore
        const savedSessionId = localStorage.getItem('turboLastSession');
        
        if (savedSessionId) {
             setCurrentSessionId(savedSessionId);
        } else {
            // If no local session, fetch the last active one from DB (ChatGPT style)
            const recentQ = query(
                collection(db, 'sessions'),
                where('userId', '==', currentUser.uid),
                where('deletedByUser', '==', false),
                orderBy('createdAt', 'desc'),
                limit(1)
            );
            
            getDocs(recentQ).then((snapshot) => {
                if (!snapshot.empty) {
                    const lastSession = snapshot.docs[0];
                    setCurrentSessionId(lastSession.id);
                    localStorage.setItem('turboLastSession', lastSession.id);
                }
            }).catch(e => console.error("Auto-load session failed", e));
        }

        const q = query(
            collection(db, 'sessions'), 
            where('userId', '==', currentUser.uid), 
            orderBy('createdAt', 'desc'),
            limit(50) 
        );

        const unsubSessions = onSnapshot(q, (snapshot) => {
          const fetchedSessions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Session));
          const validSessions = fetchedSessions.filter(s => !s.deletedByUser);
          setSessions(validSessions);
          
          setSessionsLoaded(true);

          // Validation: Check if the locally stored session actually exists.
          const storedSessionId = localStorage.getItem('turboLastSession');
          if (storedSessionId) {
             const sessionExists = validSessions.find(s => s.id === storedSessionId);
             if (!sessionExists) {
                 setCurrentSessionId(null);
                 localStorage.removeItem('turboLastSession');
             }
          }
        });
        unsubSessionsRef.current = unsubSessions;

      } else {
        setSessions([]); setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
        localStorage.removeItem('turboLastSession');
        setUser(null);
        setAccountStatus('loading'); 
        setAuthLoading(false);
        setQuotaData(null);
        setSessionsLoaded(false);
      }
    });

    return () => {
        unsubAuth();
        if (unsubUserRef.current) unsubUserRef.current();
        if (unsubSessionsRef.current) unsubSessionsRef.current();
    };
  }, []);

  // ✅ NEW: SMART QUOTA FETCH (Fixes 403 Error)
  // Only fetches quota when we are SURE the user is approved or admin.
  useEffect(() => {
    if (user && (accountStatus === 'approved' || userRole === 'admin')) {
        fetch(`/api/quota?userId=${user.uid}`)
            .then(res => {
                if (res.status === 403) return null; // Gracefully handle if still forbidden
                return res.json();
            })
            .then(data => {
                if (data && !data.error) setQuotaData(data);
            })
            .catch(err => console.error("Quota fetch failed", err));
    }
  }, [user, accountStatus, userRole]);

  // 2. LOAD CHAT
  useEffect(() => {
    const isValidSession = sessions.find(s => s.id === currentSessionId);

    if (currentSessionId && user && accountStatus === 'approved' && sessionsLoaded && isValidSession) {
      setGroqMessages([]); setGoogleMessages([]); setDeepseekMessages([]);
      setDeepseekError(false);
      
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
  }, [currentSessionId, user, accountStatus, sessionsLoaded, sessions]); 

  useEffect(() => { 
      if (!focusedProvider || focusedProvider === 'groq') groqEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [groqMessages, focusedProvider]);
  
  useEffect(() => { 
      if (!focusedProvider || focusedProvider === 'google') googleEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
  }, [googleMessages, focusedProvider]);

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
    setDeepseekError(false); 
    setImage(null);
    stopSpeaking();
    setFocusedProvider(null);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const selectSession = (sessId: string) => {
    setCurrentSessionId(sessId);
    setDeepseekError(false); 
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
      // ✅ OPTIMIZED PAYLOAD CONSTRUCTION
      // This solves "Payload Too Large" and preserves history.
      const apiHistory = currentHistory.map((msg, index) => {
          let content: any = msg.content;

          // 🧠 Intelligent Image Handling:
          // If this is a PAST message (not the new one at the end), and it has an image:
          // We MUST use the URL version (from Firestore) to avoid sending huge Base64 strings.
          // Note: The LAST message's image is handled separately by the 'image' param in the body.
          if (index < currentHistory.length - 1 && msg.role === 'user' && msg.image) {
              // Only attach if it's a URL (prevents 413 Errors)
              if (msg.image.startsWith('http')) {
                  content = [
                    { type: 'text', text: msg.content },
                    { type: 'image', image: msg.image }
                  ];
              }
          }
          
          return { role: msg.role, content };
      });

      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
            messages: apiHistory, 
            provider, 
            image: imgData, // Send the NEW image (Base64) separately
            userId: user?.uid 
        }),
        signal: signal
      });

      // 🛑 HANDLE MAINTENANCE / ERRORS 
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})); 
        
        if (response.status === 503 || errorData.code === 'DEEPSEEK_MAINTENANCE') {
           if (provider === 'deepseek') {
               setDeepseekError(true); 
           }
           return; 
        }
        
        if (response.status === 429 && errorData.code === 'QUOTA_EXCEEDED') {
            setQuotaData(prev => prev ? { ...prev, remaining: 0 } : null);
            return;
        }
      }

      setQuotaData(prev => {
          if (!prev || prev.remaining === 'Unlimited' || prev.remaining <= 0) return prev;
          return { ...prev, remaining: prev.remaining - 1, usage: prev.usage + 1 };
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
    setDeepseekError(false); 
    
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
    
    const userMsg: Message = { 
        id: tempId, 
        role: 'user', 
        content: cleanInput, 
        image: localImageBase64, 
        provider: 'google' 
    };

    if (!focusedProvider || focusedProvider === 'google') setGoogleMessages(prev => [...prev, userMsg]);
    
    if (!focusedProvider || focusedProvider === 'deepseek') {
        setDeepseekMessages(prev => [...prev, { ...userMsg, provider: 'deepseek' }]);
    }
    
    if (!localImageBase64) {
        if (!focusedProvider || focusedProvider === 'groq') {
            setGroqMessages(prev => [...prev, { ...userMsg, provider: 'groq' }]);
        }
    }

    const uploadPromise = (async () => {
        if (!localImageBase64) return null;
        try {
            const storageRef = ref(storage, `chat-images/${user.uid}/${activeSessionId}/${Date.now()}.jpg`);
            await uploadString(storageRef, localImageBase64, 'data_url');
            const url = await getDownloadURL(storageRef);
            return url;
        } catch (err) {
            console.error("Image upload failed:", err);
            return null;
        }
    })();

    const promises = [];

    promises.push(
        uploadPromise.then((downloadUrl) => {
            addDoc(collection(db, 'chats'), { 
                sessionId: activeSessionId, role: 'user', content: cleanInput, 
                image: downloadUrl, // Save URL for future loads
                provider: 'google', createdAt: serverTimestamp() 
            });

            if (localImageBase64 || (!focusedProvider || focusedProvider === 'deepseek')) {
                 addDoc(collection(db, 'chats'), { 
                    sessionId: activeSessionId, role: 'user', content: cleanInput, 
                    image: downloadUrl, 
                    provider: 'deepseek', createdAt: serverTimestamp() 
                });
            }

            if (!localImageBase64 && (!focusedProvider || focusedProvider === 'groq')) {
                addDoc(collection(db, 'chats'), { 
                    sessionId: activeSessionId, role: 'user', content: cleanInput, 
                    provider: 'groq', createdAt: serverTimestamp() 
                });
            }
        })
    );

    if (localImageBase64 && focusedProvider === 'groq') {
        setFocusedProvider('google');
    }

    if (localImageBase64 || !focusedProvider || focusedProvider === 'google') {
        promises.push(streamAnswer('google', [...googleMessages, userMsg], activeSessionId!, controller.signal, localImageBase64));
    }

    if (localImageBase64 || !focusedProvider || focusedProvider === 'deepseek') {
        promises.push(streamAnswer('deepseek', [...deepseekMessages, { ...userMsg, provider: 'deepseek' }], activeSessionId!, controller.signal, localImageBase64));
    }

    if (!localImageBase64 && (!focusedProvider || focusedProvider === 'groq')) {
        promises.push(streamAnswer('groq', [...groqMessages, { ...userMsg, provider: 'groq' }], activeSessionId!, controller.signal, null));
    }

    try {
        await Promise.all(promises);
    } catch (err) {
        console.error("Stream/Upload error", err);
    } finally {
        setLoading(false); 
        abortControllerRef.current = null;
    }
  };

  if (authLoading) return <div className="flex h-[100dvh] items-center justify-center bg-[#131314] text-white"><Cpu size={48} className="text-purple-500 animate-pulse" /></div>;
  if (!user) return <Login />;

  if (accountStatus === 'banned') return <StatusScreen color="red" icon={<ShieldAlert size={40} className="text-red-500" />} title="Access Revoked" description="Your account has been flagged and banned." subtext="You are currently locked out." />;
  if (accountStatus === 'pending') return <StatusScreen color="yellow" icon={<Clock size={40} className="text-yellow-500 animate-pulse" />} title="Verification Pending" description="Your account is waiting for approval." subtext="Wait here. This page will unlock automatically." />;

  if (quotaData?.tier !== 'pro' && typeof quotaData?.remaining === 'number' && quotaData.remaining <= 0) {
      return <LimitExceededScreen />;
  }

  return (
    <div className="flex h-[100dvh] bg-[#131314] text-gray-100 font-sans overflow-hidden selection:bg-purple-500/30 selection:text-white relative">
      
      {cameraMode && (
        <CameraModal 
          mode={cameraMode}
          onClose={() => setCameraMode(null)}
          onCapture={(imgSrc) => { setImage(imgSrc); setCameraMode(null); }}
          onScan={(text) => { setInput(text); setCameraMode(null); }}
        />
      )}

      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 lg:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside 
        className={`fixed lg:static inset-y-0 left-0 z-50 flex flex-col bg-[#1e1f20] border-r border-white/5 transition-all duration-300 ease-in-out shadow-2xl
          ${sidebarOpen ? 'translate-x-0 w-[280px]' : '-translate-x-full lg:translate-x-0 lg:w-0 lg:border-none lg:overflow-hidden'}
        `}
      >
        <div className="p-4 flex flex-col gap-4 min-w-[280px]">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
                <button 
                onClick={() => setSidebarOpen(false)} 
                className="p-2 text-gray-400 hover:bg-[#333537] hover:text-white rounded-full transition-colors active:scale-95"
                title="Close Menu"
                >
                <Menu size={20} />
                </button>
                <span className="text-sm font-bold text-gray-200 tracking-wide">TurboLearn</span>
            </div>
            
            {quotaData?.tier === 'pro' ? (
                <span className="flex items-center gap-1 text-[9px] font-bold bg-yellow-900/20 text-yellow-400 px-2 py-1 rounded border border-yellow-500/30 uppercase tracking-wide">
                    <Crown size={10} fill="currentColor" /> Pro
                </span>
            ) : (
                <span className="flex items-center gap-1 text-[9px] font-bold bg-white/5 text-gray-400 px-2 py-1 rounded border border-white/10 uppercase tracking-wide">
                    Free
                </span>
            )}
          </div>

          {quotaData && quotaData.tier !== 'pro' && (
              <div className="mx-2 px-3 py-2 bg-black/20 rounded-lg border border-white/5">
                  <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] text-gray-400 uppercase font-bold tracking-widest">Daily Limit</span>
                      <span className="text-[10px] text-white font-mono">{quotaData.remaining}/{quotaData.limit}</span>
                  </div>
                  <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                      <div 
                          className="h-full bg-blue-500 transition-all duration-500" 
                          style={{ width: `${Math.min(100, ((quotaData.usage || 0) / (quotaData.limit as number || 50)) * 100)}%` }} 
                      />
                  </div>
              </div>
          )}

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

        <div className="px-4 mb-2 min-w-[280px]">
           <button 
             onClick={() => window.location.href='/support'}
             className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-900/10 text-blue-400 border border-blue-500/20 hover:bg-blue-900/20 transition-all font-medium text-sm group"
           >
              <LifeBuoy size={18} className="group-hover:scale-110 transition-transform" /> 
              Contact Support
           </button>
        </div>

        <div className="p-4 mt-auto border-t border-white/5 bg-[#171819] min-w-[280px]">
          <div className="flex items-center gap-3 px-3 py-2.5 hover:bg-[#2c2d2e] rounded-xl cursor-pointer transition-colors group" onClick={handleLogout}>
              {user.photoURL ? <img src={user.photoURL} className="w-8 h-8 rounded-full border border-gray-600 group-hover:border-gray-400 transition-colors" /> : <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center"><UserIcon size={16} /></div>}
              <div className="text-sm font-medium truncate flex-1 text-gray-200">{user.displayName}</div>
              <LogOut size={16} className="text-gray-500 group-hover:text-gray-300 transition-colors" />
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-[100dvh] relative bg-[#131314] w-full min-w-0 transition-all duration-300">
        
        <div className="flex-none h-16 flex items-center px-4 z-40 bg-transparent justify-between relative">
          <div className={`flex items-center transition-opacity duration-300 ${sidebarOpen ? 'lg:opacity-0 pointer-events-none' : 'opacity-100'}`}>
             <button 
              onClick={() => setSidebarOpen(true)}
              className="p-2 text-gray-400 hover:bg-[#2c2d2e]/80 hover:text-white rounded-full transition-colors active:scale-95 pointer-events-auto"
            >
              <Menu size={24} />
            </button>
          </div>

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

        <div className="flex-1 min-h-0 overflow-hidden p-2 md:p-4 pb-0 pt-0 flex flex-col relative z-0">
          <div className={`w-full h-full max-w-[1800px] mx-auto transition-all duration-300 
             ${focusedProvider ? 'max-w-4xl' : 'flex flex-col lg:grid lg:grid-cols-3 gap-2 lg:gap-6'} 
          `}>
            
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
                  {!currentSessionId && deepseekMessages.length === 0 && !deepseekError && (
                    <div className="h-full flex flex-col gap-2 items-center justify-center text-gray-700 opacity-40">
                      <Brain size={48} />
                      <span className="text-xs font-medium">Ready</span>
                    </div>
                  )}

                  {deepseekMessages.map((m, i) => (
                    <div key={i} className={`mb-6 flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[95%] md:max-w-[90%] ${m.role === 'user' ? 'bg-[#2c2d2e] px-4 py-3 rounded-2xl rounded-tr-none' : ''}`}>
                         {m.image && (<div className="mb-3"><img src={m.image} alt="Upload" className="max-h-48 rounded-lg border border-[#3c3d3e] object-contain bg-black/50" /></div>)}
                         <div className="prose prose-invert max-w-none text-gray-100 text-sm leading-relaxed break-words">
                           {m.role === 'user' ? <p>{m.content}</p> : <MarkdownRenderer content={m.content} msgId={m.id || `deepseek-${i}`} isSpeaking={speakingMessageId === (m.id || `deepseek-${i}`)} onToggleSpeak={toggleSpeak} />}
                        </div>
                      </div>
                    </div>
                  ))}

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

        <div className="flex-none w-full p-3 md:p-6 bg-[#131314] z-20 border-t border-white/5">
          <div className={`mx-auto relative transition-all duration-300 ${focusedProvider ? 'max-w-3xl' : 'max-w-4xl'}`}>
            
            {image && (
              <div className="absolute -top-16 left-0 bg-[#1e1f20]/90 backdrop-blur-md p-2 rounded-xl border border-[#2c2d2e] flex items-center gap-3 shadow-2xl animate-in slide-in-from-bottom-2 z-10">
                <img src={image} alt="Preview" className="h-10 w-10 object-cover rounded-lg" />
                <span className="text-xs text-gray-400 font-medium">Image attached</span>
                <button onClick={() => setImage(null)} className="p-1 hover:text-red-400 text-gray-400 transition-colors"><X size={14}/></button>
              </div>
            )}

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
              
              <div className="absolute left-2 top-2 bottom-2 flex items-center gap-0 md:gap-1 rounded-full px-1">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1.5 md:p-2 text-gray-400 hover:text-white rounded-full transition-colors hover:bg-white/10" title="Upload Image"><Plus size={20} /></button>
                <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
              </div>

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