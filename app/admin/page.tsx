'use client';
// ✅ Keep this to force dynamic rendering
export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math'; 
import rehypeKatex from 'rehype-katex'; 
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import 'katex/dist/katex.min.css'; 

import { 
  Users, MessageSquare, CheckCircle, Trash2, Search, LogOut, 
  Ban, Eye, X, Shield, ImageIcon, Terminal, Clock, 
  BarChart3, Download, Filter, AlertCircle, Activity, Copy, Archive, Loader2, ChevronDown,
  Menu, ArrowLeft, Crown, Edit3, Save, Zap, Home, LifeBuoy, Mail, Check, Send, Ticket, XCircle
} from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { 
  collection, query, where, orderBy, onSnapshot, doc, updateDoc, getDocs, writeBatch, 
  limit, startAfter, getCountFromServer, QueryDocumentSnapshot, DocumentData, getDoc, addDoc, serverTimestamp, deleteDoc 
} from 'firebase/firestore';
import { useRouter, useSearchParams } from 'next/navigation';
import Login from '@/components/Login';

// --- TYPES ---
type UserData = {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'user';
  status: 'pending' | 'approved' | 'banned';
  tier?: 'free' | 'pro';
  customQuota?: number;
  lastLogin: any;
  createdAt: any;
};

type ChatSession = {
   id: string;
   title: string;
   createdAt: any;
   deletedByUser?: boolean;
};

type ChatMessage = {
   role: 'user' | 'assistant';
   content: string;
   image?: string | null;
   provider?: string;
   createdAt: any;
};

// --- SUPPORT SUB-COMPONENTS ---

