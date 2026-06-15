/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from "react";
import {
  auth,
  googleProvider,
  db,
  handleFirestoreError,
  OperationType,
} from "./firebase";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User as FirebaseUser,
} from "firebase/auth";
import { doc, onSnapshot, setDoc } from "firebase/firestore";
import {
  LogIn,
  Send,
  Sparkles,
  RefreshCw,
  BookOpen,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

// Local structures
interface Message {
  sender: "user" | "model";
  text: string;
  timestamp: string;
}

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [dbSyncStatus, setDbSyncStatus] = useState<"synced" | "pending" | "offline" | "error">("offline");
  const [syncErrorMessage, setSyncErrorMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"chat" | "frameworks" | "crisis">("chat");

  const chatEndRef = useRef<HTMLDivElement | null>(null);

  // Suggested high-grounding psychological exploratory questions
  const starters = [
    {
      label: "Attachment Inquiry",
      text: "Why do I find myself pulling away from people when they show genuine interest or vulnerability?",
    },
    {
      label: "CBT Mistake Loop",
      text: "I have a strong habit of catastrophizing small mistakes. Can we analyze why my brain treats errors as total failures?",
    },
    {
      label: "Vaillant Defense Check",
      text: "I tend to intellectualize conflicts immediately instead of feeling them. Let's explore how that acts as a psychological defense.",
    },
    {
      label: "Core Motivation",
      text: "Can you help me analyze my primary fears and desires based on typical behavioral patterns?",
    },
  ];

  // 1. Listen for auth changes
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // 2. Stream user messages from Firestore when logged in
  useEffect(() => {
    if (!user) {
      // Clear messages or initialize with sample warm welcome from EllA when signs out
      setMessages([
        {
          sender: "model",
          text: "Welcome to EllA AI. I am your academic and analytical psychological consultant. Please feel free to explore your thoughts, feelings, relational dynamics, or behavioral triggers in complete depth here. For a fully personalized and secured session, please sign in with Google or select one of the explore options below.",
          timestamp: new Date().toISOString(),
        },
      ]);
      setDbSyncStatus("offline");
      return;
    }

    setDbSyncStatus("pending");
    const docPath = `chats/${user.uid}`;
    
    // Subscribe to Firestore changes for user's chat doc
    const unsubscribe = onSnapshot(
      doc(db, "chats", user.uid),
      (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          if (data && Array.isArray(data.messages)) {
            setMessages(data.messages);
            setDbSyncStatus("synced");
          }
        } else {
          // Document doesn't exist yet, seed a beautiful introductory welcome turn
          setMessages([
            {
              sender: "model",
              text: `Greetings ${user.displayName || "Explorer"}. I've initialized your secure space. Let's examine any recurring thoughts, relational loops, attachment dynamics, or cognitive habits you would like to explore today. Tell me: what has been occupying your mind?`,
              timestamp: new Date().toISOString(),
            },
          ]);
          setDbSyncStatus("synced");
        }
      },
      (error) => {
        console.warn("Firestore listener failed, fallback to local/memory mode:", error);
        setDbSyncStatus("error");
        setSyncErrorMessage("Firestore setup is pending terms approval or configuration.");
        // Seed initial message anyway
        setMessages([
          {
            sender: "model",
            text: `Welcome ${user.displayName || "Explorer"}. Firestore sync is currently running in local-only memory fallback mode. Your conversation will remain perfectly active and functional during this preview session!`,
            timestamp: new Date().toISOString(),
          },
        ]);
      }
    );

    return () => unsubscribe();
  }, [user]);

  // 3. Auto scroll to conversation end
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isProcessing]);

  // 4. Handle signing in with Google via Popup
  const handleSignIn = async () => {
    try {
      setAuthLoading(true);
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Auth login failure:", error);
    } finally {
      setAuthLoading(false);
    }
  };

  // 5. Handle logging out
  const handleSignOut = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Auth logout failure:", error);
    }
  };

  // 6. Send message to the full-stack server (/api/chat)
  const sendMessage = async (overrideText?: string) => {
    const textToSend = overrideText || inputText;
    if (!textToSend.trim() || isProcessing) return;

    const userMsg: Message = {
      sender: "user",
      text: textToSend.trim(),
      timestamp: new Date().toISOString(),
    };

    // Optimistically update frontend messages right away
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInputText("");
    setIsProcessing(true);

    try {
      // Make standard server API route call
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: textToSend.trim(),
          userId: user?.uid || null,
          history: updatedMessages, // send local history to proxy Gemini
        }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const responseData = await response.json();
      const modelReplyText = responseData.reply;

      const modelMsg: Message = {
        sender: "model",
        text: modelReplyText,
        timestamp: responseData.timestamp || new Date().toISOString(),
      };

      // Update local state with BOTH user and model response
      const finalMessages = [...updatedMessages, modelMsg];
      setMessages(finalMessages);

      // If user is authenticated and Firestore available, update/upload the transaction
      if (user && dbSyncStatus !== "error") {
        const pathRef = `chats/${user.uid}`;
        try {
          await setDoc(doc(db, "chats", user.uid), {
            userId: user.uid,
            updatedAt: new Date().toISOString(),
            messages: finalMessages,
          }, { merge: true });
          setDbSyncStatus("synced");
        } catch (dbWriteErr) {
          console.warn("Client client-side sync failed, handle via skill error rule:", dbWriteErr);
          // Standardized client-side handler invocation
          try {
            handleFirestoreError(dbWriteErr, OperationType.WRITE, pathRef);
          } catch (serialError) {
            setDbSyncStatus("error");
          }
        }
      }
    } catch (err: any) {
      console.error("Failed to connect with psychologist server:", err);
      // Append warning fallback to chat
      setMessages((prev) => [
        ...prev,
        {
          sender: "model",
          text: `[Consultation Interrupted] Please make sure your GEMINI_API_KEY secret is defined in the Secrets panel, and your Node server is running on port 3000. Under the hood error: ${
            err.message || String(err)
          }`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row w-full h-screen bg-[#0A0A0A] text-[#E0E0E0] overflow-hidden font-sans select-none">
      
      {/* Sidebar Navigation */}
      <aside className="w-full md:w-80 flex-shrink-0 border-b md:border-b-0 md:border-r border-white/10 flex flex-col p-6 md:p-8 bg-[#0A0A0A] overflow-hidden">
        <div className="mb-8 md:mb-10">
          <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-white leading-none">
            EllA<br/><span className="text-blue-500">AI.</span>
          </h1>
          <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.2em] text-white/40 italic font-serif">
            Academic Clinical Synthesis
          </p>
          <p className="mt-1.5 text-[9px] font-sans font-semibold uppercase tracking-widest text-blue-400">
            Developed by Aswad for mental welfare
          </p>
        </div>

        {/* Deck Navigation tabs */}
        <div className="grid grid-cols-3 border-b border-white/10 mb-6 flex-shrink-0">
          <button
            onClick={() => setActiveTab("chat")}
            className={`pb-3 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer text-center ${
              activeTab === "chat"
                ? "border-b-2 border-blue-500 text-white"
                : "text-white/40 hover:text-white"
            }`}
          >
            Consult
          </button>
          <button
            onClick={() => setActiveTab("frameworks")}
            className={`pb-3 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer text-center ${
              activeTab === "frameworks"
                ? "border-b-2 border-blue-500 text-white"
                : "text-white/40 hover:text-white"
            }`}
          >
            Theories
          </button>
          <button
            onClick={() => setActiveTab("crisis")}
            className={`pb-3 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer text-center ${
              activeTab === "crisis"
                ? "border-b-2 border-blue-500 text-white"
                : "text-white/40 hover:text-white"
            }`}
          >
            Crisis
          </button>
        </div>

        {/* Sidebar Active Panel Content */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-none">
          {activeTab === "chat" && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-500" />
                  Empathetic Protocol
                </p>
                <p className="text-xs text-white/60 leading-relaxed">
                  Select a clinical enquiry topic below to activate relevant evaluation contexts with EllA.
                </p>
              </div>

              <div className="space-y-2.5">
                {starters.map((starter, i) => (
                  <button
                    key={i}
                    onClick={() => setInputText(starter.text)}
                    className="w-full text-left p-4 bg-[#111] hover:bg-[#161616] border border-white/5 hover:border-white/20 rounded-xl transition-all duration-200 cursor-pointer"
                  >
                    <p className="text-[10px] font-mono font-bold tracking-widest text-blue-400 uppercase mb-1">
                      {starter.label}
                    </p>
                    <p className="text-xs text-white/70 line-clamp-2 leading-relaxed">
                      {starter.text}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab === "frameworks" && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-white/5 border border-white/10 p-4 rounded-xl">
                <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <BookOpen className="w-3.5 h-3.5 text-blue-500" />
                  Diagnostic Lenses
                </p>
                <p className="text-xs text-white/60 leading-relaxed">
                  Clinical parameters parsed dynamically into system instruction sets:
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-[#111] border border-white/5 rounded-xl">
                  <h4 className="text-xs font-semibold text-white/90">Attachment Theory (Bowlby)</h4>
                  <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
                    Traces relational security, avoidant patterns, and caregiver trust dependencies.
                  </p>
                </div>
                <div className="p-4 bg-[#111] border border-white/5 rounded-xl">
                  <h4 className="text-xs font-semibold text-white/90">Cognitive Distortions (CBT)</h4>
                  <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
                    Surfaces catastrophizing, emotional reasoning, and polarized 'all-or-nothing' loops.
                  </p>
                </div>
                <div className="p-4 bg-[#111] border border-white/5 rounded-xl">
                  <h4 className="text-xs font-semibold text-white/90">Ego Defenses (Vaillant)</h4>
                  <p className="text-[11px] text-white/40 mt-1 leading-relaxed">
                    Observes defense structures: intellectualization, displacement, and passive suppression.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "crisis" && (
            <div className="space-y-4 animate-fade-in">
              <div className="bg-rose-500/5 border border-rose-500/20 p-4 rounded-xl">
                <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest mb-1.5 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                  Safety Bulletin
                </p>
                <p className="text-xs text-rose-300/80 leading-relaxed">
                  Not a clinical replacement for active crises. Please utilize hotlines in cases of distress.
                </p>
              </div>

              <div className="space-y-3">
                <div className="p-4 bg-[#111] border border-white/5 rounded-xl flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-white">United States Hotline</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400">988</span>
                  </div>
                  <p className="text-[11px] text-white/40 leading-relaxed">Confidential support active 24/7.</p>
                </div>
                <div className="p-4 bg-[#111] border border-white/5 rounded-xl flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-white">Crisis Text Line</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 text-rose-400">HOME to 741741</span>
                  </div>
                </div>
                <div className="p-4 bg-[#111] border border-white/5 rounded-xl flex flex-col gap-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-white">Clinical Directory</span>
                    <a
                      href="https://findahelpline.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono text-blue-500 hover:underline"
                    >
                      findahelpline.com
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Profile and Login/Logout Area */}
        <div className="mt-auto pt-6 border-t border-white/5 flex flex-col gap-4 flex-shrink-0">
          {authLoading ? (
            <div className="flex items-center gap-2 text-white/40 text-xs py-2">
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-white/50" />
              <span>Authenticating session...</span>
            </div>
          ) : user ? (
            <div className="flex items-center gap-4">
              <img
                src={user.photoURL || "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=128"}
                alt="User avatar"
                className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/20"
                referrerPolicy="no-referrer"
              />
              <div>
                <p className="text-sm font-bold text-white leading-tight">{user.displayName || "Patient"}</p>
                <button
                  onClick={handleSignOut}
                  className="text-[10px] text-white/40 hover:text-white uppercase tracking-wider font-mono block mt-0.5 text-left transition-colors cursor-pointer"
                >
                  Logout session
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={handleSignIn}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs py-3 px-4 rounded-xl transition-all uppercase tracking-wider shadow-lg active:scale-95 cursor-pointer"
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>Sign in with Google</span>
            </button>
          )}
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative bg-[#0A0A0A] h-full overflow-hidden">
        
        {/* Chat Header */}
        <header className="h-20 flex-shrink-0 flex items-center justify-between px-6 md:px-10 border-b border-white/5 bg-[#0A0A0A] z-10">
          <div className="flex items-center gap-3">
            <div className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
            </div>
            <h2 className="text-xs md:text-sm font-medium text-white/80 tracking-tight">
              Active Protocol: <span className="font-bold text-white">Psychodynamic Evaluation</span>
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden md:inline text-[10px] font-mono text-white/30 uppercase tracking-widest">
              {dbSyncStatus === "synced" ? "Firestore: Synced" : "Temporal Sandbox"}
            </span>
            <button
              onClick={() => {
                const welcomeTemplate = user
                  ? `Greetings ${user.displayName || "Explorer"}. I've initialized your secure space. Let's examine any recurring thoughts, relational loops, attachment dynamics, or cognitive habits you would like to explore today. Tell me: what has been occupying your mind?`
                  : "Welcome to EllA AI. I am your academic and analytical psychological consultant. Please feel free to explore your thoughts, feelings, relational dynamics, or behavioral triggers in complete depth here. For a fully personalized and secured session, please sign in with Google or select one of the explore options below.";
                setMessages([
                  {
                    sender: "model",
                    text: welcomeTemplate,
                    timestamp: new Date().toISOString(),
                  },
                ]);
              }}
              className="text-xs font-bold uppercase tracking-widest text-blue-500 hover:text-blue-400 transition-colors cursor-pointer"
            >
              New Session
            </button>
          </div>
        </header>

        {/* Chat History Panel */}
        <div className="flex-1 p-6 md:p-10 space-y-10 overflow-y-auto bg-[#0A0A0A] scrollbar-thin">
          <AnimatePresence initial={false}>
            {messages.map((msg, index) => {
              const isUser = msg.sender === "user";
              if (isUser) {
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="max-w-3xl"
                  >
                    <p className="text-[10px] uppercase tracking-widest text-white/30 font-bold mb-4 select-none">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — Patient
                    </p>
                    <p className="text-xl md:text-2xl font-light text-white leading-relaxed tracking-tight select-text">
                      "{msg.text}"
                    </p>
                  </motion.div>
                );
              } else {
                return (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    className="max-w-3xl ml-auto relative"
                  >
                    <p className="text-[10px] uppercase tracking-widest text-blue-400 font-bold mb-4 text-right select-none">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} — EllA AI
                    </p>
                    <div className="bg-[#111111] border border-white/10 p-6 md:p-8 rounded-3xl shadow-2xl relative">
                      <p className="text-base md:text-lg font-serif italic text-white/90 leading-relaxed select-text whitespace-pre-wrap">
                        {msg.text}
                      </p>
                      <div className="absolute -left-3 top-8 w-6 h-6 bg-[#111111] border-l border-t border-white/10 rotate-[-45deg] z-0 hidden md:block"></div>
                    </div>
                  </motion.div>
                );
              }
            })}

            {/* Synthesizing / Typing loader */}
            {isProcessing && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="max-w-3xl"
              >
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5 items-center">
                    <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:0.1s]" />
                    <span className="w-1.5 h-1.5 bg-white/40 rounded-full animate-bounce [animation-delay:0.2s]" />
                  </div>
                  <span className="text-[10px] uppercase tracking-widest text-white/25 font-bold select-none">
                    EllA is synthesizing context...
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>

        {/* User Input Area */}
        <div className="p-6 md:p-10 border-t border-white/5 bg-[#0A0A0A] flex-shrink-0">
          <div className="relative max-w-4xl mx-auto group">
            <input
              id="message-input-box"
              type="text"
              placeholder="Describe your current state or reflection..."
              disabled={isProcessing}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  sendMessage();
                }
              }}
              className="w-full bg-white/5 border border-white/10 rounded-2xl py-5 px-6 md:py-6 md:px-8 pr-36 text-base md:text-lg font-medium text-white placeholder-white/20 focus:outline-none focus:border-blue-500/50 focus:bg-white/10 transition-all disabled:opacity-50"
            />
            <div className="absolute right-4 top-1/2 -translate-y-1/2 flex gap-3">
              <button
                onClick={() => sendMessage()}
                disabled={!inputText.trim() || isProcessing}
                className="px-4 py-2.5 bg-blue-600 rounded-xl text-xs font-bold text-white hover:bg-blue-500 disabled:bg-white/5 disabled:text-white/20 transition-all uppercase tracking-widest active:scale-[0.97] cursor-pointer"
              >
                SEND
              </button>
            </div>
          </div>
          <p className="text-center mt-6 text-[10px] text-white/20 font-medium uppercase tracking-[0.2em] select-none">
            Developed by Aswad for Mental Welfare • Powered by Gemini 3.5 Flash • Firebase Encrypted
          </p>
        </div>

      </main>
    </div>
  );
}
