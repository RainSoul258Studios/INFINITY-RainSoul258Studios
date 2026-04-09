import React, { useState, useEffect, useRef } from 'react';
import { 
  Music, Image as ImageIcon, Search, Mic, Brain, Volume2, 
  LayoutDashboard, LogOut, Loader2, Play, Pause, Plus, Save,
  HelpCircle, X
} from 'lucide-react';
import { signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { collection, addDoc, setDoc, getDoc, doc, query, where, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { 
  generateMusic, generateImage, groundedSearch, 
  transcribeAudio, deepThink, textToSpeech, getSuggestions
} from './services/gemini';
import Markdown from 'react-markdown';
// @ts-ignore
import lamejs from 'lamejs';

// --- Types ---
type Tab = 'dashboard' | 'music' | 'image' | 'search' | 'audio' | 'think' | 'tts';

const handleDownload = (dataUrl: string, filename: string) => {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

async function convertWavToMp3(dataUri: string, bitrate: number = 128): Promise<string> {
  const res = await fetch(dataUri);
  const arrayBuffer = await res.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  
  const channels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, bitrate);
  const mp3Data: Int8Array[] = [];

  const left = audioBuffer.getChannelData(0);
  const right = channels > 1 ? audioBuffer.getChannelData(1) : left;

  const sampleBlockSize = 1152;
  const leftInt16 = new Int16Array(left.length);
  const rightInt16 = new Int16Array(right.length);

  for (let i = 0; i < left.length; i++) {
    leftInt16[i] = left[i] * 32767.5;
    rightInt16[i] = right[i] * 32767.5;
  }

  for (let i = 0; i < leftInt16.length; i += sampleBlockSize) {
    const leftChunk = leftInt16.subarray(i, i + sampleBlockSize);
    const rightChunk = rightInt16.subarray(i, i + sampleBlockSize);
    const mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }
  }
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(mp3buf);
  }

  const blob = new Blob(mp3Data, { type: 'audio/mp3' });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

function CustomAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [speed, setSpeed] = useState(1);

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
    if (audioRef.current) {
      audioRef.current.playbackRate = newSpeed;
    }
  };

  return (
    <div className="flex items-center gap-4 bg-gray-950 p-3 rounded-xl border border-gray-800 mt-2" onClick={(e) => e.stopPropagation()}>
      <audio ref={audioRef} controls src={src} className="flex-1 h-10 outline-none" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 font-medium">Speed:</span>
        <select 
          value={speed} 
          onChange={(e) => handleSpeedChange(Number(e.target.value))}
          className="bg-gray-900 border border-gray-700 text-sm rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-500 text-gray-200"
        >
          <option value={0.5}>0.5x</option>
          <option value={0.75}>0.75x</option>
          <option value={1}>1x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
        </select>
      </div>
    </div>
  );
}

function AnimatedLoader({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-3 z-10 relative">
      <div className="flex space-x-1.5">
        <div className="w-2 h-2 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
        <div className="w-2 h-2 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
        <div className="w-2 h-2 bg-white/80 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
      </div>
      <span className="animate-pulse font-medium">{text}</span>
    </div>
  );
}

interface Creation {
  id: string;
  userId: string;
  type: string;
  prompt: string;
  result: string;
  createdAt: any;
}

