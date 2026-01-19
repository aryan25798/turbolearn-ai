'use client';
import { useState, useEffect } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useRouter } from 'next/navigation';
import SupportInterface from '@/components/SupportInterface';
import { ArrowLeft, Loader2 } from 'lucide-react';

export default function SupportPage() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.push('/');
      } else {
        setUser(currentUser);
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  if (loading) return <div className="h-screen bg-[#050505] flex items-center justify-center text-white"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-[#050505] text-white p-6">
      <button 
        onClick={() => router.push('/')} 
        className="mb-6 flex items-center gap-2 text-gray-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={18} /> Back to Dashboard
      </button>
      
      {user && <SupportInterface user={user} />}
    </div>
  );
}