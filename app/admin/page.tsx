'use client';
// ✅ Keep this to force dynamic rendering
export const dynamic = 'force-dynamic';

import { useState, useEffect, Suspense } from 'react'; // ✅ Added Suspense
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
  BarChart3, Download, Filter, AlertCircle, Activity, Copy, Archive, Loader2, ChevronDown
} from 'lucide-react';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { 
  collection, query, where, orderBy, onSnapshot, doc, updateDoc, getDocs, writeBatch, 
  limit, startAfter, getCountFromServer, QueryDocumentSnapshot, DocumentData, getDoc 
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

// --- COMPONENTS ---

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

// ⚠️ MAIN LOGIC MOVED INTO A SEPARATE COMPONENT
function AdminContent() {
  const [user, setUser] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [processingAction, setProcessingAction] = useState(false); 
  const router = useRouter();
  const searchParams = useSearchParams(); // ✅ Safe to use here now

  // Admin Data with Pagination
  const [users, setUsers] = useState<UserData[]>([]);
  const [lastVisible, setLastVisible] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [fetchingUsers, setFetchingUsers] = useState(false);
  const [hasMoreUsers, setHasMoreUsers] = useState(true);
  
  // Metrics State
  const [serverMetrics, setServerMetrics] = useState({
      total: 0,
      active: 0,
      pending: 0,
      banned: 0,
      admins: 0
  });

  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'approved' | 'banned'>('all');
  
  // Tabs & Navigation State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'users' | 'chats'>('dashboard');

  // Chat Inspector State
  const [selectedUserForChat, setSelectedUserForChat] = useState<UserData | null>(null);
  const [userSessions, setUserSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [chatLogs, setChatLogs] = useState<ChatMessage[]>([]);

  // 1. AUTH CHECK & STATE RESTORATION
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        const docRef = doc(db, 'users', currentUser.uid);
        onSnapshot(docRef, async (docSnap) => {
             const data = docSnap.data();
             if (data && data.role === 'admin') {
                 setUser(currentUser);
                 setIsAdmin(true);
                 
                 // --- RESTORE STATE FROM URL ---
                 const tabParam = searchParams.get('tab');
                 const uidParam = searchParams.get('uid');
                 const sessionParam = searchParams.get('sessionId');

                 if (tabParam === 'users' || tabParam === 'chats' || tabParam === 'dashboard') {
                     setActiveTab(tabParam);
                 }

                 // If we are in 'chats' and have a UID, load that user's sessions
                 if (tabParam === 'chats' && uidParam) {
                     try {
                         const userDoc = await getDoc(doc(db, 'users', uidParam));
                         if (userDoc.exists()) {
                             const targetUser = { uid: userDoc.id, ...userDoc.data() } as UserData;
                             setSelectedUserForChat(targetUser);
                             
                             // Fetch sessions for this user
                             const q = query(collection(db, 'sessions'), where('userId', '==', targetUser.uid), orderBy('createdAt', 'desc'));
                             const snap = await getDocs(q);
                             const fetchedSessions = snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));
                             setUserSessions(fetchedSessions);

                             // If we also have a Session ID, load that chat
                             if (sessionParam) {
                                 setActiveSessionId(sessionParam);
                                 // Fetch chat logs
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
        setLoading(false);
      }
    });
    return () => unsub();
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

          if (filterStatus !== 'all') {
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

  // 3. FETCH METRICS
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

  // 4. NAVIGATION & ACTIONS
  const handleSwitchTab = (tab: 'dashboard' | 'users' | 'chats') => {
      setActiveTab(tab);
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

      try {
        const q = query(collection(db, 'sessions'), where('userId', '==', targetUser.uid), orderBy('createdAt', 'desc'));
        const snap = await getDocs(q);
        setUserSessions(snap.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession)));
      } catch (e) {
          const q2 = query(collection(db, 'sessions'), where('userId', '==', targetUser.uid));
          const snap2 = await getDocs(q2);
          const sessions = snap2.docs.map(d => ({ id: d.id, ...d.data() } as ChatSession));
          sessions.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
          setUserSessions(sessions);
      }
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

  const updateUserStatus = async (uid: string, status: 'approved' | 'banned' | 'pending') => {
    try { 
        await updateDoc(doc(db, 'users', uid), { status }); 
        setUsers(prev => prev.map(u => u.uid === uid ? { ...u, status } : u));
        fetchMetrics();
    } 
    catch (e) { alert("Failed to update status."); }
  };

  const deleteUser = async (uid: string) => {
    if(!confirm("⚠️ PERMANENTLY DELETE USER & ALL DATA?\n\nThis will wipe:\n1. User Profile\n2. ALL Chat Sessions\n3. ALL Message History\n\nIf they login again, they will be a brand new user.\n\nAre you sure?")) return;
    
    setProcessingAction(true);
    try {
        const response = await fetch('/api/admin/delete-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid, adminUid: user.uid })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to delete user');
        }

        alert("User and all associated history have been permanently expunged.");
        setUsers(prev => prev.filter(u => u.uid !== uid));
        fetchMetrics();

        if (selectedUserForChat?.uid === uid) {
            handleCloseInspector();
        }

    } catch (e: any) {
        console.error("Error deleting user:", e);
        alert(`Failed to delete user: ${e.message}`);
    } finally {
        setProcessingAction(false);
    }
  };

  const deleteSessionPermanently = async (sessionId: string) => {
      if(!confirm("⚠️ PERMANENTLY DELETE RECORD?\n\nThis will completely wipe the session and all its messages from the database.\n\nEven Admins cannot recover this.")) return;
      
      try {
          const chatsQuery = query(collection(db, 'chats'), where('sessionId', '==', sessionId));
          const chatsSnapshot = await getDocs(chatsQuery);
          const batch = writeBatch(db);
          
          chatsSnapshot.docs.forEach((doc) => {
              batch.delete(doc.ref);
          });

          batch.delete(doc(db, 'sessions', sessionId));
          await batch.commit();

          setUserSessions(prev => prev.filter(s => s.id !== sessionId));
          if (activeSessionId === sessionId) {
              setActiveSessionId(null);
              setChatLogs([]);
              const params = new URLSearchParams(searchParams.toString());
              params.delete('sessionId');
              router.push(`?${params.toString()}`);
          }
          alert("Record permanently expunged.");
      } catch (err) {
          console.error(err);
          alert("Failed to delete records.");
      }
  };

  const copyTranscript = () => {
      const text = chatLogs.map(m => `[${m.role.toUpperCase()}]: ${m.content}`).join('\n\n');
      navigator.clipboard.writeText(text);
      alert("Transcript copied to clipboard.");
  };

  const exportToCSV = () => {
    const headers = ['UID', 'Name', 'Email', 'Role', 'Status', 'Joined'];
    const rows = users.map(u => [
        u.uid, 
        u.displayName || 'N/A', 
        u.email || 'N/A', 
        u.role, 
        u.status, 
        u.createdAt?.toDate ? new Date(u.createdAt.toDate()).toLocaleDateString() : 'N/A'
    ]);
    
    const csvContent = "data:text/csv;charset=utf-8," 
        + [headers, ...rows].map(e => e.join(",")).join("\n");
        
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
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
    const matchesStatus = filterStatus === 'all' || u.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="flex h-screen bg-[#09090b] text-gray-100 font-sans overflow-hidden relative">
      
      {/* Processing Overlay */}
      {processingAction && (
        <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center flex-col gap-4 backdrop-blur-sm">
            <Loader2 size={48} className="text-red-500 animate-spin" />
            <div className="text-white font-bold text-lg">Server-Side Deletion in Progress...</div>
            <div className="text-gray-400 text-sm">Recursively removing user data via secure API.</div>
        </div>
      )}

      {/* SIDEBAR */}
      <aside className="w-64 border-r border-white/10 bg-[#0c0c0e] flex flex-col shadow-2xl z-20">
        <div className="p-6 border-b border-white/5">
            <h1 className="text-lg font-bold bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent flex items-center gap-2">
               <Shield size={18} className="text-red-500" /> ADMIN PORTAL
            </h1>
            <p className="text-[10px] text-gray-500 mt-1 uppercase tracking-widest pl-1">Authorized Personnel Only</p>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
            <button 
                onClick={() => handleSwitchTab('dashboard')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20' : 'text-gray-400 hover:bg-white/5'}`}
            >
                <BarChart3 size={18} /> Dashboard
            </button>
            <button 
                onClick={() => { handleSwitchTab('users'); handleCloseInspector(); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'users' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'text-gray-400 hover:bg-white/5'}`}
            >
                <Users size={18} /> User Management
            </button>
            <button 
                onClick={() => handleSwitchTab('chats')}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'chats' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' : 'text-gray-400 hover:bg-white/5'}`}
            >
                <MessageSquare size={18} /> Chat Inspector
            </button>
        </nav>

        <div className="p-4 border-t border-white/5">
            <button onClick={() => signOut(auth)} className="w-full flex items-center gap-2 px-4 py-3 text-xs font-semibold text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition-colors">
                <LogOut size={14} /> Secure Logout
            </button>
        </div>
      </aside>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-hidden flex flex-col bg-[#050505]">
        
        {/* TOP BAR */}
        <header className="h-16 border-b border-white/10 bg-[#09090b]/90 backdrop-blur-md flex items-center justify-between px-8 z-10">
            <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${
                    activeTab === 'dashboard' ? 'bg-orange-500' :
                    activeTab === 'users' ? 'bg-red-500' : 'bg-blue-500'
                } animate-pulse`}></div>
                <h2 className="font-semibold text-sm tracking-wide text-gray-200 uppercase">
                    {activeTab === 'dashboard' ? 'System Overview' : 
                     activeTab === 'users' ? 'User Database' : 'Forensic Inspector'}
                </h2>
            </div>
            
            {activeTab === 'users' && (
                <div className="flex items-center gap-4">
                     <button onClick={exportToCSV} className="flex items-center gap-2 text-xs font-medium text-gray-400 hover:text-white transition-colors bg-white/5 px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/10">
                        <Download size={14} /> Export CSV
                    </button>
                    <div className="relative group">
                        <div className="flex items-center gap-2 bg-[#18181b] border border-white/10 rounded-full px-4 py-1.5 text-xs text-white">
                            <Filter size={12} className="text-gray-500" />
                            <select 
                                value={filterStatus} 
                                onChange={(e) => setFilterStatus(e.target.value as any)}
                                className="bg-transparent focus:outline-none appearance-none cursor-pointer"
                            >
                                <option value="all">All Status</option>
                                <option value="approved">Approved</option>
                                <option value="pending">Pending</option>
                                <option value="banned">Banned</option>
                            </select>
                        </div>
                    </div>
                    <div className="relative">
                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                        <input 
                            type="text" 
                            placeholder="Search..." 
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="bg-[#18181b] border border-white/10 rounded-full pl-9 pr-4 py-1.5 text-xs text-white focus:outline-none focus:border-white/30 transition-all w-64"
                        />
                    </div>
                </div>
            )}
        </header>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto p-6" id="scroll-container">
            
            {/* 0. DASHBOARD TAB */}
            {activeTab === 'dashboard' && (
                <div className="max-w-6xl mx-auto space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
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
                            <div className="p-6 flex-1 flex flex-col justify-center items-center gap-4 opacity-50">
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
                            <div className="flex-1 overflow-y-auto max-h-64 p-2">
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
                    <div className="flex-1 overflow-y-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-white/5 bg-white/[0.02] text-[10px] uppercase tracking-widest text-gray-500 sticky top-0 z-10 backdrop-blur-md">
                                    <th className="p-4 pl-6">User</th>
                                    <th className="p-4">Role</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4">Joined</th>
                                    <th className="p-4 text-right pr-6">Controls</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                                {filteredUsers.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="p-8 text-center text-gray-500 text-sm">
                                            No users found matching filters.
                                        </td>
                                    </tr>
                                )}
                                {filteredUsers.map((u) => (
                                    <tr key={u.uid} className="hover:bg-white/[0.02] transition-colors group">
                                        <td className="p-4 pl-6">
                                            <div className="flex items-center gap-3">
                                                {u.photoURL ? (
                                                    <img src={u.photoURL} className="w-9 h-9 rounded-md border border-white/10" />
                                                ) : (
                                                    <div className="w-9 h-9 rounded-md bg-white/5 flex items-center justify-center text-gray-400 font-bold border border-white/10">
                                                        {u.email?.[0]?.toUpperCase() || '?'}
                                                    </div>
                                                )}
                                                <div>
                                                    <div className="font-medium text-white text-sm group-hover:text-red-400 transition-colors">{u.displayName || 'No Name'}</div>
                                                    <div className="text-[11px] text-gray-500 font-mono">{u.email}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="p-4 text-xs text-gray-400 font-mono">
                                            {u.role === 'admin' ? <span className="text-red-400 font-bold bg-red-900/10 px-2 py-0.5 rounded">ADMIN</span> : 'User'}
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
                                                u.status === 'approved' ? 'bg-green-900/20 text-green-400 border-green-500/20' :
                                                u.status === 'banned' ? 'bg-red-900/20 text-red-400 border-red-500/20' :
                                                'bg-yellow-900/20 text-yellow-400 border-yellow-500/20 animate-pulse'
                                            }`}>
                                                {u.status}
                                            </span>
                                        </td>
                                        <td className="p-4 text-xs text-gray-500">
                                            {u.createdAt?.toDate ? new Date(u.createdAt.toDate()).toLocaleDateString() : 'Unknown'}
                                        </td>
                                        <td className="p-4 text-right pr-6">
                                            <div className="flex items-center justify-end gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                                <button onClick={() => loadUserSessions(u)} className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors" title="View Chat History"><Eye size={16} /></button>
                                                
                                                {u.status !== 'approved' && (
                                                    <button onClick={() => updateUserStatus(u.uid, 'approved')} className="p-2 text-green-400 hover:bg-green-500/10 rounded-md transition-colors" title="Approve"><CheckCircle size={16} /></button>
                                                )}
                                                
                                                {u.status !== 'banned' && u.role !== 'admin' && (
                                                    <button onClick={() => updateUserStatus(u.uid, 'banned')} className="p-2 text-orange-400 hover:bg-orange-500/10 rounded-md transition-colors" title="Ban User"><Ban size={16} /></button>
                                                )}
                                                
                                                {u.role !== 'admin' && (
                                                    <button onClick={() => deleteUser(u.uid)} className="p-2 text-red-400 hover:bg-red-500/10 rounded-md transition-colors" title="Delete User & Data"><Trash2 size={16} /></button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {/* Load More Button */}
                    {hasMoreUsers && !search && (
                        <div className="p-4 border-t border-white/5 flex justify-center bg-[#0c0c0e]">
                            <button 
                                onClick={() => fetchUsers()} 
                                disabled={fetchingUsers}
                                className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 rounded-full text-xs text-gray-300 transition-colors disabled:opacity-50"
                            >
                                {fetchingUsers ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}
                                {fetchingUsers ? 'Loading...' : 'Load More Users'}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* 2. CHAT INSPECTOR TAB */}
            {activeTab === 'chats' && (
                <div className="flex h-full gap-6">
                    {/* Session List */}
                    <div className="w-80 bg-[#0c0c0e] rounded-xl border border-white/5 overflow-hidden flex flex-col shadow-xl">
                        <div className="p-4 border-b border-white/5 bg-white/[0.02] font-medium text-xs text-gray-400 uppercase tracking-widest flex justify-between items-center">
                            <span className="truncate">{selectedUserForChat ? selectedUserForChat.displayName : 'Select User'}</span>
                            {selectedUserForChat && <button onClick={handleCloseInspector} className="text-gray-500 hover:text-white"><X size={14}/></button>}
                        </div>
                        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                            {!selectedUserForChat && (
                                <div className="h-full flex flex-col items-center justify-center text-center p-6 opacity-40">
                                    <Users size={32} className="mb-2" />
                                    <p className="text-xs">Go to User Database<br/>click Eye icon.</p>
                                </div>
                            )}
                            {userSessions.length === 0 && selectedUserForChat && (
                                <div className="text-center p-6 text-xs text-gray-500">No chat history found.</div>
                            )}
                            {userSessions.map(sess => (
                                <div 
                                    key={sess.id} 
                                    onClick={() => loadChatLogs(sess.id)}
                                    className={`group p-3 rounded-lg cursor-pointer text-sm transition-all border relative ${activeSessionId === sess.id ? 'bg-blue-500/10 border-blue-500/30 text-blue-200' : 'bg-transparent border-transparent text-gray-400 hover:bg-white/5'}`}
                                >
                                    <div className="flex justify-between items-start">
                                        <div className="font-medium truncate pr-2">{sess.title}</div>
                                        {/* PERMANENT DELETE BUTTON */}
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); deleteSessionPermanently(sess.id); }}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                                            title="Permanently Delete Session"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    <div className="flex justify-between items-end mt-1">
                                        <div className="text-[10px] opacity-50 font-mono flex items-center gap-1">
                                            <Clock size={10} />
                                            {sess.createdAt?.toDate ? new Date(sess.createdAt.toDate()).toLocaleDateString() : ''}
                                        </div>
                                        {/* USER DELETED INDICATOR */}
                                        {sess.deletedByUser && (
                                            <span className="text-[9px] bg-red-900/30 text-red-400 border border-red-500/20 px-1.5 py-0.5 rounded uppercase font-bold tracking-wider">
                                                User Deleted
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Chat Logs */}
                    <div className="flex-1 bg-[#0c0c0e] rounded-xl border border-white/5 overflow-hidden flex flex-col shadow-xl">
                        <div className="p-4 border-b border-white/5 bg-white/[0.02] flex justify-between items-center">
                             <div className="font-medium text-xs text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                <span>Transcript View</span>
                                {activeSessionId && userSessions.find(s => s.id === activeSessionId)?.deletedByUser && (
                                    <span className="text-red-500 flex items-center gap-1 bg-red-900/10 px-2 py-0.5 rounded border border-red-500/20">
                                        <Archive size={12} /> DELETED BY USER
                                    </span>
                                )}
                             </div>
                             {activeSessionId && (
                                 <div className="flex items-center gap-2">
                                     <button onClick={copyTranscript} className="text-xs flex items-center gap-1 text-gray-400 hover:text-white px-2 py-1 hover:bg-white/5 rounded transition-colors">
                                         <Copy size={12} /> Copy
                                     </button>
                                     <button onClick={() => deleteSessionPermanently(activeSessionId)} className="text-xs flex items-center gap-1 text-red-400 hover:text-red-300 px-2 py-1 hover:bg-red-500/10 rounded transition-colors border border-red-500/20">
                                         <Trash2 size={12} /> Delete Record
                                     </button>
                                 </div>
                             )}
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-6 space-y-8 custom-scrollbar bg-[#050505]">
                            {!activeSessionId && <div className="flex h-full items-center justify-center text-gray-600 text-xs uppercase tracking-widest">Select a session to inspect</div>}
                            
                            {chatLogs.map((msg, i) => (
                                <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`text-[9px] mb-2 uppercase font-bold tracking-widest px-1 flex items-center gap-1 ${msg.role === 'user' ? 'text-gray-500' : 'text-blue-500'}`}>
                                        {msg.role === 'assistant' && <Terminal size={10} />}
                                        {msg.role} {msg.provider && `(${msg.provider})`}
                                    </div>
                                    
                                    <div className={`max-w-[80%] p-4 rounded-2xl text-sm leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-[#1e1f20] text-gray-200 rounded-tr-sm' : 'bg-blue-900/10 text-blue-100 border border-blue-500/20 rounded-tl-sm'}`}>
                                        
                                        {/* IMAGE RENDERER */}
                                        {msg.image && (
                                            <div className="mb-3 rounded-lg overflow-hidden border border-white/10 bg-black relative group">
                                                <img src={msg.image} alt="User Attachment" className="max-w-full h-auto max-h-60 object-contain mx-auto" />
                                                <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <a href={msg.image} target="_blank" rel="noopener noreferrer" className="text-xs text-white underline">Open Original</a>
                                                </div>
                                                <div className="bg-[#111] py-1 px-2 text-[9px] text-gray-500 flex items-center gap-1 justify-center border-t border-white/5">
                                                    <ImageIcon size={10} /> Image Attachment
                                                </div>
                                            </div>
                                        )}

                                        {/* Text Content (WITH MARKDOWN) */}
                                        <AdminMarkdownRenderer content={msg.content || ""} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
}

// ✅ NEW DEFAULT EXPORT WRAPPED IN SUSPENSE
export default function AdminPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#09090b] text-white flex items-center justify-center font-mono">Initializing Admin Portal...</div>}>
      <AdminContent />
    </Suspense>
  );
}