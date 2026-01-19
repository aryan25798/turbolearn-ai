'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  LogIn, ArrowRight, ShieldAlert, Zap, ShieldCheck, Mail, Key, Loader2, 
  Sparkles, Cpu, Globe, Lock, CheckCircle2, HelpCircle, X, Send 
} from 'lucide-react';
import { auth, googleProvider, db } from '@/lib/firebase';
import { signInWithPopup, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot, addDoc, collection } from 'firebase/firestore';

export default function Login() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'pending' | 'banned' | 'success'>('idle');
  const [method, setMethod] = useState<'google' | 'email'>('google');
  
  // ✅ Support Modal State
  const [showSupport, setShowSupport] = useState(false);

  // Email/Pass State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 1. Real-time Status Listener
  useEffect(() => {
    let unsubscribe: () => void;
    if (status === 'pending' && auth.currentUser) {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      unsubscribe = onSnapshot(userRef, (docSnap) => {
        const data = docSnap.data();
        if (data?.status === 'approved') {
          setStatus('success');
          setTimeout(() => window.location.reload(), 800); 
        } else if (data?.status === 'banned') {
          setStatus('banned');
          signOut(auth);
        }
      });
    }
    return () => { if (unsubscribe) unsubscribe(); };
  }, [status]);

  const processUser = async (user: any) => {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      const isAdmin = user.email === 'admin@system.com'; // ⚠️ Ensure this matches your admin email
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'User',
        photoURL: user.photoURL,
        role: isAdmin ? 'admin' : 'user',
        status: isAdmin ? 'approved' : 'pending',
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
      });
      setStatus(isAdmin ? 'success' : 'pending');
    } else {
      const userData = userSnap.data();
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });
      if (userData.status === 'banned') {
        await signOut(auth);
        setStatus('banned');
      } else {
        setStatus(userData.status === 'pending' ? 'pending' : 'success');
      }
    }
  };

  const handleGoogleLogin = async () => {
    setStatus('loading');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await processUser(result.user);
    } catch (err) {
      console.error(err);
      setStatus('idle');
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await processUser(result.user);
    } catch (err) {
      alert("Invalid credentials.");
      setStatus('idle');
    }
  };

  // --- SPECIAL STATES ---
  if (status === 'pending') return <StatusScreen type="pending" action={async () => { await signOut(auth); setStatus('idle'); }} />;
  if (status === 'banned') return <StatusScreen type="banned" action={() => setStatus('idle')} />;
  if (status === 'success') return <StatusScreen type="success" />;

  // --- MAIN LAYOUT ---
  return (
    <div className="flex min-h-[100dvh] w-full bg-[#050505] text-white overflow-hidden font-sans selection:bg-blue-500/30">
      
      {/* ✅ GUEST SUPPORT MODAL */}
      <GuestSupportModal isOpen={showSupport} onClose={() => setShowSupport(false)} />

      {/* --- LEFT SIDE: HERO (Desktop Only) --- */}
      <div className="hidden lg:flex w-1/2 relative bg-[#0a0a0b] items-center justify-center overflow-hidden border-r border-white/5">
        {/* Animated Background Mesh */}
        <div className="absolute inset-0 opacity-20">
            <motion.div 
              animate={{ rotate: 360, scale: [1, 1.1, 1] }}
              transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
              className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] bg-blue-600/30 rounded-full blur-[120px]" 
            />
            <motion.div 
              animate={{ rotate: -360, scale: [1, 1.2, 1] }}
              transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
              className="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] bg-indigo-600/30 rounded-full blur-[120px]" 
            />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px]" />
        </div>

        <div className="relative z-10 p-12 max-w-lg">
            <motion.div 
              initial={{ opacity: 0, y: 20 }} 
              animate={{ opacity: 1, y: 0 }} 
              transition={{ duration: 0.8 }}
            >
              <div className="w-16 h-16 mb-8 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-0.5 shadow-2xl shadow-blue-500/20">
                 <div className="w-full h-full rounded-2xl bg-black flex items-center justify-center">
                    <img src="/icon.png" alt="Logo" className="w-full h-full object-cover opacity-90 rounded-2xl" />
                 </div>
              </div>
              <h1 className="text-5xl font-bold tracking-tight mb-6 leading-tight">
                Master your study workflow.
              </h1>
              <p className="text-lg text-gray-400 mb-8 leading-relaxed">
                TurboLearn AI connects you to the fastest dual-core reasoning engine. Upload, analyze, and learn in seconds.
              </p>
              
              {/* Feature Pills */}
              <div className="flex gap-3 flex-wrap">
                 <FeaturePill icon={<Zap size={14} className="text-yellow-400" />} text="Instant Answers" />
                 <FeaturePill icon={<Sparkles size={14} className="text-blue-400" />} text="GPT-4o Vision" />
                 <FeaturePill icon={<Cpu size={14} className="text-purple-400" />} text="Dual-Core" />
              </div>
            </motion.div>
        </div>
      </div>

      {/* --- RIGHT SIDE: FORM --- */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 relative bg-[#050505]">
         
         {/* Mobile Background Elements (Visible only on small screens) */}
         <div className="absolute inset-0 lg:hidden pointer-events-none overflow-hidden">
            <div className="absolute top-0 right-0 w-[70vw] h-[70vw] bg-blue-600/10 rounded-full blur-[100px] animate-pulse" />
            <div className="absolute bottom-0 left-0 w-[50vw] h-[50vw] bg-indigo-600/10 rounded-full blur-[100px] animate-pulse delay-1000" />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px]" />
         </div>

         <motion.div 
           initial={{ opacity: 0, scale: 0.95 }} 
           animate={{ opacity: 1, scale: 1 }} 
           transition={{ duration: 0.5 }}
           className="w-full max-w-[400px] space-y-8 relative z-10"
         >
            {/* Mobile Header (Hidden on Desktop) */}
            <div className="lg:hidden text-center mb-8">
               <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 p-0.5 shadow-lg shadow-blue-500/20">
                 <div className="w-full h-full rounded-2xl bg-black flex items-center justify-center">
                    <img src="/icon.png" alt="Logo" className="w-full h-full object-cover opacity-90 rounded-2xl" />
                 </div>
               </div>
               <h2 className="text-2xl font-bold">TurboLearn AI</h2>
            </div>

            {/* ✅ HEADER WITH SUPPORT BUTTON */}
            <div className="flex items-center justify-between">
                <div className="space-y-2">
                    <h2 className="text-3xl font-bold tracking-tight">Welcome back</h2>
                    <p className="text-gray-400">Enter your credentials to access the terminal.</p>
                </div>
                <button 
                    onClick={() => setShowSupport(true)}
                    className="p-2.5 rounded-full text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                    title="Problem logging in?"
                >
                    <HelpCircle size={20} />
                </button>
            </div>

            {/* Toggle */}
            <div className="grid grid-cols-2 p-1 bg-white/5 rounded-xl border border-white/10">
                <button onClick={() => setMethod('google')} className={`py-2.5 text-xs font-semibold rounded-lg transition-all ${method === 'google' ? 'bg-[#2c2d2e] text-white shadow-lg ring-1 ring-white/10' : 'text-gray-400 hover:text-white'}`}>Student</button>
                <button onClick={() => setMethod('email')} className={`py-2.5 text-xs font-semibold rounded-lg transition-all ${method === 'email' ? 'bg-[#2c2d2e] text-white shadow-lg ring-1 ring-white/10' : 'text-gray-400 hover:text-white'}`}>Admin</button>
            </div>

            <AnimatePresence mode="wait">
              {method === 'google' ? (
                <motion.div key="google" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="pt-4 space-y-6">
                   <button
                      onClick={handleGoogleLogin}
                      disabled={status === 'loading'}
                      className="w-full h-12 bg-white text-black font-bold rounded-xl flex items-center justify-center gap-3 hover:bg-gray-200 transition-all active:scale-95 disabled:opacity-50 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
                   >
                      {status === 'loading' ? <Loader2 size={20} className="animate-spin" /> : <><LogIn size={18} /> Continue with Google</>}
                   </button>
                   
                   <div className="relative">
                      <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-white/10"></div></div>
                      <div className="relative flex justify-center text-xs uppercase"><span className="bg-[#050505] px-2 text-gray-500">Secure Access</span></div>
                   </div>

                   <div className="flex justify-center gap-4 text-gray-500">
                      <Globe size={16} /> <ShieldCheck size={16} /> <Cpu size={16} />
                   </div>
                </motion.div>
              ) : (
                <motion.div key="email" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
                   <div className="space-y-4">
                      <div className="relative group">
                         <Mail className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                         <input type="email" placeholder="admin@turbolearn.ai" value={email} onChange={e => setEmail(e.target.value)} className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 text-sm focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all placeholder:text-gray-600 text-white" required />
                      </div>
                      <div className="relative group">
                         <Key className="absolute left-4 top-3.5 text-gray-500 group-focus-within:text-blue-400 transition-colors" size={18} />
                         <input type="password" placeholder="••••••••" value={password} onChange={e => setPassword(e.target.value)} className="w-full h-12 bg-white/5 border border-white/10 rounded-xl pl-12 pr-4 text-sm focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all placeholder:text-gray-600 text-white" required />
                      </div>
                   </div>
                   <button onClick={handleEmailLogin} disabled={status === 'loading'} className="w-full h-12 bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-all active:scale-95 shadow-lg shadow-blue-900/20 disabled:opacity-50">
                      {status === 'loading' ? <Loader2 size={20} className="animate-spin" /> : "Authenticate"} <ArrowRight size={16} />
                   </button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="pt-8 text-center">
               <p className="text-[10px] text-gray-600 uppercase tracking-widest flex items-center justify-center gap-2">
                  <Lock size={10} /> End-to-End Encrypted
               </p>
            </div>
         </motion.div>
      </div>
    </div>
  );
}

// --- SUB-COMPONENTS ---

const FeaturePill = ({ icon, text }: { icon: any, text: string }) => (
  <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs font-medium text-gray-300 backdrop-blur-md">
     {icon} <span>{text}</span>
  </div>
);

const StatusScreen = ({ type, action }: { type: 'pending' | 'banned' | 'success', action?: () => void }) => {
  const config = {
    pending: { icon: <Loader2 size={40} className="animate-spin text-yellow-400" />, title: "Verification Pending", desc: "Your account is awaiting administrator approval.", color: "text-yellow-400", btn: "Cancel" },
    banned: { icon: <ShieldAlert size={40} className="text-red-500" />, title: "Access Revoked", desc: "Your security clearance has been terminated.", color: "text-red-500", btn: "Return" },
    success: { icon: <CheckCircle2 size={40} className="text-green-400" />, title: "Access Granted", desc: "Initializing secure connection...", color: "text-green-400", btn: null }
  };
  
  const { icon, title, desc, color, btn } = config[type];

  return (
    <div className="flex h-screen w-full items-center justify-center bg-[#050505] p-6 relative overflow-hidden">
       <div className={`absolute inset-0 opacity-10 bg-gradient-to-b from-${color.split('-')[1]}-900/20 to-transparent`} />
       <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="relative z-10 max-w-sm w-full text-center">
          <div className="w-20 h-20 mx-auto bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10 shadow-2xl">
             {icon}
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{title}</h2>
          <p className="text-gray-400 text-sm mb-8 leading-relaxed">{desc}</p>
          {btn && (
            <button onClick={action} className="px-8 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white text-sm font-medium transition-all">
               {btn}
            </button>
          )}
       </motion.div>
    </div>
  );
};

// ✅ Guest Support Modal
const GuestSupportModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success'>('idle');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !message.trim()) return;

    setStatus('submitting');
    try {
      // ✅ Create a support ticket in Firestore
      await addDoc(collection(db, 'support_tickets'), {
        email,
        message,
        status: 'new',
        createdAt: serverTimestamp(),
      });
      setStatus('success');
      setTimeout(() => {
        onClose();
        setStatus('idle');
        setEmail('');
        setMessage('');
      }, 2000);
    } catch (err) {
      console.error(err);
      setStatus('idle');
      alert("Failed to send message. Please try again.");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }} 
        animate={{ scale: 1, opacity: 1 }} 
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-[#0c0c0e] border border-white/10 w-full max-w-md rounded-2xl p-6 shadow-2xl relative"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors">
          <X size={20} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-blue-600/10 rounded-xl border border-blue-500/20 text-blue-400">
            <Mail size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white">Contact Support</h3>
            <p className="text-xs text-gray-400">Cannot log in? Leave a message.</p>
          </div>
        </div>

        {status === 'success' ? (
          <div className="py-8 text-center flex flex-col items-center animate-in fade-in">
            <CheckCircle2 size={48} className="text-green-400 mb-4" />
            <h4 className="text-lg font-bold text-white">Message Sent!</h4>
            <p className="text-gray-400 text-sm mt-2">Our team will contact you at {email}.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">Your Email</label>
              <input 
                type="email" 
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors"
                placeholder="student@example.com"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1.5 ml-1">Message</label>
              <textarea 
                required
                rows={4}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="w-full bg-[#18181b] border border-white/10 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500/50 transition-colors resize-none"
                placeholder="I cannot login because..."
              />
            </div>
            <button 
              type="submit" 
              disabled={status === 'submitting'}
              className="w-full py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {status === 'submitting' ? <Loader2 size={18} className="animate-spin" /> : <><Send size={16} /> Send Message</>}
            </button>
          </form>
        )}
      </motion.div>
    </div>
  );
};