// --- Main App Component ---
export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [creations, setCreations] = useState<Creation[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: serverTimestamp()
            });
          }
        } catch (error) {
          console.error("Failed to save user profile", error);
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthReady && user) {
      const q = query(
        collection(db, 'creations'),
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const newCreations = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as Creation[];
        setCreations(newCreations);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'creations');
      });
      
      return () => unsubscribe();
    }
  }, [isAuthReady, user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  if (!isAuthReady) {
    return <div className="min-h-screen bg-gray-950 flex items-center justify-center text-white">Loading...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center text-white p-4">
        <div className="max-w-md w-full bg-gray-900 p-8 rounded-2xl border border-gray-800 text-center shadow-2xl">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold mb-2 tracking-tight">INFINITY Studio</h1>
          <p className="text-gray-400 mb-8">Your creative AI powerhouse powered by Gemini.</p>
          <button 
            onClick={handleLogin}
            className="w-full py-3 px-4 bg-white text-gray-900 font-medium rounded-xl hover:bg-gray-100 transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex font-sans">
      {/* Sidebar */}
      <aside className="w-64 bg-gray-900 border-r border-gray-800 flex flex-col">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <Brain className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">INFINITY</span>
        </div>
        
        <nav className="flex-1 px-4 space-y-1">
          <NavItem icon={<LayoutDashboard />} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <div className="pt-4 pb-2 px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">Studios</div>
          <NavItem icon={<Music />} label="Music Gen" active={activeTab === 'music'} onClick={() => setActiveTab('music')} />
          <NavItem icon={<ImageIcon />} label="Image Studio" active={activeTab === 'image'} onClick={() => setActiveTab('image')} />
          <NavItem icon={<Search />} label="Search Lab" active={activeTab === 'search'} onClick={() => setActiveTab('search')} />
          <NavItem icon={<Mic />} label="Audio Transcribe" active={activeTab === 'audio'} onClick={() => setActiveTab('audio')} />
          <NavItem icon={<Brain />} label="Deep Thinker" active={activeTab === 'think'} onClick={() => setActiveTab('think')} />
          <NavItem icon={<Volume2 />} label="Text to Speech" active={activeTab === 'tts'} onClick={() => setActiveTab('tts')} />
        </nav>

        <div className="p-4 border-t border-gray-800">
          <div className="flex items-center gap-3 mb-4 px-2">
            <img src={user.photoURL || ''} alt="Profile" className="w-8 h-8 rounded-full bg-gray-800" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.displayName}</p>
            </div>
          </div>
          <button 
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <header className="h-16 border-b border-gray-800 flex items-center px-8 bg-gray-900/50 backdrop-blur-sm">
          <h2 className="text-xl font-semibold capitalize">
            {activeTab === 'tts' ? 'Text to Speech' : activeTab.replace('-', ' ')}
          </h2>
        </header>
        
        <div className="flex-1 overflow-y-auto p-8">
          <div className="max-w-4xl mx-auto">
            {activeTab === 'dashboard' && <Dashboard creations={creations} />}
            {activeTab === 'music' && <MusicStudio userId={user.uid} />}
            {activeTab === 'image' && <ImageStudio userId={user.uid} />}
            {activeTab === 'search' && <SearchLab userId={user.uid} />}
            {activeTab === 'audio' && <AudioLab userId={user.uid} />}
            {activeTab === 'think' && <DeepThinker userId={user.uid} />}
            {activeTab === 'tts' && <TTSStudio userId={user.uid} />}
          </div>
        </div>
      </main>
    </div>
  );
}

// --- Components ---

function ProgressBar({ loading, durationMs = 15000 }: { loading: boolean, durationMs?: number }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!loading) {
      setProgress(0);
      return;
    }

    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      // Go up to 95% based on expected duration, then wait
      const newProgress = Math.min((elapsed / durationMs) * 95, 95);
      setProgress(newProgress);
    }, 100);

    return () => clearInterval(interval);
  }, [loading, durationMs]);

  if (!loading) return null;

  return (
    <div className="w-full bg-gray-800 rounded-full h-1.5 mt-4 overflow-hidden">
      <div 
        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300 ease-out"
        style={{ width: `${progress}%` }}
      ></div>
    </div>
  );
}

