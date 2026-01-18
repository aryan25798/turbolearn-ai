'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { LogIn, ArrowRight, ShieldAlert, Clock, Lock, Sparkles, Zap, ShieldCheck, Mail, Key, Loader2 } from 'lucide-react';
import { auth, googleProvider, db } from '@/lib/firebase';
import { signInWithPopup, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';

export default function Login() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'pending' | 'banned' | 'success'>('idle');
  const [method, setMethod] = useState<'google' | 'email'>('google');
  
  // Email/Pass State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // 1. REAL-TIME LISTENER FOR PENDING USERS
  useEffect(() => {
    let unsubscribe: () => void;

    if (status === 'pending' && auth.currentUser) {
      const userRef = doc(db, 'users', auth.currentUser.uid);
      
      // Open a live channel to the user's document
      unsubscribe = onSnapshot(userRef, (docSnap) => {
        const data = docSnap.data();
        if (data) {
          if (data.status === 'approved') {
            // ✅ ADMIN APPROVED: Instantly switch to success
            setStatus('success');
            // Optional: Force reload to ensure main app picks up new role immediately
            setTimeout(() => window.location.reload(), 500); 
          } else if (data.status === 'banned') {
            // ❌ ADMIN BANNED: Kick out immediately
            setStatus('banned');
            signOut(auth);
          }
        }
      });
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [status]);

  const processUser = async (user: any) => {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      // --- NEW USER LOGIC ---
      // Auto-make admin if it matches your specific email
      const isAdmin = user.email === 'admin@system.com'; // ⚠️ REPLACE WITH YOUR EMAIL IF NEEDED
      
      await setDoc(userRef, {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || 'User',
        photoURL: user.photoURL,
        role: isAdmin ? 'admin' : 'user',
        status: isAdmin ? 'approved' : 'pending', // Default to pending for security
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp()
      });

      if (isAdmin) {
           setStatus('success'); 
      } else {
           // ✅ DO NOT SIGN OUT. Keep them logged in but trapped in 'pending' state
           // This allows the onSnapshot listener above to work.
           setStatus('pending');
      }
    } else {
      // --- EXISTING USER CHECK ---
      const userData = userSnap.data();
      await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });

      if (userData.status === 'banned') {
        await signOut(auth);
        setStatus('banned');
      } else if (userData.status === 'pending') {
        // ✅ Stay logged in, but show pending screen
        setStatus('pending');
      } else {
        setStatus('success');
      }
    }
  };

  const handleGoogleLogin = async () => {
    setStatus('loading');
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await processUser(result.user);
    } catch (err) {
      console.error("Login failed:", err);
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
      alert("Invalid credentials or access denied.");
      setStatus('idle');
    }
  };

  // --- UI STATES ---

  if (status === 'pending') {
    return (
      <AccessDeniedScreen 
        icon={<Loader2 size={48} className="text-yellow-400 animate-spin" />}
        title="Verification Pending"
        description="Your secure line is established but requires administrator approval."
        subtext="Please wait here. This page will automatically unlock when Aryan approves you."
        action={async () => { await signOut(auth); setStatus('idle'); }}
        actionText="Cancel & Logout"
      />
    );
  }

  if (status === 'banned') {
    return (
      <AccessDeniedScreen 
        icon={<ShieldAlert size={48} className="text-red-500" />}
        title="Access Revoked"
        description="Your security clearance has been permanently revoked by the administrator."
        subtext="This incident has been logged."
        action={() => setStatus('idle')}
        actionText="Return to Safety"
      />
    );
  }

  // Prevent flicker if success (Main app will take over)
  if (status === 'success') {
      return (
        <div className="flex min-h-[100dvh] w-full items-center justify-center bg-black text-white">
            <div className="flex flex-col items-center animate-pulse">
                <ShieldCheck size={64} className="text-green-500 mb-4" />
                <h2 className="text-xl font-bold">Access Granted</h2>
                <p className="text-sm text-gray-500">Initializing secure environment...</p>
            </div>
        </div>
      );
  }

  return (
    <div className="relative flex min-h-[100dvh] w-full items-center justify-center bg-[#030303] overflow-hidden font-sans selection:bg-indigo-500/30">
      
      {/* 1. Animated Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-600/20 rounded-full blur-[120px] animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-600/20 rounded-full blur-[120px] animate-pulse delay-700" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.03] mix-blend-overlay" />
      </div>

      {/* 2. Main Login Card */}
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 w-full max-w-[420px] p-6"
      >
        <div className="group relative overflow-hidden rounded-[2.5rem] bg-[#0f0f10] border border-white/5 shadow-2xl">
          
          <div className="relative p-10 flex flex-col items-center text-center">
            
            {/* Logo Badge */}
            <motion.div 
              whileHover={{ rotate: 180, scale: 1.1 }}
              className="w-20 h-20 mb-8 rounded-2xl bg-gradient-to-tr from-indigo-500 to-blue-600 p-[1px] shadow-lg shadow-indigo-500/20"
            >
               <div className="w-full h-full rounded-2xl bg-black flex items-center justify-center overflow-hidden">
                 <img src="/icon.png" alt="Logo" className="w-full h-full object-cover opacity-90" />
               </div>
            </motion.div>

            <h1 className="text-4xl font-bold text-white mb-2 tracking-tight">TurboLearn AI</h1>
            <p className="text-neutral-400 text-sm mb-8">Secure dual-core reasoning engine.</p>

            {/* Toggle Method */}
            <div className="flex bg-white/5 rounded-lg p-1 mb-6 w-full">
                <button onClick={() => setMethod('google')} className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${method === 'google' ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'}`}>Google</button>
                <button onClick={() => setMethod('email')} className={`flex-1 py-2 text-xs font-medium rounded-md transition-all ${method === 'email' ? 'bg-white text-black shadow' : 'text-gray-400 hover:text-white'}`}>Admin</button>
            </div>

            {method === 'google' ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleGoogleLogin}
                  disabled={status === 'loading'}
                  className="w-full relative overflow-hidden rounded-xl bg-white text-black font-semibold h-12 flex items-center justify-center gap-3 transition-all hover:bg-neutral-200"
                >
                  {status === 'loading' ? <div className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : <><LogIn size={18} /> Continue with Google</>}
                </motion.button>
            ) : (
                <form onSubmit={handleEmailLogin} className="w-full space-y-3">
                    <div className="relative">
                        <Mail size={16} className="absolute left-3 top-3.5 text-gray-500" />
                        <input type="email" placeholder="admin@system.com" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" required />
                    </div>
                    <div className="relative">
                        <Key size={16} className="absolute left-3 top-3.5 text-gray-500" />
                        <input type="password" placeholder="••••••" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-10 pr-4 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" required />
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      type="submit"
                      disabled={status === 'loading'}
                      className="w-full rounded-xl bg-blue-600 text-white font-semibold h-12 flex items-center justify-center gap-2 mt-2 hover:bg-blue-500 transition-colors"
                    >
                      {status === 'loading' ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : "Admin Login"}
                    </motion.button>
                </form>
            )}
            
            <p className="mt-6 text-[10px] text-neutral-600 flex items-center gap-2">
              <Lock size={10} /> Protected by Firebase Security Rules.
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

const AccessDeniedScreen = ({ icon, title, description, subtext, action, actionText }: any) => (
  <div className="min-h-screen w-full bg-black flex flex-col items-center justify-center p-6 text-center animate-in fade-in zoom-in duration-500">
    <div className="w-24 h-24 rounded-full bg-white/5 flex items-center justify-center mb-6 border border-white/10 shadow-2xl shadow-yellow-900/20">{icon}</div>
    <h2 className="text-3xl font-bold text-white mb-3 tracking-tight">{title}</h2>
    <p className="text-neutral-400 max-w-md text-base leading-relaxed mb-6">{description}</p>
    <div className="bg-[#111] border border-white/10 rounded-xl p-4 max-w-sm w-full mb-8">
        <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span className="text-xs font-bold text-gray-300 uppercase tracking-widest">Live Status Check</span>
        </div>
        <p className="text-xs text-gray-500">{subtext}</p>
    </div>
    <button onClick={action} className="px-8 py-3 rounded-full bg-white text-black font-bold hover:bg-neutral-200 transition-colors flex items-center gap-2"><ArrowRight size={18} /> {actionText}</button>
  </div>
);