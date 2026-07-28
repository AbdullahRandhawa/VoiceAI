import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { PhoneOff, Mic, MicOff, RotateCcw, Pause, Play, PlusCircle } from 'lucide-react';
import { VoiceCallService } from '../services/websocket';
import { VoiceRecorder, SilenceDetector } from '../services/audio';
import {
  createChat, getChats, getCalls,
  deleteChat, deleteCall, getCallMessages, getCall,
} from '../services/api';
import Sidebar from '../components/Sidebar';
import { useAuth } from '../contexts/AuthContext';

// ── Phase state machine ───────────────────────────────────────────────────────
const P = {
  CONNECTING: 'connecting',
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  PAUSED: 'paused',   // paused by user in active session
  ENDED: 'ended',    // call ended or read-only past call view
  ERROR: 'error',
};

const ORB_COLORS = {
  [P.CONNECTING]: { bg: 'rgba(100,100,120,0.5)', glow: 'rgba(100,100,120,0.25)', pulse: false },
  [P.IDLE]: { bg: 'rgba(80,80,180,0.55)', glow: 'rgba(80,80,180,0.25)', pulse: false },
  [P.LISTENING]: { bg: 'rgba(59,130,246,0.65)', glow: 'rgba(59,130,246,0.45)', pulse: true },
  [P.PROCESSING]: { bg: 'rgba(250,204,21,0.55)', glow: 'rgba(250,204,21,0.35)', pulse: false },
  [P.SPEAKING]: { bg: 'rgba(52,211,153,0.6)', glow: 'rgba(52,211,153,0.4)', pulse: true },
  [P.PAUSED]: { bg: 'rgba(180,100,220,0.5)', glow: 'rgba(180,100,220,0.2)', pulse: false },
  [P.ENDED]: { bg: 'rgba(60,60,80,0.5)', glow: 'rgba(60,60,80,0.2)', pulse: false },
  [P.ERROR]: { bg: 'rgba(239,68,68,0.45)', glow: 'rgba(239,68,68,0.25)', pulse: false },
};

const STATUS_LABEL = {
  [P.CONNECTING]: 'Connecting…',
  [P.IDLE]: 'Ready',
  [P.LISTENING]: 'Listening…',
  [P.PROCESSING]: 'Thinking…',
  [P.SPEAKING]: 'Speaking…',
  [P.PAUSED]: 'Paused',
  [P.ENDED]: 'Call ended',
  [P.ERROR]: 'Error — tap retry',
};