// ✅ Updated to fetch BOTH Tickets (Guests) and Chats (Students)
const SupportCaseList = ({ onSelect, selectedId }: { onSelect: (item: any) => void, selectedId: string | null }) => {
  const [chats, setChats] = useState<any[]>([]);
  const [tickets, setTickets] = useState<any[]>([]);

  useEffect(() => {
    // 1. Listen to Student Chats
    const qChats = query(collection(db, 'support_chats'), orderBy('lastUpdated', 'desc'));
    const unsubChats = onSnapshot(qChats, (snapshot) => {
      setChats(snapshot.docs.map(d => ({ id: d.id, ...d.data(), type: 'chat' })));
    });

    // 2. Listen to Guest Tickets
    const qTickets = query(collection(db, 'support_tickets'), orderBy('createdAt', 'desc'));
    const unsubTickets = onSnapshot(qTickets, (snapshot) => {
      setTickets(snapshot.docs.map(d => ({ id: d.id, ...d.data(), type: 'ticket' })));
    });

    return () => { unsubChats(); unsubTickets(); };
  }, []);

  // Merge and sort by newest activity
  const allCases = [...tickets, ...chats].sort((a, b) => {
      const dateA = a.lastUpdated || a.createdAt;
      const dateB = b.lastUpdated || b.createdAt;
      return (dateB?.seconds || 0) - (dateA?.seconds || 0);
  });

  if (allCases.length === 0) return <div className="p-6 text-xs text-gray-500 text-center italic">No active support tickets found.</div>;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
      {allCases.map((c) => (
        <div 
          key={c.id} 
          onClick={() => onSelect(c)}
          className={`p-3 rounded-lg cursor-pointer border transition-all ${selectedId === c.id ? 'bg-blue-900/20 border-blue-500/30' : 'bg-transparent border-transparent hover:bg-white/5'}`}
        >
          <div className="flex justify-between items-start mb-1">
            <div className="flex items-center gap-2">
                {c.type === 'ticket' ? (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider bg-purple-500/10 text-purple-400 border border-purple-500/20 flex items-center gap-1">
                        <Ticket size={10} /> GUEST
                    </span>
                ) : (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                        c.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' : 
                        c.status === 'resolved' ? 'bg-gray-500/10 text-gray-400 border border-gray-500/20' :
                        'bg-green-500/10 text-green-400 border border-green-500/20'
                    }`}>
                        {c.status === 'pending' ? 'Pending' : c.status === 'resolved' ? 'Resolved' : 'Active'}
                    </span>
                )}
            </div>
            <span className="text-[10px] text-gray-500">
                {(c.lastUpdated || c.createdAt)?.toDate ? new Date((c.lastUpdated || c.createdAt).toDate()).toLocaleDateString() : ''}
            </span>
          </div>
          <div className="text-sm font-medium text-gray-200 truncate mt-1.5">{c.displayName || c.email || 'Anonymous'}</div>
          <div className="text-xs text-gray-500 truncate mt-0.5">{c.complaint || c.message}</div>
        </div>
      ))}
    </div>
  );
};

// ✅ Updated to handle Mark Resolved & Manual Delete
const AdminSupportView = ({ activeCase, onClear }: { activeCase: any, onClear: () => void }) => {
  // Common State
  const [data, setData] = useState<any>(null);
  
  // Chat State
  const [msgs, setMsgs] = useState<any[]>([]);
  const [reply, setReply] = useState('');
  const dummyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeCase) return;

    // 1. Listen to the Document (Ticket or Chat)
    const collectionName = activeCase.type === 'chat' ? 'support_chats' : 'support_tickets';
    const unsubDoc = onSnapshot(doc(db, collectionName, activeCase.id), (snap) => {
       if (snap.exists()) {
           setData(snap.data());
       } else {
           // Document might have been deleted
           setData(null);
       }
    });
    
    // 2. If it's a Chat, Listen to Messages
    let unsubMsgs = () => {};
    if (activeCase.type === 'chat') {
        const q = query(collection(db, 'support_chats', activeCase.id, 'messages'), orderBy('createdAt', 'asc'));
        unsubMsgs = onSnapshot(q, (snap) => {
            setMsgs(snap.docs.map(d => d.data()));
            setTimeout(() => dummyRef.current?.scrollIntoView({behavior:'smooth'}), 100);
        });
    }
    
    return () => { unsubDoc(); unsubMsgs(); };
  }, [activeCase]);

  // --- ACTIONS ---

  const approveChat = async () => {
    try { await updateDoc(doc(db, 'support_chats', activeCase.id), { status: 'approved' }); } 
    catch (e) { alert("Error approving request"); }
  };

  const markResolved = async () => {
    if(!confirm("Mark this case as resolved?")) return;
    try {
        const collectionName = activeCase.type === 'chat' ? 'support_chats' : 'support_tickets';
        await updateDoc(doc(db, collectionName, activeCase.id), { status: 'resolved' });
    } catch (e) { alert("Error updating status"); }
  };

  const deleteCase = async () => {
      if(!confirm("⚠️ PERMANENTLY DELETE this case and all its data? This cannot be undone.")) return;
      
      try {
          if (activeCase.type === 'chat') {
              // Recursive delete for Chats: Delete messages subcollection first
              const msgsSnap = await getDocs(collection(db, 'support_chats', activeCase.id, 'messages'));
              const batch = writeBatch(db);
              
              msgsSnap.docs.forEach(d => batch.delete(d.ref));
              batch.delete(doc(db, 'support_chats', activeCase.id));
              
              await batch.commit();
          } else {
              // Simple delete for Tickets
              await deleteDoc(doc(db, 'support_tickets', activeCase.id));
          }
          onClear(); // Clear selection after delete
      } catch (e) { 
          console.error(e);
          alert("Error deleting case"); 
      }
  };

  const sendChatReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!reply.trim()) return;
    try {
      await addDoc(collection(db, 'support_chats', activeCase.id, 'messages'), {
         text: reply, sender: 'admin', createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'support_chats', activeCase.id), { lastUpdated: serverTimestamp() });
      setReply('');
    } catch (e) { console.error(e); }
  };

  if(!data) return <div className="h-full flex items-center justify-center text-gray-500"><Loader2 className="animate-spin mr-2"/> Loading Case...</div>;

  // --- RENDER LOGIC ---

  // 🅰️ GUEST TICKET VIEW
  if (activeCase.type === 'ticket') {
      return (
        <div className="flex flex-col h-full bg-[#050505] md:p-8 p-4 items-center justify-center relative">
            <button onClick={onClear} className="md:hidden absolute top-4 left-4 text-gray-400 hover:text-white flex items-center gap-2">
                <ArrowLeft size={18} /> Back
            </button>
            <div className="max-w-lg w-full bg-[#0c0c0e] border border-white/10 rounded-2xl p-8 shadow-2xl">
                <div className="flex items-center gap-4 mb-6 pb-6 border-b border-white/5">
                    <div className="w-12 h-12 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-400">
                        <Ticket size={24} />
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-white flex items-center gap-2">
                            Guest Ticket
                            {data.status === 'resolved' && <span className="text-[10px] bg-gray-700 text-gray-300 px-2 py-0.5 rounded-full border border-gray-600">RESOLVED</span>}
                        </h2>
                        <p className="text-sm text-gray-400 font-mono">{data.email}</p>
                    </div>
                </div>
                
                <div className="space-y-2 mb-8">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Message</label>
                    <div className="p-4 bg-white/5 rounded-xl text-gray-200 text-sm leading-relaxed border border-white/5">
                        {data.message}
                    </div>
                    <p className="text-[10px] text-gray-600 text-right pt-1">
                        Received: {data.createdAt?.toDate ? new Date(data.createdAt.toDate()).toLocaleString() : 'Just now'}
                    </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <a href={`mailto:${data.email}`} className="col-span-2 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium text-sm transition-all flex items-center justify-center gap-2 border border-white/10">
                        <Mail size={16} /> Reply via Email
                    </a>
                    
                    {data.status !== 'resolved' && (
                        <button onClick={markResolved} className="py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-green-900/20">
                            <CheckCircle size={16} /> Mark Resolved
                        </button>
                    )}
                    
                    <button onClick={deleteCase} className={`py-3 bg-red-900/20 hover:bg-red-900/40 text-red-400 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 border border-red-500/20 ${data.status === 'resolved' ? 'col-span-2' : ''}`}>
                        <Trash2 size={16} /> Delete Ticket
                    </button>
                </div>
            </div>
        </div>
      );
  }

  // 🅱️ STUDENT CHAT VIEW
  return (
    <div className="flex flex-col h-full bg-[#050505]">
       {/* Header */}
       <div className="p-4 md:p-6 border-b border-white/10 bg-[#0c0c0e] flex flex-col md:flex-row justify-between items-start shrink-0 gap-4">
          <div className="flex-1 mr-0 md:mr-6 w-full">
             <div className="flex items-center gap-3 mb-2">
                 {/* Mobile Back Button */}
                 <button onClick={onClear} className="md:hidden text-gray-400 hover:text-white">
                     <ArrowLeft size={20} />
                 </button>
                 <h3 className="font-bold text-white text-lg flex items-center gap-2 truncate">
                    {data.displayName} 
                    <span className="text-xs font-normal text-gray-500 font-mono px-2 py-0.5 bg-white/5 rounded hidden sm:inline-block">{data.email}</span>
                 </h3>
             </div>
             <div className="text-sm text-gray-300 bg-red-900/10 p-3 rounded-lg border border-red-500/10">
                <span className="text-[10px] text-red-400 uppercase font-bold block mb-1 flex items-center gap-1"><AlertCircle size={10} /> Reported Issue:</span>
                {data.complaint}
             </div>
          </div>
          <div className="shrink-0 flex flex-row md:flex-col gap-2 items-center md:items-end w-full md:w-auto justify-end">
            {data.status === 'pending' ? (
                <button onClick={approveChat} className="bg-green-600 hover:bg-green-500 text-white px-5 py-2.5 rounded-lg text-xs font-bold flex items-center gap-2 transition-all shadow-lg shadow-green-900/20 active:scale-95 w-full md:w-auto justify-center">
                    <Check size={14} /> Approve Request
                </button>
            ) : (
                <div className="flex items-center gap-2 w-full md:w-auto">
                    {data.status !== 'resolved' && (
                        <button onClick={markResolved} className="flex-1 md:flex-none bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all">
                            <CheckCircle size={14} /> Resolve
                        </button>
                    )}
                    <button onClick={deleteCase} className="flex-1 md:flex-none bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-500/20 px-3 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-2 transition-all">
                        <Trash2 size={14} /> Delete
                    </button>
                </div>
            )}
            
            <div className="hidden md:block mt-1">
                {data.status === 'approved' && (
                    <span className="text-green-400 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
                        <CheckCircle size={10} /> Active
                    </span>
                )}
                {data.status === 'resolved' && (
                    <span className="text-gray-500 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1">
                        <CheckCircle size={10} /> Resolved
                    </span>
                )}
            </div>
          </div>
       </div>

       {/* Messages */}
       <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scrollbar bg-[#050505]">
          {msgs.length === 0 && data.status === 'approved' && (
              <div className="text-center text-gray-600 text-xs mt-10 p-4 border border-dashed border-white/10 rounded-xl">
                 Channel is open. Send a message to start.
              </div>
          )}
          {msgs.map((m, i) => (
             <div key={i} className={`flex ${m.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] md:max-w-[75%] px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                    m.sender === 'admin' 
                    ? 'bg-blue-600 text-white rounded-tr-sm' 
                    : 'bg-[#1e1f20] text-gray-300 border border-white/10 rounded-tl-sm'
                }`}>
                   {m.text}
                </div>
             </div>
          ))}
          <div ref={dummyRef} />
       </div>

       {/* Input */}
       {data.status !== 'resolved' && data.status !== 'pending' && (
          <form onSubmit={sendChatReply} className="p-3 md:p-4 bg-[#0c0c0e] border-t border-white/5 flex gap-2 md:gap-3 shrink-0">
             <input 
                value={reply} 
                onChange={e=>setReply(e.target.value)} 
                className="flex-1 bg-[#18181b] border border-white/10 px-4 py-3 rounded-xl text-sm text-white focus:outline-none focus:border-blue-500 focus:bg-[#1f1f22] transition-all placeholder:text-gray-600" 
                placeholder="Type your reply..." 
             />
             <button type="submit" disabled={!reply.trim()} className="px-4 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-all disabled:opacity-50 disabled:bg-gray-800 flex items-center justify-center">
                <Send size={18} />
             </button>
          </form>
       )}
       {data.status === 'resolved' && (
           <div className="p-4 bg-[#0c0c0e] border-t border-white/5 text-center text-xs text-gray-500">
               This conversation has been resolved.
           </div>
       )}
    </div>
  );
};

// --- CODE BLOCK COMPONENTS ---

const CodeBlock = ({ language, code }: { language: string, code: string }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2 rounded-lg overflow-hidden bg-[#1e1f20] border border-[#2c2d2e] w-full">
      <div className="flex justify-between items-center bg-[#262729] px-3 py-1.5 border-b border-[#2c2d2e]">
        <span className="text-[10px] uppercase font-bold text-gray-400">{language || 'text'}</span>
        <button onClick={handleCopy} className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-white">
          {copied ? <CheckCircle size={10} /> : <Copy size={10} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter 
          language={language?.toLowerCase() || 'text'} 
          style={vscDarkPlus} 
          PreTag="div" 
          customStyle={{ margin: 0, padding: '0.75rem', fontSize: '12px' }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
};

const AdminMarkdownRenderer = ({ content }: { content: string }) => {
  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed">
      <ReactMarkdown 
        remarkPlugins={[remarkGfm, remarkMath]} 
        rehypePlugins={[rehypeKatex]} 
        components={{
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || '');
            return !inline && match ? 
              <CodeBlock language={match[1]} code={String(children).replace(/\n$/, '')} /> : 
              <code className="bg-[#2c2d2e] text-orange-200 px-1 py-0.5 rounded text-[12px]" {...props}>{children}</code>;
          },
          p({ children }) { return <p className="mb-2 last:mb-0">{children}</p>; },
          ul({ children }) { return <ul className="list-disc pl-4 mb-2">{children}</ul>; },
          ol({ children }) { return <ol className="list-decimal pl-4 mb-2">{children}</ol>; },
          a({ children, href }) { return <a href={href} target="_blank" className="text-blue-400 underline">{children}</a>; }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};

// ⚠️ MAIN LOGIC COMPONENT
function AdminContent() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processingAction, setProcessingAction] = useState(false); 
  
  // ✅ Responsive State
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // ✅ Edit Mode State
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [tempQuota, setTempQuota] = useState<string>('');

  // ✅ Support State
  const [activeSupportCase, setActiveSupportCase] = useState<any>(null);

  const router = useRouter();
  const searchParams = useSearchParams();

  // Admin Data with Pagination
  const [users, setUsers] = useState<UserData[]>([]);
  const [lastVisible, setLastVisible] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [fetchingUsers, setFetchingUsers] = useState(false);
  const [hasMoreUsers, setHasMoreUsers] = useState(true);
  
  // ✅ Session Pagination State
  const [userSessions, setUserSessions] = useState<ChatSession[]>([]);
  const [lastVisibleSession, setLastVisibleSession] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [fetchingSessions, setFetchingSessions] = useState(false);
  const [hasMoreSessions, setHasMoreSessions] = useState(false);

  // Metrics State
  const [serverMetrics, setServerMetrics] = useState({
      total: 0,
      active: 0,
      pending: 0,
      banned: 0,
      admins: 0
  });

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'banned' | 'admin'>('all');
  
  // Tabs & Navigation State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'chats' | 'support'>('dashboard');

  // Chat Inspector State
  const [selectedUserForChat, setSelectedUserForChat] = useState<UserData | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatLogs, setChatLogs] = useState<ChatMessage[]>([]);

  // 1. AUTH CHECK & STATE RESTORATION
  useEffect(() => {
    let unsubscribeFirestore: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubscribeFirestore) {
        unsubscribeFirestore();
        unsubscribeFirestore = null;
      }

      if (currentUser) {
        const docRef = doc(db, 'users', currentUser.uid);
        
        unsubscribeFirestore = onSnapshot(docRef, async (docSnap) => {
             const data = docSnap.data();
             if (data && data.role === 'admin') {
                 setUser(currentUser);
                 setIsAdmin(true);
                 
                 const tabParam = searchParams.get('tab');
                 const uidParam = searchParams.get('uid');
                 const sessionParam = searchParams.get('sessionId');

                 if (tabParam === 'users' || tabParam === 'chats' || tabParam === 'dashboard' || tabParam === 'support') {
                     setActiveTab(tabParam as any);
                 }

                 if (tabParam === 'chats' && uidParam) {
                     try {
                         const userDoc = await getDoc(doc(db, 'users', uidParam));
                         if (userDoc.exists()) {
                             const targetUser = { uid: userDoc.id, ...userDoc.data() } as UserData;
                             setSelectedUserForChat(targetUser);
                             
                             const SESSIONS_PER_PAGE = 20;
                             try {
                                 const q = query(
                                     collection(db, 'sessions'), 
                                     where('userId', '==', targetUser.uid), 
                                     orderBy('createdAt', 'desc'),
                                     limit(SESSIONS_PER_PAGE)
                                 );
                                 const snap = await getDocs(q);
                                 const fetchedSessions = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));
                                 
                                 setUserSessions(fetchedSessions);
                                 setLastVisibleSession(snap.docs[snap.docs.length - 1] || null);
                                 setHasMoreSessions(snap.docs.length === SESSIONS_PER_PAGE);

                             } catch (err) {
                                 console.warn("Session pagination failed", err);
                                 const q2 = query(collection(db, 'sessions'), where('userId', '==', targetUser.uid));
                                 const snap2 = await getDocs(q2);
                                 const sessions = snap2.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));
                                 sessions.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
                                 setUserSessions(sessions);
                                 setHasMoreSessions(false);
                             }

                             if (sessionParam) {
                                 setActiveSessionId(sessionParam);
                                 const qLogs = query(collection(db, 'chats'), where('sessionId', '==', sessionParam), orderBy('createdAt', 'asc'));
                                 const snapLogs = await getDocs(qLogs);
                                 setChatLogs(snapLogs.docs.map(d => d.data() as ChatMessage));
                             }
                         }
                     } catch (err) {
                         console.error("Error restoring state:", err);
                     }
                 }
             } else {
                 router.push('/');
             }
             setLoading(false);
        });
      } else {
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
      }
    });

    return () => {
        unsubAuth();
        if (unsubscribeFirestore) unsubscribeFirestore();
    };
  }, []); 

  // 2. FETCH USERS (PAGINATED)
  const USERS_PER_PAGE = 20;

  const fetchUsers = async (reset = false) => {
      if (!isAdmin || (fetchingUsers && !reset)) return;
      
      setFetchingUsers(true);
      try {
          let q = query(
              collection(db, 'users'), 
              orderBy('createdAt', 'desc'), 
              limit(USERS_PER_PAGE)
          );

          if (filterStatus === 'admin') {
              q = query(
                  collection(db, 'users'), 
                  where('role', '==', 'admin'),
                  orderBy('createdAt', 'desc'), 
                  limit(USERS_PER_PAGE)
              );
          } else if (filterStatus !== 'all') {
              q = query(
                  collection(db, 'users'), 
                  where('status', '==', filterStatus),
                  orderBy('createdAt', 'desc'), 
                  limit(USERS_PER_PAGE)
              );
          }

          if (!reset && lastVisible) {
              q = query(q, startAfter(lastVisible));
          }

          const snapshot = await getDocs(q);
          
          const fetchedUsers = snapshot.docs.map(d => ({
              uid: d.id, 
              ...d.data()
          } as UserData));

          setLastVisible(snapshot.docs[snapshot.docs.length - 1] || null);
          setHasMoreUsers(snapshot.docs.length === USERS_PER_PAGE);

          if (reset) {
              setUsers(fetchedUsers);
          } else {
              setUsers(prev => [...prev, ...fetchedUsers]);
          }
      } catch (error) {
          console.error("Error fetching users:", error);
      } finally {
          setFetchingUsers(false);
      }
  };

  const fetchMetrics = async () => {
      if (!isAdmin) return;
      try {
          const coll = collection(db, 'users');
          const snapshotTotal = await getCountFromServer(coll);
          const snapshotActive = await getCountFromServer(query(coll, where('status', '==', 'approved')));
          const snapshotPending = await getCountFromServer(query(coll, where('status', '==', 'pending')));
          const snapshotBanned = await getCountFromServer(query(coll, where('status', '==', 'banned')));
          const snapshotAdmins = await getCountFromServer(query(coll, where('role', '==', 'admin')));

          setServerMetrics({
              total: snapshotTotal.data().count,
              active: snapshotActive.data().count,
              pending: snapshotPending.data().count,
              banned: snapshotBanned.data().count,
              admins: snapshotAdmins.data().count
          });
      } catch (error) {
          console.error("Error fetching metrics:", error);
      }
  };

  useEffect(() => {
      if (isAdmin) {
          fetchUsers(true);
          fetchMetrics();
      }
  }, [isAdmin, filterStatus]);

  const fetchSessions = async (uid: string, reset = false) => {
      if (fetchingSessions && !reset) return;
      
      setFetchingSessions(true);
      try {
          let q = query(
              collection(db, 'sessions'), 
              where('userId', '==', uid), 
              orderBy('createdAt', 'desc'),
              limit(20)
          );

          if (!reset && lastVisibleSession) {
              q = query(q, startAfter(lastVisibleSession));
          }

          const snapshot = await getDocs(q);
          const newSessions = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));

          setLastVisibleSession(snapshot.docs[snapshot.docs.length - 1] || null);
          setHasMoreSessions(snapshot.docs.length === 20);

          if (reset) {
              setUserSessions(newSessions);
          } else {
              setUserSessions(prev => [...prev, ...newSessions]);
          }

      } catch (error) {
          if (reset) {
             try {
                const q2 = query(collection(db, 'sessions'), where('userId', '==', uid));
                const snap2 = await getDocs(q2);
                const sessions = snap2.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));
                sessions.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
                setUserSessions(sessions);
                setHasMoreSessions(false); 
             } catch (e2) {
                 console.error("Fallback failed", e2);
             }
          }
      } finally {
          setFetchingSessions(false);
      }
  };

  // 4. ACTIONS & UPDATES
  const handleSwitchTab = (tab: 'dashboard' | 'users' | 'chats' | 'support') => {
      setActiveTab(tab);
      setIsSidebarOpen(false); 
      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', tab);
      if (tab !== 'chats') {
          params.delete('uid');
          params.delete('sessionId');
      }
      router.push(`?${params.toString()}`);
  };

  const handleCloseInspector = () => {
      setSelectedUserForChat(null);
      setActiveSessionId(null);
      const params = new URLSearchParams(searchParams.toString());
      params.delete('uid');
      params.delete('sessionId');
      router.push(`?${params.toString()}`);
  };

  const loadUserSessions = async (targetUser: UserData) => {
      setSelectedUserForChat(targetUser);
      setActiveSessionId(null);
      setChatLogs([]);
      setActiveTab('chats');

      const params = new URLSearchParams(searchParams.toString());
      params.set('tab', 'chats');
      params.set('uid', targetUser.uid);
      params.delete('sessionId'); 
      router.push(`?${params.toString()}`);

      fetchSessions(targetUser.uid, true);
  };

  const loadChatLogs = async (sessionId: string) => {
      setActiveSessionId(sessionId);
      const params = new URLSearchParams(searchParams.toString());
      params.set('sessionId', sessionId);
      router.push(`?${params.toString()}`);

      try {
        const q = query(collection(db, 'chats'), where('sessionId', '==', sessionId), orderBy('createdAt', 'asc'));
        const snap = await getDocs(q);
        setChatLogs(snap.docs.map(d => d.data() as ChatMessage));
      } catch (e) {
          const q2 = query(collection(db, 'chats'), where('sessionId', '==', sessionId));
          const snap2 = await getDocs(q2);
          const chats = snap2.docs.map(d => d.data() as ChatMessage);
          chats.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
          setChatLogs(chats);
      }
  };

  const handleUpdateUser = async (targetUid: string, updates: any) => {
    try {
        const response = await fetch('/api/admin/update-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                adminUid: user.uid,
                targetUserId: targetUid,
                updates: updates 
            })
        });

        if (!response.ok) throw new Error("Update failed");
        setUsers(prev => prev.map(u => u.uid === targetUid ? { ...u, ...updates } : u));
        setEditingUserId(null); 
    } catch (e) {
        alert("Failed to update user.");
    }
  };

  const updateUserStatus = async (uid: string, status: 'approved' | 'banned' | 'pending') => {
    handleUpdateUser(uid, { status });
    fetchMetrics();
  };

  const deleteUser = async (uid: string) => {
    if(!confirm("⚠️ PERMANENTLY DELETE USER & ALL DATA?")) return;
    setProcessingAction(true);
    try {
        const response = await fetch('/api/admin/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, adminUid: user.uid })
        });
        if (!response.ok) throw new Error('Failed');
        setUsers(prev => prev.filter(u => u.uid !== uid));
        fetchMetrics();
        if (selectedUserForChat?.uid === uid) handleCloseInspector();
    } catch (e: any) {
        alert(`Failed to delete user: ${e.message}`);
    } finally {
        setProcessingAction(false);
    }
  };

  const deleteSessionPermanently = async (sessionId: string) => {
      if(!confirm("⚠️ PERMANENTLY DELETE RECORD?")) return;
      try {
          const chatsQuery = query(collection(db, 'chats'), where('sessionId', '==', sessionId));
          const chatsSnapshot = await getDocs(chatsQuery);
          const batch = writeBatch(db);
          chatsSnapshot.docs.forEach((doc) => batch.delete(doc.ref));
          batch.delete(doc(db, 'sessions', sessionId));
          await batch.commit();

          setUserSessions(prev => prev.filter(s => s.id !== sessionId));
          if (activeSessionId === sessionId) {
              setActiveSessionId(null);
              setChatLogs([]);
              router.push(`?tab=chats&uid=${selectedUserForChat?.uid}`);
          }
          alert("Record permanently expunged.");
      } catch (err) {
          alert("Failed to delete records.");
      }
  };

  const copyTranscript = () => {
      const text = chatLogs.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
      navigator.clipboard.writeText(text);
      alert("Transcript copied to clipboard.");
  };

  const exportToCSV = () => {
    const headers = ['UID', 'Name', 'Email', 'Role', 'Status', 'Tier', 'Quota', 'Joined'];
    const rows = users.map(u => [
        u.uid, u.displayName || 'N/A', u.email || 'N/A', u.role, u.status, u.tier || 'free', u.customQuota || 50,
        u.createdAt?.toDate ? new Date(u.createdAt.toDate()).toLocaleDateString() : 'N/A'
    ]);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].map(e => e.join(",")).join("\n");
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `users_export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) return <div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center font-mono">Loading Portal...</div>;
  if (!user || !isAdmin) return <Login />;

  const filteredUsers = users.filter(u => {
    const matchesSearch = (u.email || '').toLowerCase().includes(search.toLowerCase()) || 
                          (u.displayName || '').toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'all' || u.status === filterStatus || (filterStatus === 'admin' && u.role === 'admin');
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex h-screen bg-[#09090b] text-gray-100 font-sans overflow-hidden relative">
      
      {/* Processing Overlay */}
      {processingAction && (
        <div className="absolute inset-0 bg-black/80 z-[100] flex items-center justify-center flex-col gap-4 backdrop-blur-sm">
            <Loader2 size={48} className="text-red-500 animate-spin" />
            <div className="text-white font-bold text-lg">Processing...</div>
        </div>
      )}

      {/* ✅ MOBILE MENU OVERLAY */}
      {isSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm" onClick={() => setIsSidebarOpen(false)} />}

      {/* ✅ RESPONSIVE SIDEBAR */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-64 border-r border-white/10 bg-[#0c0c0e] flex flex-col shadow-2xl transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <div className="flex flex-col">
              <h1 className="text-lg font-bold bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent flex items-center gap-2">
                  <Shield size={18} className="text-red-500" /> ADMIN PORTAL
              </h1>
              <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest pl-1">Authorized Personnel Only</p>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="md:hidden text-gray-400 hover:text-white"><X size={20} /></button>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
            <button onClick={() => router.push('/')} className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all text-white bg-blue-600 hover:bg-blue-500 mb-4">
                <Home size={18} /> Return to App
            </button>
            <button onClick={() => handleSwitchTab('dashboard')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' : 'text-gray-400 hover:bg-white/5'}`}>
                <BarChart3 size={18} /> Dashboard
            </button>
            <button onClick={() => { handleSwitchTab('users'); handleCloseInspector(); }} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'users' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'text-gray-400 hover:bg-white/5'}`}>
                <Users size={18} /> User Management
            </button>
            <button onClick={() => handleSwitchTab('chats')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'chats' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-gray-400 hover:bg-white/5'}`}>
                <MessageSquare size={18} /> Chat Inspector
            </button>
            <button onClick={() => handleSwitchTab('support')} className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'support' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'text-gray-400 hover:bg-white/5'}`}>
                <LifeBuoy size={18} /> Support Center
            </button>
        </nav>

        <div className="p-4 border-t border-white/5">
            <button onClick={() => signOut(auth)} className="w-full flex items-center gap-2 px-4 py-3 text-xs font-semibold text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition-colors">
                <LogOut size={14} /> Secure Logout
            </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-hidden flex flex-col bg-[#050505] w-full">
        
        {/* ✅ RESPONSIVE TOP BAR */}
        <header className="h-16 border-b border-white/10 bg-[#09090b]/90 backdrop-blur-md flex items-center justify-between px-4 md:px-8 z-10 shrink-0">
            <div className="flex items-center gap-3">
                <button onClick={() => setIsSidebarOpen(true)} className="md:hidden text-gray-400 hover:text-white"><Menu size={20} /></button>
                <div className={`hidden md:block w-2 h-2 rounded-full ${activeTab === 'dashboard' ? 'bg-orange-500' : activeTab === 'users' ? 'bg-red-500' : activeTab === 'support' ? 'bg-green-500' : 'bg-blue-500'} animate-pulse`}></div>
                <h2 className="font-semibold text-sm tracking-wide text-gray-200 uppercase truncate">
                    {activeTab === 'dashboard' ? 'System Overview' : activeTab === 'users' ? 'User Database' : activeTab === 'support' ? 'Support Center' : 'Forensic Inspector'}
                </h2>
            </div>
            
            {activeTab === 'users' && (
                <div className="flex items-center gap-2 md:gap-4">
                     <button onClick={exportToCSV} className="hidden md:flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-white transition-colors bg-white/5 px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10">
                         <Download size={14} /> Export CSV
                     </button>
                    <div className="relative group">
                        <div className="flex items-center gap-2 bg-[#18181b] border border-white/10 rounded-full px-3 py-1.5 md:px-4 text-xs text-white">
                            <Filter size={12} className="text-gray-500" />
                            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)} className="bg-transparent focus:outline-none appearance-none cursor-pointer max-w-[80px] md:max-w-none truncate">
                                <option value="all">All</option>
                                <option value="approved">Approved</option>
                                <option value="pending">Pending</option>
                                <option value="banned">Banned</option>
                                <option value="admin">Admins</option> 
                            </select>
                        </div>
                    </div>
                    <div className="relative hidden md:block">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-[#18181b] border border-white/10 rounded-full pl-9 pr-4 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 transition-all w-48 lg:w-64" />
                    </div>
                </div>
            )}
        </header>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6" id="scroll-container">
            
            {/* 0. DASHBOARD TAB */}
            {activeTab === 'dashboard' && (
                <div className="max-w-6xl mx-auto space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-[#0c0c0e] p-5 rounded-xl border border-white/5 shadow-lg relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><Users size={64} /></div>
                            <div className="text-gray-500 text-xs font-bold uppercase tracking-widest mb-1">Total Users</div>
                            <div className="text-3xl font-bold text-white">{serverMetrics.total}</div>
                            <div className="text-[10px] text-gray-600 mt-2">Registered Accounts</div>
                        </div>
                        <div className="bg-[#0c0c0e] p-5 rounded-xl border border-white/5 shadow-lg relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><CheckCircle size={64} className="text-green-500" /></div>
                            <div className="text-green-500/70 text-xs font-bold uppercase tracking-widest mb-1">Active Users</div>
                            <div className="text-3xl font-bold text-green-400">{serverMetrics.active}</div>
                            <div className="text-[10px] text-gray-600 mt-2">Approved Access</div>
                        </div>
                        <div className="bg-[#0c0c0e] p-5 rounded-xl border border-yellow-500/20 shadow-lg relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><AlertCircle size={64} className="text-yellow-500" /></div>
                            <div className="text-yellow-500/70 text-xs font-bold uppercase tracking-widest mb-1">Pending</div>
                            <div className="text-3xl font-bold text-yellow-400">{serverMetrics.pending}</div>
                            <div className="text-[10px] text-gray-600 mt-2">Action Required</div>
                        </div>
                          <div className="bg-[#0c0c0e] p-5 rounded-xl border border-red-500/20 shadow-lg relative overflow-hidden group">
                            <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity"><Ban size={64} className="text-red-500" /></div>
                            <div className="text-red-500/70 text-xs font-bold uppercase tracking-widest mb-1">Banned</div>
                            <div className="text-3xl font-bold text-red-400">{serverMetrics.banned}</div>
                            <div className="text-[10px] text-gray-600 mt-2">Access Revoked</div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="bg-[#0c0c0e] rounded-xl border border-white/5 overflow-hidden shadow-lg flex flex-col">
                            <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
                                <Activity size={14} className="text-blue-400" />
                                <span className="text-xs font-bold uppercase tracking-widest text-gray-400">System Health</span>
                            </div>
                            <div className="p-6 flex-1 flex flex-col justify-center items-center gap-4 opacity-50 min-h-[150px]">
                                <div className="w-16 h-16 rounded-full border-4 border-green-500/20 border-t-green-500 animate-spin"></div>
                                <p className="text-xs text-gray-500">Database Connection Stable</p>
                            </div>
                        </div>

                        <div className="bg-[#0c0c0e] rounded-xl border border-white/5 overflow-hidden shadow-lg flex flex-col">
                             <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <AlertCircle size={14} className="text-yellow-400" />
                                    <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Pending Approvals</span>
                                </div>
                                <button onClick={() => handleSwitchTab('users')} className="text-[10px] text-blue-400 hover:underline">View All</button>
                            </div>
                            <div className="flex-1 overflow-y-auto max-h-64 p-2 min-h-[150px]">
                                {serverMetrics.pending === 0 ? (
                                    <div className="flex h-full items-center justify-center text-gray-600 text-xs py-8">No pending requests.</div>
                                ) : (
                                    <div className="text-center p-4 text-xs text-gray-500">Check User Management tab for pending users.</div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 1. USER MANAGEMENT TAB */}
            {activeTab === 'users' && (
                <div className="bg-[#0c0c0e] rounded-xl border border-white/5 overflow-hidden shadow-2xl flex flex-col h-full">
                    {/* ✅ Responsive Table Wrapper */}
                    <div className="flex-1 overflow-y-auto overflow-x-auto">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead>
                                <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] uppercase tracking-widest text-gray-500 sticky top-0 z-10 backdrop-blur-md">
                                    <th className="p-4 pl-6">User</th>
                                    <th className="p-4">Role</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4">Tier</th>
                                    <th className="p-4">Quota</th>
                                    <th className="p-4">Joined</th>
                                    <th className="p-4 text-right pr-6">Controls</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredUsers.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="p-8 text-center text-gray-500 text-sm">No users found matching filters.</td>
                                    </tr>
                                )}
                                {filteredUsers.map((u) => (
                                    <tr key={u.uid} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="p-4 pl-6">
                                            <div className="flex items-center gap-3">
                                                {u.photoURL ? <img src={u.photoURL} className="w-9 h-9 rounded-md border border-white/10" /> : <div className="w-9 h-9 rounded-md bg-white/5 flex items-center justify-center text-gray-400 font-bold border border-white/10">{u.email?.[0]?.toUpperCase() || '?'}</div>}
                                                <div>
                                                    <div className="font-medium text-white text-sm group-hover:text-red-400 transition-colors">{u.displayName || 'No Name'}</div>
                                                    <div className="text-[11px] text-gray-500 font-mono">{u.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-xs text-gray-400 font-mono">{u.role === 'admin' ? <span className="text-red-400 font-bold bg-red-900/10 px-2 py-0.5 rounded">ADMIN</span> : 'User'}</td>
                                        <td className="p-4"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${u.status === 'approved' ? 'bg-green-900/20 text-green-400 border-green-500/20' : u.status === 'banned' ? 'bg-red-900/20 text-red-400 border-red-500/20' : 'bg-yellow-900/20 text-yellow-400 border-yellow-500/20 animate-pulse'}`}>{u.status}</span></td>
                                        <td className="p-4">{u.tier === 'pro' ? <span className="flex items-center gap-1 text-[10px] font-bold text-yellow-400 bg-yellow-900/20 px-2 py-0.5 rounded border border-yellow-500/30"><Crown size={10} fill="currentColor" /> PRO</span> : <span className="text-[10px] font-bold text-gray-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">FREE</span>}</td>
                                        <td className="p-4 text-xs text-gray-400 font-mono">{u.tier === 'pro' ? '∞' : (u.customQuota || 50)}</td>
                                        <td className="p-4 text-xs text-gray-500">{u.createdAt?.toDate ? new Date(u.createdAt.toDate()).toLocaleDateString() : 'Unknown'}</td>
                                        <td className="p-4 text-right pr-6">
                                            <div className="flex items-center justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => loadUserSessions(u)} className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors" title="View Chat History"><Eye size={16} /></button>
                                                <button onClick={() => { if (editingUserId === u.uid) { setEditingUserId(null); } else { setEditingUserId(u.uid); setTempQuota((u.customQuota || 50).toString()); } }} className={`p-2 rounded-md transition-colors ${editingUserId === u.uid ? 'text-white bg-white/10' : 'text-yellow-400 hover:bg-yellow-500/10'}`} title="Edit Tier & Limits"><Edit3 size={16} /></button>
                                                {editingUserId !== u.uid && (
                                                    <>
                                                        {u.status !== 'approved' && <button onClick={() => updateUserStatus(u.uid, 'approved')} className="p-2 text-green-400 hover:bg-green-500/10 rounded-md transition-colors" title="Approve"><CheckCircle size={16} /></button>}
                                                        {u.status !== 'banned' && u.role !== 'admin' && <button onClick={() => updateUserStatus(u.uid, 'banned')} className="p-2 text-orange-400 hover:bg-orange-500/10 rounded-md transition-colors" title="Ban User"><Ban size={16} /></button>}
                                                        {u.role !== 'admin' && <button onClick={() => deleteUser(u.uid)} className="p-2 text-red-400 hover:bg-red-500/10 rounded-md transition-colors" title="Delete User & Data"><Trash2 size={16} /></button>}
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {editingUserId && (
                                    <tr className="bg-[#151517] border-b border-white/5 animate-in slide-in-from-top-2">
                                        <td colSpan={7} className="p-4">
                                            <div className="flex items-center justify-between gap-4">
                                                <div className="flex items-center gap-4">
                                                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Editing Limits</span>
                                                    <div className="flex items-center bg-black/30 rounded-lg p-1 border border-white/10">
                                                        <button onClick={() => handleUpdateUser(editingUserId, { tier: 'free' })} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${users.find(u => u.uid === editingUserId)?.tier !== 'pro' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-white'}`}>FREE</button>
                                                        <button onClick={() => handleUpdateUser(editingUserId, { tier: 'pro' })} className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all flex items-center gap-1 ${users.find(u => u.uid === editingUserId)?.tier === 'pro' ? 'bg-yellow-600 text-white' : 'text-yellow-600 hover:text-yellow-400'}`}><Crown size={12} fill="currentColor" /> PRO</button>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <label className="text-xs text-gray-500">Daily Limit:</label>
                                                        <input type="number" value={tempQuota} onChange={(e) => setTempQuota(e.target.value)} className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-xs text-white w-20 focus:outline-none focus:border-blue-500" />
                                                        <button onClick={() => handleUpdateUser(editingUserId, { customQuota: parseInt(tempQuota) || 50 })} className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors" title="Save Limit"><Save size={14} /></button>
                                                    </div>
                                                </div>
                                                <button onClick={() => setEditingUserId(null)} className="text-xs text-gray-500 hover:text-white">Cancel</button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    {/* Load More Button */}
                    {hasMoreUsers && !search && (
                        <div className="p-4 border-t border-white/5 flex justify-center bg-[#0c0c0e]">
                            <button onClick={() => fetchUsers()} disabled={fetchingUsers} className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-xs text-gray-300 transition-colors disabled:opacity-50">
                                {fetchingUsers ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
                                {fetchingUsers ? 'Loading...' : 'Load More Users'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* 2. CHAT INSPECTOR TAB */}
            {activeTab === 'chats' && (
                <div className="flex h-full gap-6 flex-col md:flex-row">
                    {/* Session List */}
                    <div className={`w-full md:w-80 bg-[#0c0c0e] rounded-xl border border-white/5 overflow-hidden flex flex-col shadow-xl ${activeSessionId ? 'hidden md:flex' : 'flex'}`}>
                        <div className="p-4 border-b border-white/5 bg-white/[0.02] font-medium text-xs text-gray-400 uppercase tracking-widest flex justify-between items-center">
                            <span className="truncate">{selectedUserForChat ? selectedUserForChat.displayName : 'Select User'}</span>
                            {selectedUserForChat && <button onClick={handleCloseInspector} className="text-gray-500 hover:text-white"><X size={14}/></button>}
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar min-h-[300px] md:min-h-0">
                            {!selectedUserForChat && <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-40"><Users size={32} className="mb-2" /><p className="text-xs">Go to User Database<br/>click Eye icon.</p></div>}
                            {userSessions.length === 0 && selectedUserForChat && <div className="text-center p-6 text-xs text-gray-500">No chat history found.</div>}
                            {userSessions.map(sess => (
                                <div key={sess.id} onClick={() => loadChatLogs(sess.id)} className={`group p-3 rounded-lg cursor-pointer text-sm transition-all border relative ${activeSessionId === sess.id ? 'bg-blue-500/10 border-blue-500/30 text-blue-200' : 'bg-transparent border-transparent text-gray-400 hover:bg-white/5'}`}>
                                    <div className="flex justify-between items-start">
                                        <div className="font-medium truncate pr-2">{sess.title}</div>
                                        <button onClick={(e) => { e.stopPropagation(); deleteSessionPermanently(sess.id); }} className="opacity-100 md:opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity" title="Permanently Delete Session"><Trash2 size={12} /></button>
                                    </div>
                                    <div className="flex justify-between items-end mt-1">
                                        <div className="text-[10px] opacity-50 font-mono flex items-center gap-1"><Clock size={10} />{sess.createdAt?.toDate ? new Date(sess.createdAt.toDate()).toLocaleDateString() : ''}</div>
                                        {sess.deletedByUser && <span className="text-[9px] bg-red-900/30 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">User Deleted</span>}
                                    </div>
                                </div>
                            ))}
                            {selectedUserForChat && hasMoreSessions && <button onClick={() => fetchSessions(selectedUserForChat.uid)} disabled={fetchingSessions} className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg transition-colors flex items-center justify-center gap-2">{fetchingSessions ? <Loader2 size={12} className="animate-spin" /> : <ChevronDown size={12} />} Load More Sessions</button>}
                        </div>
                    </div>

                    {/* Chat Logs */}
                    <div className={`flex-1 bg-[#0c0c0e] rounded-xl border border-white/5 overflow-hidden flex flex-col shadow-xl ${activeSessionId ? 'flex' : 'hidden md:flex'}`}>
                        <div className="p-4 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
                             <div className="font-medium text-xs text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <button onClick={() => setActiveSessionId(null)} className="md:hidden text-gray-300 mr-2"><ArrowLeft size={18} /></button>
                                <span>Transcript View</span>
                                {activeSessionId && userSessions.find(s => s.id === activeSessionId)?.deletedByUser && <span className="text-red-500 flex items-center gap-1 bg-red-900/10 px-2 py-0.5 rounded border border-red-500/20"><Archive size={12} /> DELETED BY USER</span>}
                             </div>
                             {activeSessionId && (
                                 <div className="flex items-center gap-2">
                                     <button onClick={copyTranscript} className="text-xs flex items-center gap-1 text-gray-400 hover:text-white px-2 py-1 hover:bg-white/5 rounded transition-colors"><Copy size={12} /> Copy</button>
                                     <button onClick={() => deleteSessionPermanently(activeSessionId)} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 px-2 py-1 hover:bg-red-500/10 rounded transition-colors border border-red-500/20"><Trash2 size={12} /> Delete Record</button>
                                 </div>
                             )}
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-8 custom-scrollbar bg-[#050505] min-h-[400px]">
                            {!activeSessionId && <div className="flex h-full items-center justify-center text-gray-600 text-xs uppercase tracking-widest">Select a session to inspect</div>}
                            {chatLogs.map((msg, i) => (
                                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`text-[9px] mb-2 uppercase font-bold tracking-widest px-1 flex items-center gap-1 ${msg.role === 'user' ? 'text-gray-500' : 'text-blue-500'}`}>{msg.role === 'assistant' && <Terminal size={10} />}{msg.role} {msg.provider && `(${msg.provider})`}</div>
                                    <div className={`max-w-[90%] md:max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-[#1e1f20] text-gray-200 rounded-tr-sm' : 'bg-blue-900/10 text-blue-100 border border-blue-500/20 rounded-tl-sm'}`}>
                                        {msg.image && (<div className="mb-3 rounded-lg overflow-hidden border border-white/10 bg-black relative group"><img src={msg.image} alt="User Attachment" className="max-w-full h-auto max-h-60 object-contain mx-auto" /><div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><a href={msg.image} target="_blank" rel="noopener noreferrer" className="text-xs text-white underline">Open Original</a></div><div className="bg-[#111] py-1 px-2 text-[9px] text-gray-500 flex items-center gap-1 justify-center border-t border-white/5"><ImageIcon size={10} /> Image Attachment</div></div>)}
                                        <AdminMarkdownRenderer content={msg.content || ""} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* 3. ✅ SUPPORT CENTER TAB (RESPONSIVE) */}
            {activeTab === 'support' && (
                <div className="flex h-full gap-6 flex-col md:flex-row">
                    {/* List of Cases */}
                    <div className={`w-full md:w-80 bg-[#0c0c0e] rounded-xl border border-white/5 flex flex-col shadow-xl overflow-hidden ${activeSupportCase ? 'hidden md:flex' : 'flex'}`}>
                        <div className="p-4 border-b border-white/5 bg-white/[0.02] flex items-center gap-2">
                            <Mail size={16} className="text-blue-400" />
                            <span className="font-bold text-gray-300 text-xs uppercase tracking-widest">Active Cases</span>
                        </div>
                        <SupportCaseList 
                            onSelect={(caseItem) => setActiveSupportCase(caseItem)} 
                            selectedId={activeSupportCase?.id}
                        /> 
                    </div>
                    
                    {/* Case View */}
                    <div className={`flex-1 bg-[#0c0c0e] rounded-xl border border-white/5 flex flex-col shadow-xl overflow-hidden ${activeSupportCase ? 'flex' : 'hidden md:flex'}`}>
                        {activeSupportCase ? (
                            <AdminSupportView activeCase={activeSupportCase} onClear={() => setActiveSupportCase(null)} />
                        ) : (
                            <div className="flex h-full flex-col items-center justify-center text-gray-500 gap-4 opacity-50">
                                <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center">
                                    <MessageSquare size={32} />
                                </div>
                                <span className="text-xs uppercase tracking-widest">Select a support case to view details</span>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
}

// ✅ DEFAULT EXPORT WRAPPED IN SUSPENSE
export default function AdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center font-mono">Initializing Admin Portal...</div>}>
      <AdminContent />
    </Suspense>
  );
}