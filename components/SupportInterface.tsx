'use client';

import { useState, useEffect, useRef } from 'react';
import { 
  Send, AlertCircle, Clock, CheckCircle2, MessageSquare, Shield, Lock, RotateCcw, Plus 
} from 'lucide-react';
import { db } from '@/lib/firebase';
import { 
  collection, addDoc, doc, setDoc, onSnapshot, serverTimestamp, 
  query, orderBy, updateDoc, deleteDoc, getDocs, writeBatch 
} from 'firebase/firestore';

// ✅ Added 'resolved' to status types
type SupportStatus = 'loading' | 'none' | 'pending' | 'approved' | 'resolved';

export default function SupportInterface({ user }: { user: any }) {
  const [status, setStatus] = useState<SupportStatus>('loading');
  const [complaint, setComplaint] = useState('');
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 1. Check Status & Load Chat
  useEffect(() => {
    if (!user) return;
    const chatRef = doc(db, 'support_chats', user.uid);

    const unsub = onSnapshot(chatRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setStatus(data.status as SupportStatus);
      } else {
        setStatus('none');
      }
    });

    // Load Messages Subcollection
    const q = query(collection(chatRef, 'messages'), orderBy('createdAt', 'asc'));
    const unsubMsgs = onSnapshot(q, (snap) => {
      setMessages(snap.docs.map(d => d.data()));
      setTimeout(() => scrollRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    });

    return () => { unsub(); unsubMsgs(); };
  }, [user]);

  // 2. Submit Initial Complaint
  const submitComplaint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaint.trim()) return;

    try {
      await setDoc(doc(db, 'support_chats', user.uid), {
        userId: user.uid,
        email: user.email,
        displayName: user.displayName,
        status: 'pending', // <--- Waits for Admin Approval
        complaint: complaint,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      alert("Error submitting request.");
    }
  };

  // 3. Send Chat Message (Only when approved)
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    await addDoc(collection(db, 'support_chats', user.uid, 'messages'), {
      text: input,
      sender: 'user',
      createdAt: serverTimestamp()
    });
    // Update lastUpdated so it bumps up in Admin list
    await updateDoc(doc(db, 'support_chats', user.uid), { lastUpdated: serverTimestamp() });
    setInput('');
  };

  // 4. Action: Reopen Ticket
  const reopenTicket = async () => {
      await updateDoc(doc(db, 'support_chats', user.uid), { 
          status: 'pending',
          lastUpdated: serverTimestamp() 
      });
  };

  // 5. Action: Close & Start New
  const startNewTicket = async () => {
      if(!confirm("This will clear your current chat history. Continue?")) return;
      
      const batch = writeBatch(db);
      // Delete messages
      const msgs = await getDocs(collection(db, 'support_chats', user.uid, 'messages'));
      msgs.forEach(d => batch.delete(d.ref));
      // Delete doc
      batch.delete(doc(db, 'support_chats', user.uid));
      
      await batch.commit();
      setComplaint('');
  };

  if (status === 'loading') return <div className="p-10 text-center text-gray-500">Loading support data...</div>;

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-100px)] flex flex-col">
      
      {/* HEADER */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
          <Shield className="text-blue-500" /> Student Support
        </h1>
        <p className="text-gray-400">Direct line to TurboLearn Administrators.</p>
      </div>

      {/* STATE 1: NO TICKET -> SUBMIT FORM */}
      {status === 'none' && (
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-[#0c0c0e] border border-white/10 p-8 rounded-2xl max-w-lg w-full shadow-2xl">
            <div className="w-16 h-16 bg-blue-900/20 rounded-full flex items-center justify-center mx-auto mb-6 text-blue-400">
               <MessageSquare size={32} />
            </div>
            <h2 className="text-xl font-bold text-white text-center mb-2">Submit a Request</h2>
            <p className="text-gray-400 text-center text-sm mb-6">
              Describe your issue below. An admin must approve your request before live chat is enabled.
            </p>
            <form onSubmit={submitComplaint}>
              <textarea 
                className="w-full bg-[#18181b] border border-white/10 rounded-xl p-4 text-white focus:border-blue-500 outline-none min-h-[120px] mb-4"
                placeholder="I am having trouble with..."
                value={complaint}
                onChange={e => setComplaint(e.target.value)}
                required
              />
              <button className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all">
                Submit Request
              </button>
            </form>
          </div>
        </div>
      )}

      {/* STATE 2: PENDING APPROVAL */}
      {status === 'pending' && (
        <div className="flex-1 flex items-center justify-center">
           <div className="text-center max-w-md p-8 bg-yellow-900/5 border border-yellow-500/20 rounded-2xl animate-in fade-in zoom-in">
              <Clock size={64} className="mx-auto text-yellow-500 mb-6 animate-pulse" />
              <h2 className="text-2xl font-bold text-white mb-2">Review in Progress</h2>
              <p className="text-gray-400 mb-6">
                Your request has been sent. Please wait for an administrator to approve your case. 
                <br/><br/>
                <span className="text-yellow-500 text-sm bg-yellow-900/20 px-3 py-1 rounded-full">Status: Pending Approval</span>
              </p>
              <div className="text-xs text-gray-600 uppercase tracking-widest">Do not refresh. This page updates automatically.</div>
           </div>
        </div>
      )}

      {/* STATE 3: RESOLVED */}
      {status === 'resolved' && (
        <div className="flex-1 flex items-center justify-center">
           <div className="text-center max-w-md p-8 bg-green-900/5 border border-green-500/20 rounded-2xl animate-in fade-in zoom-in">
              <CheckCircle2 size={64} className="mx-auto text-green-500 mb-6" />
              <h2 className="text-2xl font-bold text-white mb-2">Issue Resolved</h2>
              <p className="text-gray-400 mb-8">
                An administrator has marked this conversation as resolved. 
                <br/>If you still need help, you can reopen this ticket or start a new one.
              </p>
              <div className="flex gap-3">
                  <button onClick={startNewTicket} className="flex-1 py-3 bg-white/5 hover:bg-white/10 text-white rounded-xl font-medium text-sm transition-all border border-white/10 flex items-center justify-center gap-2">
                      <Plus size={16} /> New Ticket
                  </button>
                  <button onClick={reopenTicket} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2">
                      <RotateCcw size={16} /> Reopen
                  </button>
              </div>
           </div>
        </div>
      )}

      {/* STATE 4: APPROVED -> LIVE CHAT */}
      {status === 'approved' && (
        <div className="flex-1 bg-[#0c0c0e] border border-white/10 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
          {/* Chat Header */}
          <div className="p-4 bg-white/5 border-b border-white/5 flex justify-between items-center">
             <div className="flex items-center gap-3">
               <div className="relative">
                 <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold">A</div>
                 <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-[#0c0c0e] rounded-full"></div>
               </div>
               <div>
                 <div className="font-bold text-white">Admin Support</div>
                 <div className="text-xs text-green-400 flex items-center gap-1"><Lock size={10} /> Secure Channel Active</div>
               </div>
             </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-[#050505]">
            {messages.length === 0 && <div className="text-center text-gray-600 text-sm mt-10">Channel approved. Start chatting...</div>}
            
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                 <div className={`max-w-[70%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    m.sender === 'user' 
                    ? 'bg-blue-600 text-white rounded-tr-sm' 
                    : 'bg-[#1e1f20] text-gray-200 border border-white/10 rounded-tl-sm'
                 }`}>
                    {m.text}
                 </div>
              </div>
            ))}
            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <form onSubmit={sendMessage} className="p-4 bg-[#0c0c0e] border-t border-white/5 flex gap-3">
             <input 
               className="flex-1 bg-[#18181b] border border-white/10 rounded-xl px-4 text-white focus:outline-none focus:border-blue-500"
               placeholder="Type a message..."
               value={input}
               onChange={e => setInput(e.target.value)}
             />
             <button disabled={!input.trim()} className="p-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl transition-colors disabled:opacity-50">
               <Send size={20} />
             </button>
          </form>
        </div>
      )}
    </div>
  );
}