function HelpTooltip({ title, content }: { title: string, content: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="relative inline-block ml-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="text-gray-400 hover:text-indigo-400 transition-colors focus:outline-none"
        title="Help & Tips"
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      
      {isOpen && (
        <div className="absolute z-10 w-72 p-4 mt-2 bg-gray-800 border border-gray-700 rounded-xl shadow-xl left-0 sm:left-auto sm:right-0 text-sm text-gray-200">
          <div className="flex justify-between items-center mb-2">
            <h4 className="font-semibold text-white">{title}</h4>
            <button onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {content}
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
        active 
          ? 'bg-indigo-500/10 text-indigo-400' 
          : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
      }`}
    >
      {React.cloneElement(icon as React.ReactElement, { className: 'w-5 h-5' })}
      {label}
    </button>
  );
}

// --- API Key Gate ---
// Helper to check and request API key for specific models
async function ensureApiKey() {
  // @ts-ignore
  if (window.aistudio && window.aistudio.hasSelectedApiKey) {
    // @ts-ignore
    const hasKey = await window.aistudio.hasSelectedApiKey();
    if (!hasKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
    }
  }
}

async function handleApiError(err: unknown, setError: (msg: string) => void, defaultMsg: string) {
  console.error(err);
  const errorMessage = err instanceof Error ? err.message : String(err);
  
  if (errorMessage.includes('Requested entity was not found.') || 
      errorMessage.includes('The caller does not have permission') ||
      errorMessage.includes('PERMISSION_DENIED') ||
      errorMessage.includes('403')) {
    // @ts-ignore
    if (window.aistudio && window.aistudio.openSelectKey) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setError('Please select a valid API key with appropriate permissions and try again.');
      return;
    }
  }
  setError(err instanceof Error ? err.message : defaultMsg);
}

// --- Studios ---

function Dashboard({ creations }: { creations: Creation[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string | null>(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const hasFetchedSuggestions = useRef(false);

  const fetchSuggestions = async (force = false) => {
    if (hasFetchedSuggestions.current && !force) return;
    hasFetchedSuggestions.current = true;
    setLoadingSuggestions(true);
    try {
      await ensureApiKey();
      const activity = creations.slice(0, 5).map(c => ({ type: c.type, prompt: c.prompt }));
      const res = await getSuggestions(activity);
      setSuggestions(res);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => fetchSuggestions(), 1500);
    return () => clearTimeout(timer);
  }, [creations]);

  const filteredCreations = creations.filter(c => 
    c.prompt.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const recentCreations = creations.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <h3 className="text-gray-400 text-sm font-medium mb-1">Total Creations</h3>
          <p className="text-3xl font-bold">{creations.length}</p>
        </div>
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <h3 className="text-gray-400 text-sm font-medium mb-1">Recent Activity</h3>
          <p className="text-3xl font-bold">{recentCreations.length}</p>
        </div>
      </div>

      <div className="bg-gradient-to-br from-indigo-900/40 to-purple-900/40 p-6 rounded-2xl border border-indigo-500/30 relative overflow-hidden mt-8">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Brain className="w-5 h-5 text-indigo-400" />
            <h3 className="text-lg font-semibold text-indigo-100">AI Studio Suggestions</h3>
          </div>
          <button 
            onClick={() => fetchSuggestions(true)}
            disabled={loadingSuggestions}
            className="text-xs bg-indigo-500/20 hover:bg-indigo-500/30 text-indigo-300 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            Refresh Ideas
          </button>
        </div>
        {loadingSuggestions ? (
          <div className="flex items-center gap-3 text-indigo-300/70 py-4">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Analyzing your creative patterns...</span>
          </div>
        ) : suggestions ? (
          <div className="prose prose-invert prose-indigo max-w-none text-sm">
            <Markdown>{suggestions}</Markdown>
          </div>
        ) : null}
      </div>

      {recentCreations.length > 0 && (
        <div className="mt-8">
          <h3 className="text-xl font-semibold mb-4">Recent Generations</h3>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <ul className="divide-y divide-gray-800">
              {recentCreations.map(c => (
                <li key={`recent-${c.id}`} className="p-4 hover:bg-gray-800/50 transition-colors flex items-center gap-4">
                  <span className="text-xs font-medium px-2 py-1 bg-gray-800 rounded-md uppercase tracking-wider text-gray-400 w-20 text-center shrink-0">
                    {c.type}
                  </span>
                  <span className="text-sm text-gray-300 truncate flex-1">
                    {c.prompt}
                  </span>
                  <span className="text-xs text-gray-500 shrink-0">
                    {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : 'Just now'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between mt-8 mb-4 gap-4">
        <h3 className="text-xl font-semibold">Your Library</h3>
        <div className="relative w-full md:w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input 
            type="text" 
            placeholder="Search library..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-9 pr-4 py-2 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredCreations.map(c => {
          const isExpanded = expandedId === c.id;
          return (
            <div 
              key={c.id} 
              onClick={() => setExpandedId(isExpanded ? null : c.id)}
              className={`bg-gray-900 p-5 rounded-2xl border border-gray-800 flex flex-col gap-3 cursor-pointer hover:border-gray-700 transition-all duration-200 ${
                isExpanded ? 'col-span-1 md:col-span-2 shadow-xl shadow-black/50' : ''
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium px-2 py-1 bg-gray-800 rounded-md uppercase tracking-wider text-gray-400">
                  {c.type}
                </span>
                <span className="text-xs text-gray-500">
                  {c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : 'Just now'}
                </span>
              </div>
              <p className={`text-sm text-gray-300 ${isExpanded ? '' : 'line-clamp-2'}`}>
                {c.prompt}
              </p>
              
              {c.type === 'image' && (
                <img 
                  src={c.result} 
                  alt={c.prompt} 
                  className={`w-full rounded-xl mt-2 transition-all ${
                    isExpanded ? 'max-h-[600px] object-contain bg-black/20' : 'h-48 object-cover'
                  }`} 
                />
              )}
              {(c.type === 'music' || c.type === 'tts') && (
                <CustomAudioPlayer src={c.result} />
              )}
              {(c.type === 'search' || c.type === 'think' || c.type === 'audio') && (
                <div className={`mt-2 text-sm text-gray-300 bg-gray-950 p-4 rounded-xl ${
                  isExpanded ? 'max-h-[600px] overflow-y-auto prose prose-invert max-w-none' : 'line-clamp-3 text-gray-400'
                }`}>
                  {isExpanded ? <Markdown>{c.result}</Markdown> : c.result}
                </div>
              )}
            </div>
          );
        })}
        {filteredCreations.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-500 bg-gray-900/50 rounded-2xl border border-gray-800 border-dashed">
            {searchQuery ? 'No creations found matching your search.' : 'No creations yet. Start exploring the studios!'}
          </div>
        )}
      </div>
    </div>
  );
}

