import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { PhoneOff, Mic, MicOff, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import { VoiceCallService } from '../services/websocket';
import { VoiceRecorder } from '../services/audio';
import { createCall, getChats, getCalls, deleteChat, deleteCall } from '../services/api';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../contexts/AuthContext';

// ── State machine phases ──────────────────────────────────────────────────────
const P = {
  CONNECTING: 'connecting',
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  ERROR: 'error',
};

const ORB_COLORS = {
  [P.CONNECTING]:  { bg: 'rgba(100,100,120,0.5)',  glow: 'rgba(100,100,120,0.25)', pulse: false },
  [P.IDLE]:        { bg: 'rgba(80,80,180,0.55)',   glow: 'rgba(80,80,180,0.25)',   pulse: false },
  [P.LISTENING]:   { bg: 'rgba(59,130,246,0.65)',  glow: 'rgba(59,130,246,0.45)',  pulse: true  },
  [P.PROCESSING]:  { bg: 'rgba(250,204,21,0.55)',  glow: 'rgba(250,204,21,0.35)',  pulse: false },
  [P.SPEAKING]:    { bg: 'rgba(52,211,153,0.6)',   glow: 'rgba(52,211,153,0.4)',   pulse: true  },
  [P.ERROR]:       { bg: 'rgba(239,68,68,0.45)',   glow: 'rgba(239,68,68,0.25)',   pulse: false },
};

const STATUS_LABEL = {
  [P.CONNECTING]:  'Connecting…',
  [P.IDLE]:        'Tap mic to speak',
  [P.LISTENING]:   'Listening…',
  [P.PROCESSING]:  'Thinking…',
  [P.SPEAKING]:    'Speaking…',
  [P.ERROR]:       'Error — tap retry',
};

/** Strip markdown symbols for clean display text */
function stripMarkdown(text) {
  return text
    .replace(/\*{1,3}(.*?)\*{1,3}/gs, '$1')
    .replace(/_{1,3}(.*?)_{1,3}/gs, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/`+([^`]*)`+/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^[\s]*[-•*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export default function VoiceCallPage() {
  const navigate = useNavigate();
  const { conversationId: paramConvId } = useParams();
  const { user } = useAuth();

  // ── State ─────────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState(P.CONNECTING);
  const [autoListen, setAutoListen] = useState(true);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState('');
  const [convHistory, setConvHistory] = useState([]); // {id, role, content, streaming?}

  // Sidebar states
  const [conversations, setConversations] = useState([]); // chats
  const [calls, setCalls] = useState([]);
  const [loadingSidebar, setLoadingSidebar] = useState(true);

  const serviceRef = useRef(null);
  const recorderRef = useRef(null);
  const phaseRef = useRef(P.CONNECTING);
  const autoListenRef = useRef(true);
  const mutedRef = useRef(false);
  const callIdRef = useRef(null);
  const aiTextRef = useRef('');           // accumulate streaming AI text
  const pendingTranscriptRef = useRef(''); // track current transcript to avoid duplicates
  const bubblesEndRef = useRef(null);
  const createCallPromiseRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { autoListenRef.current = autoListen; }, [autoListen]);
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  // Auto-scroll bubbles
  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [convHistory]);

  // ── Load Sidebar Data ─────────────────────────────────────────────────────
  const loadSidebar = useCallback(async () => {
    try {
      setLoadingSidebar(true);
      const [convRes, callsRes] = await Promise.all([
        getChats(),
        getCalls(),
      ]);
      setConversations(convRes.data.chats || []);
      setCalls(callsRes.data.calls || []);
    } catch {
      // Silently fail
    } finally {
      setLoadingSidebar(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadSidebar();
    }
  }, [user, loadSidebar]);

  // ── Start listening ───────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    const cur = phaseRef.current;
    if (cur === P.LISTENING || cur === P.PROCESSING || cur === P.SPEAKING || cur === P.CONNECTING) return;
    if (!serviceRef.current?.isConnected) return;
    try {
      recorderRef.current = new VoiceRecorder();
      await recorderRef.current.start();
      setPhase(P.LISTENING);
    } catch {
      setError('Microphone access denied.');
      setPhase(P.ERROR);
    }
  }, []);

  // ── Stop mic + send ───────────────────────────────────────────────────────
  const stopListening = useCallback(async () => {
    if (phaseRef.current !== P.LISTENING) return;
    if (!recorderRef.current) return;
    setPhase(P.PROCESSING);
    try {
      const blob = await recorderRef.current.stop();
      recorderRef.current = null;
      if (serviceRef.current?.isConnected) serviceRef.current.sendAudio(blob);
    } catch {
      setPhase(P.IDLE);
    }
  }, []);

  // ── Connect to WS ─────────────────────────────────────────────────────────
  const connectWS = useCallback(async (callId) => {
    if (serviceRef.current) serviceRef.current.disconnect();
    serviceRef.current = new VoiceCallService();

    try {
      await serviceRef.current.connect(callId, {
        onTranscript: (text) => {
          if (!text.trim()) return;
          pendingTranscriptRef.current = text;
          aiTextRef.current = '';

          // Add user bubble (only once per transcript)
          setConvHistory(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'user' && last?.content === text) return prev;
            return [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }];
          });
          setPhase(P.PROCESSING);
        },
        onToken: (token) => {
          aiTextRef.current += token;
          const clean = stripMarkdown(aiTextRef.current);
          setPhase(P.SPEAKING);
          setConvHistory(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              return [...prev.slice(0, -1), { ...last, content: clean }];
            }
            return [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: clean, streaming: true }];
          });
        },
        onDone: () => {
          setConvHistory(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              return [...prev.slice(0, -1), { ...last, streaming: false }];
            }
            return prev;
          });
          pendingTranscriptRef.current = '';
          setPhase(P.IDLE);
          if (autoListenRef.current && !mutedRef.current) {
            setTimeout(() => startListening(), 600);
          }
        },
        onError: (msg) => {
          setError(msg);
          setPhase(P.ERROR);
        },
      });

      setPhase(P.IDLE);
      if (autoListenRef.current) {
        setTimeout(() => startListening(), 700);
      }
    } catch {
      setError('Could not connect to voice server.');
      setPhase(P.ERROR);
    }
  }, [startListening]);

  const getOrCreateCall = async () => {
    if (createCallPromiseRef.current) {
      return createCallPromiseRef.current;
    }
    createCallPromiseRef.current = createCall('Voice Call')
      .then(res => res.data.id)
      .catch(err => {
        createCallPromiseRef.current = null;
        throw err;
      });
    return createCallPromiseRef.current;
  };

  // ── Mount: create call doc then connect ───────────────────────────────────
  useEffect(() => {
    let active = true;

    const init = async () => {
      let callId = (paramConvId && paramConvId !== 'new') ? paramConvId : null;
      
      // If we are opening a past call, load its history of exchanges
      if (callId) {
        try {
          const api = await import('../services/api');
          const res = await api.getCallMessages(callId);
          const mapped = [];
          (res.data.messages || []).forEach(msg => {
            mapped.push({
              id: `${msg.id}-u`,
              role: 'user',
              content: msg.transcript
            });
            mapped.push({
              id: `${msg.id}-a`,
              role: 'assistant',
              content: msg.response
            });
          });
          if (active) {
            setConvHistory(mapped);
          }
        } catch (e) {
          console.error("Error loading past exchanges:", e);
        }
      }

      if (!callId) {
        try {
          callId = await getOrCreateCall();
          if (active) {
            // Replace url from /voice-call/new to actual /voice-call/:id without refreshing
            navigate(`/voice-call/${callId}`, { replace: true });
          }
        } catch (err) {
          console.error("Error creating call:", err);
        }
      }
      
      callIdRef.current = callId;
      if (active && callId) await connectWS(callId);
    };

    init();

    return () => {
      active = false;
      if (recorderRef.current) recorderRef.current.cancel();
      if (serviceRef.current) serviceRef.current.disconnect();
    };
  }, [paramConvId, navigate]); // eslint-disable-line

  // ── Retry ─────────────────────────────────────────────────────────────────
  const handleRetry = useCallback(() => {
    setPhase(P.CONNECTING);
    setError('');
    connectWS(callIdRef.current);
  }, [connectWS]);

  // ── End call ─────────────────────────────────────────────────────────────
  const endCall = () => {
    if (recorderRef.current) recorderRef.current.cancel();
    if (serviceRef.current) serviceRef.current.disconnect();
    navigate('/chat');
  };

  // ── Mic button tap ────────────────────────────────────────────────────────
  const handleMicClick = () => {
    if (phase === P.LISTENING) stopListening();
    else if (phase === P.IDLE) startListening();
  };

  // ── Sidebar Action Handlers ────────────────────────────────────────────────
  const handleSelect = (id, isCallItem) => {
    if (isCallItem) {
      navigate(`/voice-call/${id}`);
    } else {
      navigate('/chat', { state: { activeId: id } });
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await createChat();
      navigate('/chat', { state: { activeId: res.data.id } });
    } catch {
      alert('Failed to create chat.');
    }
  };

  const handleNewCall = () => {
    navigate('/voice-call/new');
  };

  const handleDeleteChat = async (id) => {
    try {
      await deleteChat(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
    } catch {
      alert('Failed to delete chat.');
    }
  };

  const handleDeleteCall = async (id) => {
    try {
      await deleteCall(id);
      setCalls((prev) => prev.filter((c) => c.id !== id));
      if (callIdRef.current === id) {
        navigate('/chat');
      }
    } catch {
      alert('Failed to delete call.');
    }
  };

  const orb = ORB_COLORS[phase];
  const label = STATUS_LABEL[phase] || '';
  const displayError = phase === P.ERROR ? (error || 'Something went wrong') : '';

  return (
    <div style={s.root}>
      {/* Sidebar on the Left */}
      <Sidebar
        conversations={conversations}
        calls={calls}
        activeId={paramConvId}
        loading={loadingSidebar}
        onSelect={handleSelect}
        onNew={handleNewChat}
        onNewCall={handleNewCall}
        onDelete={handleDeleteChat}
        onDeleteCall={handleDeleteCall}
        user={{
          displayName: user?.displayName,
          email: user?.email,
          photoURL: user?.photoURL,
        }}
      />

      {/* Split layout on the Right */}
      <div style={s.splitLayout}>

        {/* ── LEFT of layout: Conversation bubbles ───────────────────────── */}
        <div style={s.bubblesPanel}>
          <div style={s.bubblesHeader}>
            <span style={s.bubblesHeaderTitle}>Conversation</span>
          </div>
          <div style={s.bubblesScroll}>
            <AnimatePresence mode="popLayout" initial={false}>
              {convHistory.length === 0 && (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={s.emptyBubbles}
                >
                  Start speaking — your conversation will appear here.
                </motion.p>
              )}
              {convHistory.map((msg) => {
                const isUser = msg.role === 'user';
                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    style={{
                      ...s.bubble,
                      alignSelf: isUser ? 'flex-end' : 'flex-start',
                      background: isUser
                        ? 'rgba(59,130,246,0.22)'
                        : 'rgba(52,211,153,0.14)',
                      borderColor: isUser
                        ? 'rgba(59,130,246,0.4)'
                        : 'rgba(52,211,153,0.25)',
                      borderBottomRightRadius: isUser ? 6 : 16,
                      borderBottomLeftRadius: isUser ? 16 : 6,
                      boxShadow: isUser
                        ? '0 4px 16px rgba(59, 130, 246, 0.12)'
                        : 'none',
                    }}
                  >
                    <p style={s.bubbleText}>
                      {msg.content}
                      {msg.streaming && <span style={s.cursor}>▌</span>}
                    </p>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={bubblesEndRef} />
          </div>
        </div>

        {/* ── RIGHT of layout: Orb + Controls ────────────────────────────── */}
        <div style={s.orbPanel}>
          {/* Header */}
          <div style={s.orbHeader}>
            <div style={s.logoMark}>✦</div>
            <h1 style={s.title}><span className="gradient-text">Voice</span> Assistant</h1>
            <p style={s.subtitle}>AI-powered real-time conversation</p>
          </div>

          {/* Orb */}
          <div style={s.orbArea}>
            {orb.pulse && [0, 1, 2].map(i => (
              <motion.div
                key={i}
                style={s.pulseRing}
                initial={{ scale: 1, opacity: 0.5 }}
                animate={{ scale: 2.8, opacity: 0 }}
                transition={{ duration: 2, delay: i * 0.65, repeat: Infinity, ease: 'easeOut' }}
              />
            ))}

            <motion.div
              style={s.orb}
              animate={{
                background: orb.bg,
                boxShadow: `0 0 60px 20px ${orb.glow}, 0 0 120px 40px ${orb.glow}40`,
              }}
              transition={{ duration: 0.5 }}
            >
              <div style={s.orbBars}>
                {Array.from({ length: 7 }).map((_, i) => (
                  <motion.span
                    key={i}
                    style={s.orbBar}
                    animate={phase === P.LISTENING || phase === P.SPEAKING
                      ? { scaleY: [0.15, 0.55 + Math.sin(i * 1.3) * 0.4, 0.15] }
                      : { scaleY: 0.12 }}
                    transition={{ duration: 0.48 + i * 0.08, repeat: Infinity, delay: i * 0.06 }}
                  />
                ))}
              </div>
            </motion.div>
          </div>

          {/* Status */}
          <motion.p
            style={s.statusLabel}
            key={phase}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
          >
            {displayError || label}
          </motion.p>

          {/* Controls row */}
          <div style={s.controls}>
            {/* Auto-listen toggle */}
            <button
              style={{ ...s.toggleBtn, ...(autoListen ? s.toggleBtnOn : {}) }}
              onClick={() => setAutoListen(v => !v)}
              title={autoListen ? 'Auto-listen ON' : 'Auto-listen OFF'}
            >
              <Volume2 size={13} />
              {autoListen ? 'Auto' : 'Manual'}
            </button>

            {/* Mic / retry */}
            {phase === P.ERROR ? (
              <motion.button whileTap={{ scale: 0.93 }} style={s.micBtn} onClick={handleRetry}>
                <RotateCcw size={26} />
              </motion.button>
            ) : (
              <motion.button
                whileTap={{ scale: 0.93 }}
                style={s.micBtn}
                animate={{
                  borderColor: phase === P.LISTENING ? 'rgba(59, 130, 246, 0.7)' : 'var(--border)',
                  boxShadow: phase === P.LISTENING ? '0 0 30px 6px rgba(59, 130, 246, 0.45)' : 'none',
                  background: phase === P.LISTENING ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-glass-strong)',
                  color: phase === P.LISTENING ? '#60a5fa' : 'var(--text-primary)',
                  opacity: (phase === P.PROCESSING || phase === P.SPEAKING || phase === P.CONNECTING) ? 0.35 : 1,
                  pointerEvents: (phase === P.PROCESSING || phase === P.SPEAKING || phase === P.CONNECTING) ? 'none' : 'auto'
                }}
                onClick={handleMicClick}
                id="voice-call-mic-btn"
              >
                {phase === P.LISTENING ? <MicOff size={26} /> : <Mic size={26} />}
                {phase === P.LISTENING && (
                  <>
                    <span style={{ ...s.ring, animationDelay: '0s' }} />
                    <span style={{ ...s.ring, animationDelay: '0.55s' }} />
                  </>
                )}
              </motion.button>
            )}

            {/* Mute toggle */}
            <button
              style={{ ...s.toggleBtn, ...(muted ? s.toggleBtnMuted : {}) }}
              onClick={() => setMuted(v => !v)}
              title={muted ? 'Unmute' : 'Mute auto-listen'}
            >
              {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              {muted ? 'Muted' : 'Live'}
            </button>
          </div>

          <p style={s.hint}>
            {phase === P.LISTENING
              ? 'Tap mic to stop & send'
              : autoListen
              ? 'Auto-listen restarts after each response'
              : 'Tap mic to speak'}
          </p>

          {/* End call */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={endCall}
            style={s.endBtn}
            id="end-call-btn"
          >
            <PhoneOff size={15} />
            End Call
          </motion.button>
        </div>
      </div>

      <style>{`
        @keyframes ring-expand {
          0%   { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2.5); opacity: 0; }
        }
        @keyframes cursor-blink {
          0%, 100% { opacity: 1; }
          50%       { opacity: 0; }
        }
        .conv-item:hover .conv-delete-btn { opacity: 1 !important; }
      `}</style>
    </div>
  );
}
const s = {
  root: {
    height: '100vh',
    display: 'flex',
    alignItems: 'stretch',
    position: 'relative',
    overflow: 'hidden',
    background: '#07070c',
  },
  // ── Split layout ────────────────────────────────────────────────────────
  splitLayout: {
    display: 'flex',
    flex: 1,
    height: '100%',
    position: 'relative',
    zIndex: 1,
    minWidth: 0,
  },

  // ── LEFT: bubbles ───────────────────────────────────────────────────────
  bubblesPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid var(--border)',
    minWidth: 0,
  },
  bubblesHeader: {
    padding: '20px 24px 14px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  bubblesHeaderTitle: {
    fontSize: '0.75rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  bubblesScroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  emptyBubbles: {
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    textAlign: 'center',
    marginTop: 40,
    lineHeight: 1.7,
    padding: '0 24px',
  },
  bubble: {
    maxWidth: '78%',
    padding: '12px 16px',
    borderRadius: 16,
    border: '1px solid',
    backdropFilter: 'blur(8px)',
    lineHeight: 1.6,
  },
  bubbleText: {
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
    lineHeight: 1.6,
    margin: 0,
    whiteSpace: 'pre-wrap',
  },
  cursor: {
    animation: 'cursor-blink 0.8s ease-in-out infinite',
    marginLeft: 1,
    opacity: 1,
  },

  // ── RIGHT: orb panel ────────────────────────────────────────────────────
  orbPanel: {
    width: 360,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    padding: '32px 28px',
  },
  orbHeader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
  },
  logoMark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    background: 'var(--gradient-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 20,
    boxShadow: '0 8px 28px var(--accent-glow)',
    marginBottom: 2,
  },
  title: {
    fontSize: '1.55rem',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    margin: 0,
  },
  subtitle: {
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    margin: 0,
  },
  orbArea: {
    position: 'relative',
    width: 150,
    height: 150,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.12)',
  },
  orb: {
    width: 130,
    height: 130,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(12px)',
    border: '2px solid rgba(255,255,255,0.12)',
    zIndex: 1,
  },
  orbBars: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    height: 36,
  },
  orbBar: {
    width: 4,
    height: '100%',
    background: 'rgba(255,255,255,0.85)',
    borderRadius: 4,
    transformOrigin: 'center',
  },
  statusLabel: {
    fontSize: '0.88rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    margin: 0,
    textAlign: 'center',
    minHeight: '1.4em',
  },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  toggleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: '0.73rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    padding: '7px 12px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  toggleBtnOn: {
    background: 'rgba(52,211,153,0.12)',
    borderColor: 'rgba(52,211,153,0.4)',
    color: '#34d399',
  },
  toggleBtnMuted: {
    background: 'rgba(239,68,68,0.1)',
    borderColor: 'rgba(239,68,68,0.35)',
    color: '#f87171',
  },
  micBtn: {
    width: 70,
    height: 70,
    borderRadius: '50%',
    border: '2px solid var(--border)',
    background: 'var(--bg-glass-strong)',
    color: 'var(--text-primary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    transition: 'all 0.2s',
    userSelect: 'none',
  },
  micBtnListening: {
    background: 'rgba(59,130,246,0.2)',
    borderColor: 'rgba(59,130,246,0.7)',
    color: '#60a5fa',
    boxShadow: '0 0 24px rgba(59,130,246,0.35)',
  },
  ring: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '2px solid rgba(59,130,246,0.4)',
    animation: 'ring-expand 1.4s ease-out infinite',
  },
  hint: {
    fontSize: '0.74rem',
    color: 'var(--text-muted)',
    textAlign: 'center',
    margin: 0,
    maxWidth: 240,
    lineHeight: 1.5,
  },
  endBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '9px 22px',
    borderRadius: 999,
    border: '1px solid rgba(239,68,68,0.35)',
    background: 'rgba(239,68,68,0.1)',
    color: '#f87171',
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