const SILENCE_MODES = [
  { key: '1s', label: '1s', ms: 1000 },
  { key: '2s', label: '2s', ms: 2000 },
  { key: '3s', label: '3s', ms: 3000 },
  { key: 'manual', label: 'Manual', ms: null },
];

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

  // ── Core state ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState(P.CONNECTING);
  const [silenceMode, setSilenceMode] = useState('2s');
  const [convHistory, setConvHistory] = useState([]);
  const [error, setError] = useState('');
  const [volume, setVolume] = useState(0);
  const [isPastCall, setIsPastCall] = useState(false);
  const [callAudioUrl, setCallAudioUrl] = useState(null);

  // Sidebar
  const [conversations, setConversations] = useState([]);
  const [calls, setCalls] = useState([]);
  const [loadingSidebar, setLoadingSidebar] = useState(true);

  // ── Refs ────────────────────────────────────────────────────────────────────
  const serviceRef = useRef(null);
  const recorderRef = useRef(null);
  const silenceRef = useRef(null);
  const volumePollRef = useRef(null);
  const phaseRef = useRef(P.CONNECTING);
  const silenceModeRef = useRef('2s');
  const activeCallIdRef = useRef(null); // Track active session call ID
  const aiTextRef = useRef('');
  const hadExchangeRef = useRef(false);
  const prePausePhaseRef = useRef(P.IDLE);
  const bubblesEndRef = useRef(null);

  // Keep refs in sync
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { silenceModeRef.current = silenceMode; }, [silenceMode]);

  // Auto-scroll transcript
  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [convHistory]);

  // ── Sidebar data ─────────────────────────────────────────────────────────────
  const loadSidebar = useCallback(async () => {
    try {
      setLoadingSidebar(true);
      const [convRes, callsRes] = await Promise.all([getChats(), getCalls()]);
      setConversations(convRes.data.chats || []);
      setCalls(callsRes.data.calls || []);
    } catch { /* silently fail */ } finally {
      setLoadingSidebar(false);
    }
  }, []);

  useEffect(() => { if (user) loadSidebar(); }, [user, loadSidebar]);

  // ── Audio-Synced Volume Poller ────────────────────────────────────────────────
  const startVolumePoll = useCallback(() => {
    if (volumePollRef.current) clearInterval(volumePollRef.current);
    volumePollRef.current = setInterval(() => {
      const curPhase = phaseRef.current;
      if (curPhase === P.LISTENING) {
        const micRms = silenceRef.current ? silenceRef.current.getRMS() : 0;
        setVolume(micRms / 0.08);
      } else if (curPhase === P.SPEAKING) {
        const aiRms = serviceRef.current ? serviceRef.current.getPlaybackRMS() : 0;
        setVolume(aiRms / 0.08);
      } else {
        setVolume(0);
      }
    }, 80);
  }, []);

  const stopVolumePoll = useCallback(() => {
    if (volumePollRef.current) { clearInterval(volumePollRef.current); volumePollRef.current = null; }
    setVolume(0);
  }, []);

  // ── Teardown mic & audio ──────────────────────────────────────────────────────
  const cleanupMic = useCallback(() => {
    silenceRef.current?.stop();
    silenceRef.current = null;
    stopVolumePoll();
    recorderRef.current?.cancel();
    recorderRef.current = null;
  }, [stopVolumePoll]);

  // ── Teardown whole session ──────────────────────────────────────────────────
  const teardownCall = useCallback(() => {
    cleanupMic();
    if (serviceRef.current) {
      serviceRef.current.disconnect();
      serviceRef.current = null;
    }
  }, [cleanupMic]);

  // ── Stop listening & send audio ──────────────────────────────────────────────
  const stopListeningAndSend = useCallback(async () => {
    if (phaseRef.current !== P.LISTENING) return;
    if (!recorderRef.current) return;

    silenceRef.current?.stop();
    silenceRef.current = null;

    setPhase(P.PROCESSING);
    try {
      const blob = await recorderRef.current.stop();
      recorderRef.current = null;
      if (serviceRef.current?.isConnected) serviceRef.current.sendAudio(blob);
    } catch {
      setPhase(P.IDLE);
    }
  }, []);

  // ── Start listening ──────────────────────────────────────────────────────────
  const startListening = useCallback(async () => {
    const cur = phaseRef.current;
    if (cur === P.LISTENING || cur === P.PROCESSING || cur === P.SPEAKING ||
      cur === P.CONNECTING || cur === P.PAUSED || cur === P.ENDED) return;
    if (!serviceRef.current?.isConnected) return;

    try {
      recorderRef.current = new VoiceRecorder();
      await recorderRef.current.start();
      setPhase(P.LISTENING);

      const mode = SILENCE_MODES.find(m => m.key === silenceModeRef.current);
      if (mode?.ms) {
        silenceRef.current = new SilenceDetector();
        silenceRef.current.start(recorderRef.current.stream, mode.ms, () => {
          stopListeningAndSend();
        });
      }
      startVolumePoll();
    } catch {
      setError('Microphone access denied.');
      setPhase(P.ERROR);
    }
  }, [startVolumePoll, stopListeningAndSend]);

  // ── Dynamic Silence Mode Change ─────────────────────────────────────────────
  const handleSilenceModeChange = useCallback((newKey) => {
    setSilenceMode(newKey);
    silenceModeRef.current = newKey;
    if (phaseRef.current === P.LISTENING && recorderRef.current?.stream) {
      silenceRef.current?.stop();
      silenceRef.current = null;
      const mode = SILENCE_MODES.find(m => m.key === newKey);
      if (mode?.ms) {
        silenceRef.current = new SilenceDetector();
        silenceRef.current.start(recorderRef.current.stream, mode.ms, () => {
          stopListeningAndSend();
        });
      }
    }
  }, [stopListeningAndSend]);

  // ── Universal Pause ──────────────────────────────────────────────────────────
  const pauseCall = useCallback(() => {
    const cur = phaseRef.current;
    if (cur === P.PAUSED || cur === P.ENDED || cur === P.ERROR || cur === P.CONNECTING) return;

    prePausePhaseRef.current = cur;

    if (cur === P.LISTENING) {
      silenceRef.current?.pause();
      recorderRef.current?.pause();
    } else if (cur === P.SPEAKING || cur === P.PROCESSING) {
      serviceRef.current?.pausePlayback();
    }

    setPhase(P.PAUSED);
  }, []);

  // ── Universal Resume ─────────────────────────────────────────────────────────
  const resumeCall = useCallback(() => {
    if (phaseRef.current !== P.PAUSED) return;

    const prev = prePausePhaseRef.current || P.IDLE;

    if (prev === P.LISTENING) {
      silenceRef.current?.resume();
      recorderRef.current?.resume();
      setPhase(P.LISTENING);
    } else if (prev === P.SPEAKING || prev === P.PROCESSING) {
      serviceRef.current?.resumePlayback();
      setPhase(prev);
    } else {
      setPhase(P.IDLE);
      setTimeout(() => startListening(), 200);
    }
  }, [startListening]);

  // ── Mic button handler ───────────────────────────────────────────────────────
  const handleMicClick = () => {
    if (phase === P.LISTENING) stopListeningAndSend();
    else if (phase === P.IDLE) startListening();
  };

  // ── Connect WebSocket for active calls ───────────────────────────────────────
  const connectWS = useCallback(async (callId) => {
    teardownCall();
    serviceRef.current = new VoiceCallService();

    try {
      await serviceRef.current.connect(callId, {
        onCreated: (newCallId, title) => {
          activeCallIdRef.current = newCallId;
          hadExchangeRef.current = true;
          // Replace the dummy sidebar entry (or prepend if no dummy exists)
          setCalls(prev => {
            const realEntry = { id: newCallId, title, created_at: new Date().toISOString() };
            const withoutDummy = prev.filter(c => c.id !== '_new_call_dummy_');
            return [realEntry, ...withoutDummy];
          });
          navigate(`/voice-call/${newCallId}`, { replace: true });
        },
        onTranscript: (text) => {
          if (!text.trim()) return;
          aiTextRef.current = '';
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
          // Don't switch to SPEAKING yet — wait for actual audio (onAudioStarted)
          // just update the transcript text in PROCESSING phase
          setConvHistory(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              return [...prev.slice(0, -1), { ...last, content: clean }];
            }
            return [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: clean, streaming: true }];
          });
        },
        onAudioStarted: () => {
          // Transition to SPEAKING only when actual audio begins playing
          setPhase(P.SPEAKING);
        },
        onTitle: (newTitle) => {
          if (!newTitle) return;
          const currentId = activeCallIdRef.current || callId;
          setCalls(prev => prev.map(c => c.id === currentId ? { ...c, title: newTitle } : c));
        },
        onDone: () => {
          hadExchangeRef.current = true;
          setConvHistory(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant' && last?.streaming) {
              return [...prev.slice(0, -1), { ...last, streaming: false }];
            }
            return prev;
          });
          // Tear down any lingering mic/silence detector before starting fresh listen
          cleanupMic();
          setPhase(P.IDLE);
          setTimeout(() => {
            if (phaseRef.current === P.IDLE) startListening();
          }, 700);
        },
        onError: (msg) => {
          setError(msg);
          setPhase(P.ERROR);
        },
      });

      setPhase(P.IDLE);
      setTimeout(() => startListening(), 700);
    } catch {
      setError('Could not connect to voice server.');
      setPhase(P.ERROR);
    }
  }, [startListening, teardownCall, navigate]);

  // ── End call (stays on page in ENDED state) ──────────────────────────────────
  const endCall = useCallback(async () => {
    teardownCall();
    setPhase(P.ENDED);

    if (!hadExchangeRef.current && activeCallIdRef.current) {
      // Real call exists but no exchanges — delete it
      try {
        await deleteCall(activeCallIdRef.current);
        setCalls(prev => prev.filter(c => c.id !== activeCallIdRef.current));
      } catch { /* ignore */ }
    } else if (!hadExchangeRef.current) {
      // No real call created yet — remove dummy from sidebar
      setCalls(prev => prev.filter(c => c.id !== '_new_call_dummy_'));
    }
  }, [teardownCall]);

  // ── Main Mount / Route Change Effect ──────────────────────────────────────────
  useEffect(() => {
    let active = true;

    const init = async () => {
      const isHistoricalCall = paramConvId && paramConvId !== 'new' && activeCallIdRef.current !== paramConvId;

      if (isHistoricalCall) {
        // ── HISTORICAL / PAST CALL (Read-Only Transcript View) ────────────────
        teardownCall();
        setIsPastCall(true);
        setPhase(P.ENDED);
        setConvHistory([]);

        try {
          const res = await getCallMessages(paramConvId);
          const mapped = [];
          (res.data.messages || []).forEach(msg => {
            if (msg.transcript) mapped.push({ id: `${msg.id}-u`, role: 'user', content: msg.transcript });
            if (msg.response) mapped.push({ id: `${msg.id}-a`, role: 'assistant', content: msg.response });
          });
          if (active) setConvHistory(mapped);

          // Fetch the call doc to get the Cloudinary audio_url for playback
          try {
            const callRes = await getCall(paramConvId);
            if (active) setCallAudioUrl(callRes.data?.audio_url || null);
          } catch {
            /* audio_url is optional — fail silently */
          }
        } catch (e) {
          if (active) setConvHistory([]);
        }
      } else {
        // ── LIVE ACTIVE CALL SESSION ──────────────────────────────────────────
        setIsPastCall(false);
        setCallAudioUrl(null);
        if (activeCallIdRef.current !== paramConvId) {
          setConvHistory([]);
          hadExchangeRef.current = false;
          activeCallIdRef.current = (paramConvId && paramConvId !== 'new') ? paramConvId : null;
          setPhase(P.CONNECTING);
          await connectWS(activeCallIdRef.current);
        }
      }
    };

    init();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramConvId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      teardownCall();
    };
  }, [teardownCall]);

  // ── Navigation Handlers ──────────────────────────────────────────────────────
  const handleSelect = (id, isCallItem) => {
    teardownCall();
    if (!hadExchangeRef.current && activeCallIdRef.current && !isPastCall) {
      deleteCall(activeCallIdRef.current).catch(() => { });
    }
    activeCallIdRef.current = null;

    if (isCallItem) navigate(`/voice-call/${id}`);
    else navigate('/chat', { state: { activeId: id } });
  };

  const handleNewChat = async () => {
    teardownCall();
    if (!hadExchangeRef.current && activeCallIdRef.current && !isPastCall) {
      deleteCall(activeCallIdRef.current).catch(() => { });
    }
    activeCallIdRef.current = null;
    try {
      const res = await createChat();
      navigate('/chat', { state: { activeId: res.data.id } });
    } catch { alert('Failed to create chat.'); }
  };

  const handleNewCall = () => {
    teardownCall();
    if (!hadExchangeRef.current && activeCallIdRef.current && !isPastCall) {
      deleteCall(activeCallIdRef.current).catch(() => { });
    }
    activeCallIdRef.current = null;
    // Inject a dummy sidebar entry immediately so the UI feels instant
    setCalls(prev => {
      if (prev.some(c => c.id === '_new_call_dummy_')) return prev;
      return [{ id: '_new_call_dummy_', title: 'New Voice Call', _isDummy: true, created_at: new Date().toISOString() }, ...prev];
    });
    navigate('/voice-call/new');
  };

  const handleDeleteChat = async (id) => {
    try {
      await deleteChat(id);
      setConversations(prev => prev.filter(c => c.id !== id));
    } catch { alert('Failed to delete chat.'); }
  };

  const handleDeleteCall = async (id) => {
    try {
      await deleteCall(id);
      setCalls(prev => prev.filter(c => c.id !== id));
      if (paramConvId === id || activeCallIdRef.current === id) {
        teardownCall();
        activeCallIdRef.current = null;
        navigate('/voice-call/new');
      }
    } catch { alert('Failed to delete call.'); }
  };

  const handleRetry = useCallback(() => {
    setPhase(P.CONNECTING);
    setError('');
    connectWS(activeCallIdRef.current);
  }, [connectWS]);

  // ── Derived UI variables ──────────────────────────────────────────────────────
  const orb = ORB_COLORS[phase];
  const label = STATUS_LABEL[phase] || '';
  const displayError = phase === P.ERROR ? (error || 'Something went wrong') : '';
  const callEnded = phase === P.ENDED;
  const callPaused = phase === P.PAUSED;

  let hint = '';
  if (phase === P.LISTENING) {
    const m = SILENCE_MODES.find(m => m.key === silenceMode);
    hint = m?.ms ? `Auto-sends after ${m.label} of silence` : 'Tap mic when done speaking';
  } else if (phase === P.PAUSED) {
    hint = 'Call paused — tap Resume to continue';
  } else if (phase === P.ENDED) {
    hint = isPastCall ? 'Past Call Transcript' : 'Call ended. Transcript saved.';
  } else if (phase === P.IDLE) {
    hint = 'Starting to listen…';
  } else if (phase === P.PROCESSING) {
    hint = 'Thinking…';
  } else if (phase === P.SPEAKING) {
    hint = 'Speaking…';
  }

  return (
    <div style={s.root}>
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

      <div style={s.splitLayout}>
        {/* ── LEFT: Transcript ────────────────────────────────────────── */}
        <div style={s.bubblesPanel}>
          <div style={s.bubblesScroll}>
            <AnimatePresence mode="popLayout" initial={false}>
              {convHistory.length === 0 && (
                <motion.p
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.5 }}
                  style={s.emptyBubbles}
                >
                  {isPastCall
                    ? 'No conversation messages found in this call recording.'
                    : callEnded
                      ? 'No conversation was recorded.'
                      : 'Your conversation will appear here.'}
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
                        ? 'rgba(59,130,246,0.18)'
                        : 'rgba(52,211,153,0.12)',
                      borderColor: isUser
                        ? 'rgba(59,130,246,0.35)'
                        : 'rgba(52,211,153,0.22)',
                      borderBottomRightRadius: isUser ? 6 : 16,
                      borderBottomLeftRadius: isUser ? 16 : 6,
                    }}
                  >
                    <span style={s.bubbleRole}>{isUser ? 'You' : 'Assistant'}</span>
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

        {/* ── RIGHT: Orb Panel / Call Summary Card ───────────────────── */}
        <div style={s.orbPanel}>
          {/* Header without highlighted icon */}
          <div style={s.orbHeader}>
            <h1 style={s.title}><span className="gradient-text">Voice</span> Assistant</h1>
          </div>

          {/* If Past Call: Render clean static Call Summary Card */}
          {isPastCall ? (
            <div style={s.pastCallCard}>
              <div style={s.pastCallBadge}>Call History</div>
              <p style={s.pastCallSummaryText}>
                {convHistory.length > 0
                  ? `${Math.ceil(convHistory.length / 2)} exchange(s) recorded.`
                  : 'Empty voice session.'}
              </p>

              {/* Cloudinary recording player */}
              {callAudioUrl && (
                <div style={s.pastCallAudioWrap}>
                  <p style={s.pastCallAudioLabel}>📼 Full Call Recording</p>
                  <audio
                    controls
                    src={callAudioUrl}
                    style={s.pastCallAudio}
                    id="past-call-audio-player"
                  />
                </div>
              )}

              <motion.button
                whileTap={{ scale: 0.92 }}
                onClick={handleNewCall}
                style={s.newCallBtnLarge}
                id="past-call-start-new-btn"
              >
                <PlusCircle size={18} />
                Start New Voice Call
              </motion.button>
            </div>
          ) : (
            <>
              {/* Active Call Orb */}
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
                    {Array.from({ length: 7 }).map((_, i) => {
                      const realScale = (phase === P.LISTENING || phase === P.SPEAKING)
                        ? Math.max(0.12, Math.min(1, volume * (0.7 + Math.sin(i * 1.2) * 0.3)))
                        : 0.12;
                      return (
                        <motion.span
                          key={i}
                          style={s.orbBar}
                          animate={{ scaleY: realScale }}
                          transition={{ duration: 0.08 }}
                        />
                      );
                    })}
                  </div>
                </motion.div>
              </div>

              {/* Status Label */}
              <motion.p
                style={s.statusLabel}
                key={phase}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {displayError || label}
              </motion.p>

              {/* Controls — hidden when call ended */}
              {!callEnded && (
                <>
                  {/* Auto-send after silence selector */}
                  <div style={s.selectorRow}>
                    <span style={s.selectorLabel}>Auto-send after</span>
                    <div style={s.selectorBtns}>
                      {SILENCE_MODES.map(m => (
                        <button
                          key={m.key}
                          style={{
                            ...s.selectorBtn,
                            ...(silenceMode === m.key ? s.selectorBtnActive : {}),
                            // Visually dim during listening — buttons still work via handleSilenceModeChange
                            opacity: phase === P.LISTENING ? 0.4 : 1,
                            cursor: phase === P.LISTENING ? 'not-allowed' : 'pointer',
                          }}
                          onClick={() => handleSilenceModeChange(m.key)}
                          title={
                            phase === P.LISTENING
                              ? 'Pause the call first to change silence timing'
                              : m.ms
                                ? `Auto-send after ${m.label} of silence`
                                : 'Click mic button manually when done speaking'
                          }
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Mic + Pause row */}
                  <div style={s.micRow}>
                    {!callPaused ? (
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        style={{
                          ...s.secondaryBtn,
                          opacity: (phase === P.CONNECTING) ? 0.3 : 1,
                          pointerEvents: (phase === P.CONNECTING) ? 'none' : 'auto',
                        }}
                        onClick={pauseCall}
                        title="Pause conversation and audio playback"
                        id="voice-call-pause-btn"
                      >
                        <Pause size={14} /> Pause
                      </motion.button>
                    ) : (
                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        style={{ ...s.secondaryBtn, ...s.secondaryBtnActive }}
                        onClick={resumeCall}
                        title="Resume conversation"
                        id="voice-call-resume-btn"
                      >
                        <Play size={14} /> Resume
                      </motion.button>
                    )}

                    {phase === P.ERROR ? (
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        style={s.micBtn}
                        onClick={handleRetry}
                        id="voice-call-retry-btn"
                      >
                        <RotateCcw size={26} />
                      </motion.button>
                    ) : (
                      <motion.button
                        whileTap={{ scale: 0.93 }}
                        style={s.micBtn}
                        animate={{
                          borderColor: phase === P.LISTENING ? 'rgba(59,130,246,0.7)' : 'var(--border)',
                          boxShadow: phase === P.LISTENING ? '0 0 30px 6px rgba(59,130,246,0.45)' : 'none',
                          background: phase === P.LISTENING ? 'rgba(59,130,246,0.15)' : 'var(--bg-glass-strong)',
                          color: phase === P.LISTENING ? '#60a5fa' : 'var(--text-primary)',
                          opacity: (phase === P.PROCESSING || phase === P.SPEAKING || callPaused) ? 0.35 : 1,
                          pointerEvents: (phase === P.PROCESSING || phase === P.SPEAKING || callPaused) ? 'none' : 'auto',
                        }}
                        onClick={handleMicClick}
                        id="voice-call-mic-btn"
                        aria-label={phase === P.LISTENING ? 'Stop recording' : 'Start recording'}
                      >
                        {phase === P.LISTENING ? <MicOff size={26} /> : <Mic size={26} />}
                      </motion.button>
                    )}
                  </div>

                  <p style={s.hint}>{hint}</p>
                </>
              )}

              {/* End Call / Start New Call button */}
              {callEnded ? (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={handleNewCall}
                  style={s.newCallBtn}
                  id="new-call-btn"
                >
                  <Mic size={15} />
                  New Call
                </motion.button>
              ) : (
                <motion.button
                  whileTap={{ scale: 0.9 }}
                  onClick={endCall}
                  style={s.endBtn}
                  id="end-call-btn"
                >
                  <PhoneOff size={15} />
                  End Call
                </motion.button>
              )}
            </>
          )}
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
      `}</style>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  root: {
    height: '100vh',
    display: 'flex',
    alignItems: 'stretch',
    position: 'relative',
    overflow: 'hidden',
    background: '#07070c',
  },
  splitLayout: {
    display: 'flex',
    flex: 1,
    height: '100%',
    position: 'relative',
    zIndex: 1,
    minWidth: 0,
  },

  // LEFT: transcript
  bubblesPanel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  bubblesScroll: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  emptyBubbles: {
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    textAlign: 'center',
    marginTop: 50,
    lineHeight: 1.7,
    padding: '0 24px',
  },
  bubble: {
    maxWidth: '78%',
    padding: '10px 14px',
    borderRadius: 16,
    border: '1px solid',
    backdropFilter: 'blur(8px)',
  },
  bubbleRole: {
    display: 'block',
    fontSize: '0.65rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    marginBottom: 4,
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
  },

  // RIGHT: orb panel
  orbPanel: {
    width: 340,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: '28px 22px',
  },
  orbHeader: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontSize: '1.4rem',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    margin: 0,
  },
  subtitle: {
    fontSize: '0.74rem',
    color: 'var(--text-muted)',
    margin: 0,
  },
  orbArea: {
    position: 'relative',
    width: 148,
    height: 148,
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
    width: 128,
    height: 128,
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
    display: 'block',
  },
  statusLabel: {
    fontSize: '0.88rem',
    fontWeight: 500,
    color: 'var(--text-secondary)',
    margin: 0,
    textAlign: 'center',
    minHeight: '1.4em',
  },

  // Past call card
  pastCallCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '24px 20px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    width: '100%',
    textAlign: 'center',
  },
  pastCallBadge: {
    fontSize: '0.7rem',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#60a5fa',
    background: 'rgba(59,130,246,0.12)',
    border: '1px solid rgba(59,130,246,0.25)',
    padding: '4px 10px',
    borderRadius: 999,
  },
  pastCallSummaryText: {
    fontSize: '0.84rem',
    color: 'var(--text-muted)',
    margin: 0,
    lineHeight: 1.5,
  },
  pastCallAudioWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    width: '100%',
    padding: '12px',
    background: 'rgba(255,255,255,0.03)',
    borderRadius: 12,
    border: '1px solid var(--border)',
  },
  pastCallAudioLabel: {
    fontSize: '0.72rem',
    fontWeight: 600,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
    margin: 0,
  },
  pastCallAudio: {
    width: '100%',
    borderRadius: 8,
    outline: 'none',
    accentColor: '#60a5fa',
  },
  newCallBtnLarge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '11px 24px',
    borderRadius: 999,
    border: '1px solid rgba(59,130,246,0.5)',
    background: 'linear-gradient(135deg, rgba(59,130,246,0.25), rgba(147,51,234,0.25))',
    color: '#ffffff',
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.88rem',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 4px 18px rgba(59,130,246,0.3)',
    transition: 'all 0.2s',
  },

  // Auto-send selector
  selectorRow: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 7,
  },
  selectorLabel: {
    fontSize: '0.68rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  },
  selectorBtns: {
    display: 'flex',
    gap: 6,
  },
  selectorBtn: {
    fontSize: '0.72rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    padding: '5px 12px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'all 0.18s',
  },
  selectorBtnActive: {
    background: 'rgba(59,130,246,0.15)',
    borderColor: 'rgba(59,130,246,0.5)',
    color: '#60a5fa',
  },

  // Mic + pause row
  micRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  secondaryBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    fontSize: '0.72rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    padding: '7px 13px',
    borderRadius: 999,
    border: '1px solid var(--border)',
    background: 'var(--bg-surface)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    transition: 'all 0.18s',
  },
  secondaryBtnActive: {
    background: 'rgba(180,100,220,0.15)',
    borderColor: 'rgba(180,100,220,0.4)',
    color: '#c084fc',
  },
  micBtn: {
    width: 72,
    height: 72,
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
  ring: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '2px solid rgba(59,130,246,0.4)',
    animation: 'ring-expand 1.4s ease-out infinite',
  },
  hint: {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    textAlign: 'center',
    margin: 0,
    maxWidth: 230,
    lineHeight: 1.5,
    minHeight: '2.2em',
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
  newCallBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 7,
    padding: '9px 22px',
    borderRadius: 999,
    border: '1px solid rgba(59,130,246,0.35)',
    background: 'rgba(59,130,246,0.1)',
    color: '#60a5fa',
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.85rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