function MusicStudio({ userId }: { userId: string }) {
  const [prompt, setPrompt] = useState("Blues / Thrash ’n’ Roll 2026 con elementos de Death Metal melódico. Atmósfera Deep Dark con contraste de esperanza épica alentadora. Instrumentación completa: batería agresiva, bajo profundo, guitarras distorsionadas con riffs pesados, teclado atmosférico. Voz masculina española estilo NILTON258: mezcla de rap rítmico, canto rasgado melódico, actitud punk y emoción romántica oscura. Interpretación dinámica, intensa, con variaciones entre susurro grave, fraseo rap y explosiones melódicas. Estructura tipo 12-bar song. Tempo 120 BPM. Producción moderna, contundente y cinematográfica.");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{url: string, lyrics: string} | null>(null);
  const [duration, setDuration] = useState<'clip' | 'full'>('clip');
  const [model, setModel] = useState('N258Z');
  const [seed, setSeed] = useState('');
  const [saveFormat, setSaveFormat] = useState<'wav' | 'mp3'>('wav');
  const [bitrate, setBitrate] = useState(128);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      await ensureApiKey();
      const res = await generateMusic(prompt, duration, model, seed);
      setResult({ url: res.audioUrl, lyrics: res.lyrics });
      
      await addDoc(collection(db, 'creations'), {
        userId,
        type: 'music',
        prompt,
        result: res.audioUrl,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      await handleApiError(err, setError, 'Failed to generate music. Please check your API key and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!result) return;
    setSaving(true);
    setError(null);
    try {
      if (saveFormat === 'wav') {
        handleDownload(result.url, 'music.wav');
      } else {
        const mp3Url = await convertWavToMp3(result.url, bitrate);
        handleDownload(mp3Url, 'music.mp3');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to save file. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const templates = [
    "A relaxing lo-fi hip hop beat with rain sounds and a smooth saxophone melody.",
    "An upbeat synthwave track with driving bass and retro 80s drums.",
    "A cinematic orchestral piece building up to an epic climax with brass and choir."
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
            Music Studio
            <HelpTooltip 
              title="Music Studio Tips" 
              content={
                <ul className="list-disc pl-4 space-y-1">
                  <li><strong>Prompting:</strong> Describe genre, instruments, mood, and tempo.</li>
                  <li><strong>Seed:</strong> Use a specific number to get consistent results across generations.</li>
                  <li><strong>Duration:</strong> 'Clip' generates 30s fast. 'Full' generates a complete song but takes longer.</li>
                </ul>
              } 
            />
          </h2>
          <p className="text-gray-400 text-sm">Create original music clips or full songs from text descriptions using the Lyria model. Choose between a quick 30-second clip or a full-length track.</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Generate Music</h3>
          <div className="flex gap-3">
            <select 
              title="Select Music Model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="bg-gray-950 border border-gray-800 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 text-gray-200"
            >
              <option value="N258Z">N258Z (Modelo Propio)</option>
              <option value="lyria-3-pro-preview">Lyria 3 Pro</option>
              <option value="v5-suno">v5 SUNO</option>
            </select>
            <div className="flex bg-gray-950 rounded-lg p-1 border border-gray-800">
              <button 
                title="Generate a 30-second music clip"
                onClick={() => setDuration('clip')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${duration === 'clip' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                30s Clip
              </button>
              <button 
                title="Generate a full-length song"
                onClick={() => setDuration('full')}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${duration === 'full' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
              >
                Full Song
              </button>
            </div>
          </div>
        </div>
        <textarea
          title="Describe the music you want to create"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the music you want to create (e.g., A cinematic orchestral track with heavy brass)..."
          className="w-full h-32 bg-gray-950 border border-gray-800 rounded-xl p-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none mb-2"
        />
        <div className="flex flex-wrap gap-2 mb-4">
          {templates.map((t, i) => (
            <button 
              key={i} 
              onClick={() => setPrompt(t)}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors"
            >
              Template {i + 1}
            </button>
          ))}
        </div>
        {duration === 'full' && (
          <div className="mb-4">
            <input
              title="Optional seed for generation"
              type="text"
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              placeholder="Seed prompt (optional)..."
              className="w-full bg-gray-950 border border-gray-800 rounded-xl p-3 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>
        )}
        <button
          title={loading ? "Processing your request..." : "Click to generate music"}
          onClick={handleGenerate}
          disabled={loading || !prompt}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium flex items-center justify-center gap-2 transition-colors relative overflow-hidden"
        >
          {loading ? (
            <>
              <div className="absolute inset-0 bg-indigo-500/20 animate-pulse"></div>
              <AnimatedLoader text={`Generating ${duration === 'clip' ? 'Clip' : 'Full Song'}...`} />
            </>
          ) : (
            <>
              <Music className="w-5 h-5" />
              Generate {duration === 'clip' ? 'Clip' : 'Full Song'}
            </>
          )}
        </button>
        <ProgressBar loading={loading} durationMs={duration === 'full' ? 45000 : 15000} />
        {duration === 'full' && (
          <p className="text-xs text-gray-500 mt-3 text-center">
            Note: Full song generation uses the lyria-3-pro-preview model (equivalent to N258Z capabilities).
          </p>
        )}
      </div>

      {result && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Result</h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-gray-950 rounded-lg p-1 border border-gray-800">
                <select
                  value={saveFormat}
                  onChange={(e) => setSaveFormat(e.target.value as 'wav' | 'mp3')}
                  className="bg-transparent text-sm text-gray-300 focus:outline-none px-2"
                >
                  <option value="wav">WAV</option>
                  <option value="mp3">MP3</option>
                </select>
                {saveFormat === 'mp3' && (
                  <select
                    value={bitrate}
                    onChange={(e) => setBitrate(Number(e.target.value))}
                    className="bg-transparent text-sm text-gray-300 focus:outline-none px-2 border-l border-gray-800"
                  >
                    <option value={128}>128 kbps</option>
                    <option value={192}>192 kbps</option>
                    <option value={320}>320 kbps</option>
                  </select>
                )}
              </div>
              {result.lyrics && (
                <button 
                  title="Save lyrics to a text file"
                  onClick={() => {
                    const blob = new Blob([result.lyrics], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    handleDownload(url, 'lyrics.txt');
                    URL.revokeObjectURL(url);
                  }}
                  className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition-colors"
                >
                  <Save className="w-4 h-4" /> Save Lyrics
                </button>
              )}
              <select 
                title="Select output format"
                value={saveFormat}
                onChange={(e) => setSaveFormat(e.target.value as 'wav' | 'mp3')}
                className="bg-gray-950 border border-gray-700 text-sm rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-500 text-gray-200"
              >
                <option value="wav">.WAV</option>
                <option value="mp3">.MP3</option>
              </select>
              <button 
                title="Save generated audio to your device"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save As
              </button>
            </div>
          </div>
          <CustomAudioPlayer src={result.url} />
          {result.lyrics && (
            <div className="mt-4 p-4 bg-gray-950 rounded-xl border border-gray-800">
              <h4 className="text-sm font-medium text-gray-400 mb-2">Lyrics / Metadata</h4>
              <pre className="text-sm whitespace-pre-wrap font-sans">{result.lyrics}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ImageStudio({ userId }: { userId: string }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      await ensureApiKey();
      const res = await generateImage(prompt);
      setResult(res);
      
      await addDoc(collection(db, 'creations'), {
        userId,
        type: 'image',
        prompt,
        result: res,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      await handleApiError(err, setError, 'Failed to generate image. Please check your API key and try again.');
    } finally {
      setLoading(false);
    }
  };

  const templates = [
    "A futuristic cyberpunk city at night with neon lights and flying cars, high detail, 4k.",
    "A cute golden retriever puppy playing in a field of sunflowers, soft sunlight, photorealistic.",
    "An abstract geometric pattern with vibrant colors and deep shadows, 3d render."
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
            Image Studio
            <HelpTooltip 
              title="Image Studio Tips" 
              content={
                <ul className="list-disc pl-4 space-y-1 text-gray-300">
                  <li><strong>Prompting:</strong> Be specific about subject, lighting, style, and mood.</li>
                  <li><strong>Keywords:</strong> Use terms like "photorealistic", "oil painting", "4k", "cinematic lighting" for better results.</li>
                </ul>
              } 
            />
          </h2>
          <p className="text-gray-400 text-sm">Generate high-quality images from text descriptions using the Imagen model. Just describe what you want to see.</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-200 text-sm">
            {error}
          </div>
        )}

        <h3 className="text-lg font-medium mb-4">Create Image</h3>
        <textarea
          title="Describe the image you want to create"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to create..."
          className="w-full h-32 bg-gray-950 border border-gray-800 rounded-xl p-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none mb-2"
        />
        <div className="flex flex-wrap gap-2 mb-4">
          {templates.map((t, i) => (
            <button 
              key={i} 
              onClick={() => setPrompt(t)}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors"
            >
              Template {i + 1}
            </button>
          ))}
        </div>
        <button
          title={loading ? "Generating your image..." : "Click to generate image"}
          onClick={handleGenerate}
          disabled={loading || !prompt}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium flex items-center justify-center gap-2 transition-colors relative overflow-hidden"
        >
          {loading ? (
            <>
              <div className="absolute inset-0 bg-indigo-500/20 animate-pulse"></div>
              <AnimatedLoader text="Generating Image..." />
            </>
          ) : (
            <>
              <ImageIcon className="w-5 h-5" />
              Generate Image
            </>
          )}
        </button>
        <ProgressBar loading={loading} durationMs={10000} />
      </div>

      {result && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Result</h3>
            <button 
              title="Save generated image to your device"
              onClick={() => handleDownload(result, 'generated-image.png')}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" /> Save As
            </button>
          </div>
          <img src={result} alt="Generated" className="w-full rounded-xl shadow-2xl" />
        </div>
      )}
    </div>
  );
}

function SearchLab({ userId }: { userId: string }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      await ensureApiKey();
      const res = await groundedSearch(prompt);
      setResult(res);
      
      await addDoc(collection(db, 'creations'), {
        userId,
        type: 'search',
        prompt,
        result: res,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      await handleApiError(err, setError, 'Failed to perform search. Please check your API key and try again.');
    } finally {
      setLoading(false);
    }
  };

  const templates = [
    "What are the latest developments in quantum computing?",
    "Summarize the most recent news about space exploration.",
    "What are the best practices for React performance optimization in 2026?"
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
            Search Lab
            <HelpTooltip 
              title="Search Lab Tips" 
              content={
                <ul className="list-disc pl-4 space-y-1 text-gray-300">
                  <li><strong>Grounding:</strong> The model uses Google Search to find up-to-date information.</li>
                  <li><strong>Queries:</strong> Ask specific questions for better, more accurate answers.</li>
                </ul>
              } 
            />
          </h2>
          <p className="text-gray-400 text-sm">Get answers grounded in Google Search results for up-to-date information and accurate summaries.</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-200 text-sm">
            {error}
          </div>
        )}

        <h3 className="text-lg font-medium mb-4">Grounded Search</h3>
        <input
          title="Enter your search query"
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask anything, grounded with Google Search..."
          className="w-full bg-gray-950 border border-gray-800 rounded-xl p-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all mb-2"
        />
        <div className="flex flex-wrap gap-2 mb-4">
          {templates.map((t, i) => (
            <button 
              key={i} 
              onClick={() => setPrompt(t)}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors"
            >
              Template {i + 1}
            </button>
          ))}
        </div>
        <button
          title={loading ? "Searching Google..." : "Click to search"}
          onClick={handleGenerate}
          disabled={loading || !prompt}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium flex items-center justify-center gap-2 transition-colors relative overflow-hidden"
        >
          {loading ? (
            <>
              <div className="absolute inset-0 bg-indigo-500/20 animate-pulse"></div>
              <AnimatedLoader text="Searching..." />
            </>
          ) : (
            <>
              <Search className="w-5 h-5" />
              Search
            </>
          )}
        </button>
        <ProgressBar loading={loading} durationMs={5000} />
      </div>

      {result && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Result</h3>
            <button 
              title="Save search results to a text file"
              onClick={() => {
                const blob = new Blob([result], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                handleDownload(url, 'search-results.txt');
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" /> Save As
            </button>
          </div>
          <div className="prose prose-invert max-w-none">
            <Markdown>{result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

function AudioLab({ userId }: { userId: string }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startRecording = async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = async () => {
          const base64data = (reader.result as string).split(',')[1];
          setLoading(true);
          try {
            await ensureApiKey();
            const res = await transcribeAudio(base64data, 'audio/webm');
            setResult(res);
            await addDoc(collection(db, 'creations'), {
              userId,
              type: 'audio',
              prompt: 'Audio Transcription',
              result: res,
              createdAt: serverTimestamp()
            });
          } catch (err) {
            await handleApiError(err, setError, 'Failed to transcribe audio. Please check your API key and try again.');
          } finally {
            setLoading(false);
          }
        };
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      setError("Could not access microphone. Please check permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setRecording(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 text-center">
        <div className="mb-6 text-left">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
            Audio Transcribe
            <HelpTooltip 
              title="Audio Transcribe Tips" 
              content={
                <ul className="list-disc pl-4 space-y-1 text-gray-300">
                  <li><strong>Microphone:</strong> Ensure your browser has permission to access your microphone.</li>
                  <li><strong>Clarity:</strong> Speak clearly and minimize background noise for best results.</li>
                </ul>
              } 
            />
          </h2>
          <p className="text-gray-400 text-sm">Record your voice and get a highly accurate transcription using Gemini's audio processing capabilities.</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-200 text-sm text-left">
            {error}
          </div>
        )}

        <h3 className="text-lg font-medium mb-6">Audio Transcription</h3>
        
        <button
          title={recording ? "Click to stop recording" : "Click to start recording"}
          onClick={recording ? stopRecording : startRecording}
          disabled={loading}
          className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-6 transition-all ${
            recording 
              ? 'bg-red-500/20 text-red-500 animate-pulse' 
              : 'bg-indigo-500/20 text-indigo-500 hover:bg-indigo-500/30'
          } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {recording ? <Pause className="w-10 h-10" /> : <Mic className="w-10 h-10" />}
        </button>
        
        <p className="text-gray-400">
          {recording ? 'Recording... Click to stop and transcribe.' : 'Click to start recording'}
        </p>
        {loading && (
          <div className="mt-6 p-4 bg-gray-950 rounded-xl border border-gray-800">
            <AnimatedLoader text="Transcribing Audio..." />
          </div>
        )}
      </div>

      {result && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-medium text-gray-400">Transcription</h4>
            <button 
              title="Save transcription to a text file"
              onClick={() => {
                const blob = new Blob([result], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                handleDownload(url, 'transcription.txt');
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" /> Save As
            </button>
          </div>
          <p className="text-lg">{result}</p>
        </div>
      )}
    </div>
  );
}

function DeepThinker({ userId }: { userId: string }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      await ensureApiKey();
      const res = await deepThink(prompt);
      setResult(res);
      
      await addDoc(collection(db, 'creations'), {
        userId,
        type: 'think',
        prompt,
        result: res,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      await handleApiError(err, setError, 'Failed to process the problem. Please check your API key and try again.');
    } finally {
      setLoading(false);
    }
  };

  const templates = [
    "Explain the theory of relativity to a 10-year-old.",
    "What are the ethical implications of artificial general intelligence?",
    "Design a system architecture for a scalable real-time chat application."
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2 flex items-center">
            Deep Thinker
            <HelpTooltip 
              title="Deep Thinker Tips" 
              content={
                <ul className="list-disc pl-4 space-y-1 text-gray-300">
                  <li><strong>Reasoning:</strong> This model is designed for complex, multi-step problems.</li>
                  <li><strong>Detail:</strong> Provide as much context as possible for the best analysis.</li>
                </ul>
              } 
            />
          </h2>
          <p className="text-gray-400 text-sm">Solve complex problems with step-by-step reasoning using the Gemini 2.0 Flash Thinking model.</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-200 text-sm">
            {error}
          </div>
        )}

        <h3 className="text-lg font-medium mb-4">High Thinking Mode</h3>
        <textarea
          title="Enter a complex question or problem"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask a complex question requiring deep reasoning..."
          className="w-full h-32 bg-gray-950 border border-gray-800 rounded-xl p-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none mb-2"
        />
        <div className="flex flex-wrap gap-2 mb-4">
          {templates.map((t, i) => (
            <button 
              key={i} 
              onClick={() => setPrompt(t)}
              className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded transition-colors"
            >
              Template {i + 1}
            </button>
          ))}
        </div>
        <button
          title={loading ? "Thinking..." : "Click to analyze"}
          onClick={handleGenerate}
          disabled={loading || !prompt}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium flex items-center justify-center gap-2 transition-colors relative overflow-hidden"
        >
          {loading ? (
            <>
              <div className="absolute inset-0 bg-indigo-500/20 animate-pulse"></div>
              <AnimatedLoader text="Thinking Deeply..." />
            </>
          ) : (
            <>
              <Brain className="w-5 h-5" />
              Think
            </>
          )}
        </button>
        <ProgressBar loading={loading} durationMs={15000} />
      </div>

      {result && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Result</h3>
            <button 
              title="Save analysis to a text file"
              onClick={() => {
                const blob = new Blob([result], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                handleDownload(url, 'deep-thought.txt');
                URL.revokeObjectURL(url);
              }}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" /> Save As
            </button>
          </div>
          <div className="prose prose-invert max-w-none">
            <Markdown>{result}</Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

function TTSStudio({ userId }: { userId: string }) {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoice] = useState('Kore');

  const handleGenerate = async () => {
    if (!prompt) return;
    setLoading(true);
    setError(null);
    try {
      await ensureApiKey();
      const res = await textToSpeech(prompt, voice);
      setResult(res);
      
      await addDoc(collection(db, 'creations'), {
        userId,
        type: 'tts',
        prompt,
        result: res,
        createdAt: serverTimestamp()
      });
    } catch (err) {
      await handleApiError(err, setError, 'Failed to generate speech. Please check your text and try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800">
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-white mb-2">Text to Speech</h2>
          <p className="text-gray-400 text-sm">Convert text into natural-sounding speech using advanced audio generation models.</p>
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-xl text-red-200 text-sm">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">Text to Speech</h3>
          <select 
            title="Select Voice"
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className="bg-gray-950 border border-gray-800 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-indigo-500 text-gray-200"
          >
            <option value="Puck">Puck</option>
            <option value="Charon">Charon</option>
            <option value="Kore">Kore</option>
            <option value="Fenrir">Fenrir</option>
            <option value="Zephyr">Zephyr</option>
          </select>
        </div>
        <textarea
          title="Enter the text you want to convert to speech"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter text to convert to speech..."
          className="w-full h-32 bg-gray-950 border border-gray-800 rounded-xl p-4 text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none mb-4"
        />
        <button
          title={loading ? "Generating speech..." : "Click to generate speech"}
          onClick={handleGenerate}
          disabled={loading || !prompt}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl font-medium flex items-center justify-center gap-2 transition-colors relative overflow-hidden"
        >
          {loading ? (
            <>
              <div className="absolute inset-0 bg-indigo-500/20 animate-pulse"></div>
              <AnimatedLoader text="Generating Speech..." />
            </>
          ) : (
            <>
              <Volume2 className="w-5 h-5" />
              Generate Speech
            </>
          )}
        </button>
      </div>

      {result && (
        <div className="bg-gray-900 p-6 rounded-2xl border border-gray-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium">Result</h3>
            <button 
              title="Save generated speech to your device"
              onClick={() => handleDownload(result, 'speech.wav')}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              <Save className="w-4 h-4" /> Save As
            </button>
          </div>
          <CustomAudioPlayer src={result} />
        </div>
      )}
    </div>
  );
}
