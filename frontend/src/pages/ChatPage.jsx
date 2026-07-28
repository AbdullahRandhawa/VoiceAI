import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, MessageSquarePlus, Loader2, Phone, PhoneOff, Play, Pause, MessageSquare } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createChat,
  deleteChat,
  getChats,
  getChatMessages,
  streamChat,
  transcribeAudio,
  getCalls,
  deleteCall,
  getCallMessages,
  getCall,
} from '../services/api';
import { useNavigate, useLocation } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import MessageBubble from '../components/MessageBubble';
import StreamingMessage from '../components/StreamingMessage';
import VoiceRecorderBtn from '../components/VoiceRecorder';

const formatTime = (secs) => {
  if (isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function ChatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // ── State ─────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState([]); // chats
  const [calls, setCalls] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamPhase, setStreamPhase] = useState('idle');
  const [loadingConversations, setLoadingConversations] = useState(true);

  // Audio Playback states for Calls
  const callAudioRef = useRef(null);
  const [callAudioUrl, setCallAudioUrl] = useState(null); // fetched fresh per-call to include recording url
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const voiceRecorderRef = useRef(null);

  // Determine if active item is a call
  const activeCall = calls.find(c => c.id === activeId);
  const isCall = !!activeCall;

  // ── Load chats + calls when user is authenticated ─────────────────────────
  const loadAll = useCallback(async () => {
    try {
      setLoadingConversations(true);
      const [convRes, callsRes] = await Promise.all([
        getChats(),
        getCalls(),
      ]);
      setConversations(convRes.data.chats || []);
      setCalls(callsRes.data.calls || []);
      return { conversations: convRes.data.chats || [], calls: callsRes.data.calls || [] };
    } catch {
      return { conversations: [], calls: [] };
    } finally {
      setLoadingConversations(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadAll();
    }
  }, [user, loadAll]);

  // ── Select chat or call ───────────────────────────────────────────────
  const selectItem = useCallback(async (id, isCallItem) => {
    // If leaving an empty draft, remove it silently
    if (activeId === 'new_chat_draft' && messages.length === 0) {
      setConversations(prev => prev.filter(c => c.id !== 'new_chat_draft'));
    }

    // Stop any playing audio before switching
    if (callAudioRef.current) {
      callAudioRef.current.pause();
      callAudioRef.current = null;
    }
    setActiveId(id);
    setStreamText('');
    setStreamPhase('idle');
    setAudioPlaying(false);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setCallAudioUrl(null);

    if (isCallItem) {
      try {
        const res = await getCallMessages(id);
        const mapped = [];
        (res.data.messages || []).forEach(msg => {
          mapped.push({ id: `${msg.id}-u`, role: 'user', content: msg.transcript, created_at: msg.created_at });
          mapped.push({ id: `${msg.id}-a`, role: 'assistant', content: msg.response, created_at: msg.created_at });
        });
        setMessages(mapped);

        try {
          const callRes = await getCall(id);
          setCallAudioUrl(callRes.data?.audio_url || null);
        } catch { /* audio_url optional */ }
      } catch {
        setMessages([]);
      }
    } else {
      try {
        const res = await getChatMessages(id);
        setMessages(res.data.messages || []);
      } catch {
        setMessages([]);
      }
    }
  }, [activeId, messages.length]);

  // Handle direct navigation selection (passed via router state, e.g. from VoiceCallPage sidebar click)
  useEffect(() => {
    const checkStateSelection = async () => {
      if (location.state?.activeId) {
        const selectedId = location.state.activeId;
        // First load all if they aren't loaded yet to ensure calls/conversations are populated
        const currentData = (conversations.length === 0 && calls.length === 0)
          ? await loadAll()
          : { conversations, calls };

        const isCallItem = currentData.calls.some(c => c.id === selectedId);
        selectItem(selectedId, isCallItem);
        // Clear the state so it doesn't re-select on every navigation refresh
        navigate(location.pathname, { replace: true, state: {} });
      }
    };
    checkStateSelection();
  }, [location.state, conversations, calls, loadAll, selectItem, navigate, location.pathname]);

  // ── New Chat — frontend-only draft (no backend until first message) ───────────
  const DRAFT_ID = 'new_chat_draft';

  const handleNew = () => {
    // Don't create a second draft if one already exists
    if (activeId === DRAFT_ID) return;
    // Remove any pre-existing empty draft before adding a fresh one
    setConversations(prev => prev.filter(c => c.id !== DRAFT_ID));
    setConversations(prev => [
      { id: DRAFT_ID, title: 'New Chat', _isDraft: true, created_at: new Date().toISOString() },
      ...prev,
    ]);
    setActiveId(DRAFT_ID);
    setMessages([]);
    setStreamText('');
    setStreamPhase('idle');
  };

  // ── New Call — navigate to voice call page ────────────────────────────────
  const handleNewCall = () => {
    navigate('/voice-call/new');
  };

  // ── Delete chat ───────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    await deleteChat(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  };

  // ── Delete call record ────────────────────────────────────────────────────
  const handleDeleteCall = async (id) => {
    await deleteCall(id);
    setCalls((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  };

  // ── Scroll to bottom ─────────────────────────────────────────────────────
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamText, streamPhase]);

  // ── Send (text or voice) ──────────────────────────────────────────────────
  const handleSend = async () => {
    if (voiceRecorderRef.current?.isRecording()) {
      await voiceRecorderRef.current.sendRecording();
      return;
    }
    const text = input.trim();
    if (!text || streaming || isCall) return;

    // — Draft chat: create real chat in Firestore on first message —
    let chatId = activeId;
    if (activeId === 'new_chat_draft') {
      try {
        const res = await createChat();
        const chatDoc = res.data;
        chatId = chatDoc.id;
        setConversations(prev => [
          chatDoc,
          ...prev.filter(c => c.id !== 'new_chat_draft'),
        ]);
        setActiveId(chatId);
      } catch {
        alert('Failed to create chat.');
        return;
      }
    }

    if (!chatId) return;

    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setStreaming(true);
    setStreamText('');
    setStreamPhase('thinking');

    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    let finalText = '';

    await streamChat(
      chatId,
      text,
      (token) => {
        finalText += token;
        setStreamText(finalText);
        setStreamPhase('streaming');
      },
      async (msgId, audioUrl, audioGenerating) => {
        const assistantMsg = {
          id: msgId,
          role: 'assistant',
          content: finalText,
          audio_url: audioUrl || null,
          audio_generating: audioGenerating || false,
          created_at: new Date().toISOString(),
        };
        setMessages(prev => [...prev, assistantMsg]);
        setStreaming(false);
        setStreamText('');
        setStreamPhase('idle');
      },
      (err) => {
        setStreaming(false);
        setStreamText('');
        setStreamPhase('idle');
        console.error('Stream error:', err);
      },
      false,
      (msgId, audioUrl) => {
        setMessages(prev =>
          prev.map(m =>
            m.id === msgId ? { ...m, audio_url: audioUrl, audio_generating: false } : m
          )
        );
      }
    );
  };

  // ── Voice message (only for chats) ─────────────────────────────────────────
  const handleVoiceRecording = async (blob) => {
    if (!user) {
      alert('Please sign in to send voice messages');
      return;
    }
    if (isCall) return;

    if (!activeId) {
      try {
        const res = await createChat('New Chat');
        const chatDoc = res.data;
        setConversations((prev) => [chatDoc, ...prev]);
        setActiveId(chatDoc.id);
        await handleVoiceWithChatId(blob, chatDoc.id);
      } catch {
        alert('Failed to create chat.');
      }
    } else {
      await handleVoiceWithChatId(blob, activeId);
    }
  };

  const handleVoiceWithChatId = async (blob, chatId) => {
    try {
      setStreaming(true);
      setStreamPhase('thinking');

      const tempId = `voice-temp-${Date.now()}`;
      const placeholderMsg = {
        id: tempId,
        role: 'user',
        content: '…',
        audio_url: null,
        transcript: null,
        _uploading: true,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, placeholderMsg]);

      const res = await transcribeAudio(blob, chatId);
      const { transcript, audio_url, message_id } = res.data;

      const userMsg = {
        id: message_id,
        role: 'user',
        content: transcript,
        audio_url,
        transcript,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => prev.map((m) => m.id === tempId ? userMsg : m));

      let finalText = '';
      setStreamText('');
      setStreamPhase('thinking');

      await streamChat(
        chatId,
        transcript,
        (token) => {
          finalText += token;
          setStreamText(finalText);
          setStreamPhase('streaming');
        },
        async (msgId, audioUrl, audioGenerating) => {
          const assistantMsg = {
            id: msgId,
            role: 'assistant',
            content: finalText,
            audio_url: audioUrl || null,
            audio_generating: audioGenerating || false,
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setStreaming(false);
          setStreamText('');
          setStreamPhase('idle');
        },
        (err) => {
          setStreaming(false);
          setStreamText('');
          setStreamPhase('idle');
          console.error(err);
        },
        true, // skipUserSave
        (msgId, audioUrl) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, audio_url: audioUrl, audio_generating: false }
                : m
            )
          );
        }
      );
    } catch (err) {
      setStreaming(false);
      setStreamPhase('idle');
      console.error('Voice message error:', err);
    }
  };

  // ── Keyboard ──────────────────────────────────────────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  // Only show the pill during 'thinking' (before text arrives).
  // Once tokens are streaming in, hide it — the blinking cursor is enough.
  const statusPill = streamPhase === 'thinking'
    ? { text: 'Thinking…', icon: <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> }
    : null;

  return (
    <div style={styles.root}>
      <Sidebar
        conversations={conversations}
        calls={calls}
        activeId={activeId}
        loading={loadingConversations}
        onSelect={selectItem}
        onNew={handleNew}
        onNewCall={handleNewCall}
        onDelete={handleDelete}
        onDeleteCall={handleDeleteCall}
        user={{
          displayName: user?.displayName,
          email: user?.email,
          photoURL: user?.photoURL,
        }}
      />

      {/* Main area */}
      <div style={styles.main}>
        {activeId ? (
          <>
            {/* Messages */}
            <div style={styles.messagesArea}>
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
              </AnimatePresence>

              {/* Italic call ended text at the bottom of the bubbles panel (no bubble container) */}
              {isCall && (
                <div style={styles.callEndedText}>
                  <PhoneOff size={14} style={{ opacity: 0.6 }} />
                  <span>This call has ended. You can review the transcript above or listen to the recording.</span>
                </div>
              )}

              {streaming && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={styles.streamingWrap}
                >
                  {streamText && <StreamingMessage text={streamText} />}
                  {statusPill && (
                    <div style={{
                      ...styles.statusPill,
                      marginTop: streamText ? 8 : 0,
                    }}>
                      {statusPill.icon}
                      <span>{statusPill.text}</span>
                    </div>
                  )}
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div style={styles.inputBar}>
              {isCall ? (
                <div style={styles.audioPlaybackBar}>
                  {callAudioUrl ? (
                    <>
                      <audio
                        ref={callAudioRef}
                        src={callAudioUrl}
                        onPlay={() => setAudioPlaying(true)}
                        onPause={() => setAudioPlaying(false)}
                        onEnded={() => setAudioPlaying(false)}
                        onTimeUpdate={() => setAudioCurrentTime(callAudioRef.current?.currentTime || 0)}
                        onLoadedMetadata={() => setAudioDuration(callAudioRef.current?.duration || 0)}
                      />
                      <button
                        style={styles.playBtn}
                        onClick={() => {
                          if (audioPlaying) {
                            callAudioRef.current?.pause();
                          } else {
                            callAudioRef.current?.play();
                          }
                        }}
                      >
                        {audioPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                      </button>

                      <div style={styles.audioTrackInfo}>
                        <span style={styles.audioTrackTitle}>Voice Call Recording</span>
                        <span style={styles.audioTrackTime}>
                          {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
                        </span>
                      </div>

                      <div style={styles.audioProgressBarWrap} onClick={(e) => {
                        if (!callAudioRef.current || !audioDuration) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const percentage = clickX / rect.width;
                        callAudioRef.current.currentTime = percentage * audioDuration;
                      }}>
                        <div style={{
                          ...styles.audioProgressBarFill,
                          width: `${(audioCurrentTime / (audioDuration || 1)) * 100}%`
                        }} />
                      </div>
                    </>
                  ) : (
                    <div style={styles.noAudioMessage}>
                      <span>No audio recording available for this call.</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="input-bar-wrap" style={styles.inputPillWrap}>
                  <div style={styles.inputWrap}>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={handleInputChange}
                      onKeyDown={handleKeyDown}
                      placeholder="Type your message here…"
                      rows={1}
                      disabled={streaming}
                      style={styles.textarea}
                    />

                    <div style={styles.inputActions}>
                      <VoiceRecorderBtn
                        ref={voiceRecorderRef}
                        onRecordingComplete={handleVoiceRecording}
                        disabled={streaming}
                      />

                      <motion.button
                        whileTap={{ scale: 0.9 }}
                        onClick={handleSend}
                        disabled={(!input.trim() && !voiceRecorderRef.current?.isRecording()) || streaming}
                        className="btn btn-primary"
                        style={styles.sendBtn}
                        id="send-message-btn"
                      >
                        <Send size={20} />
                      </motion.button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={styles.emptyState}>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              style={styles.emptyContent}
            >
              <div style={styles.emptyIconWrap}>
                <img
                  src="/Gemini_Generated_Image_dsk7okdsk7okdsk7.png"
                  alt="VoiceAI Logo"
                  style={styles.emptyLogoImg}
                />
              </div>

              <h2 style={styles.emptyTitle}>
                Welcome to <span className="gradient-text">VoiceAI</span>
              </h2>

              <p style={styles.emptySubtitle}>
                Your multi-modal AI platform. Chat via text, send instant voice notes, or launch hands-free real-time voice calls.
              </p>

              <div style={styles.featureGrid}>
                <div style={styles.featureCard}>
                  <div style={styles.featureHeader}>
                    <MessageSquare size={20} color="#25d366" />
                    <span style={styles.featureTitle}>AI Chat & Voice Messaging</span>
                  </div>
                  <p style={styles.featureDesc}>
                    General purpose chatbot for Q&A, writing code, analyzing documents, and voice-to-text messaging with live audio response generation.
                  </p>
                </div>

                <div style={styles.featureCard}>
                  <div style={styles.featureHeader}>
                    <Phone size={20} color="#a78bfa" />
                    <span style={styles.featureTitle}>Real-Time Voice Call Agent</span>
                  </div>
                  <p style={styles.featureDesc}>
                    Call the AI in real time for hands-free spoken conversations with instant audio responses, silence detection, and stored call logs.
                  </p>
                </div>
              </div>

              <div style={styles.actionRow}>
                <button
                  className="btn btn-primary"
                  style={styles.heroChatBtn}
                  onClick={handleNew}
                  id="empty-state-new-chat-btn"
                >
                  <MessageSquarePlus size={18} />
                  New Chat
                </button>
                <button
                  style={styles.heroCallBtn}
                  onClick={handleNewCall}
                  id="empty-state-new-call-btn"
                >
                  <Phone size={18} />
                  New Voice Call
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  root: {
    display: 'flex',
    height: '100vh',
    overflow: 'hidden',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    minWidth: 0,
  },
  messagesArea: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 48px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  callEndedText: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '16px 20px',
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    textAlign: 'center',
    fontStyle: 'italic',
    width: '100%',
    marginTop: 12,
  },
  streamingWrap: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
    maxWidth: '80%',
  },
  streamingBubble: {
    background: 'var(--bg-glass-strong)',
    border: '1px solid var(--border)',
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    padding: '12px 16px',
    backdropFilter: 'blur(12px)',
    maxWidth: '72%',
  },
  statusPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.78rem',
    color: 'var(--text-muted)',
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '4px 10px',
    animation: 'shimmer 1.4s ease-in-out infinite',
  },
  inputBar: {
    padding: '10px 24px 20px',
    background: 'rgba(7,7,15,0.8)',
    backdropFilter: 'blur(20px)',
  },
  audioPlaybackBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '14px 20px',
    background: 'var(--bg-glass-strong)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    width: '100%',
    backdropFilter: 'blur(12px)',
  },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'var(--gradient-brand)',
    color: '#fff',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: '0 4px 14px var(--accent-glow)',
    transition: 'transform 0.2s',
  },
  audioTrackInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    flexShrink: 0,
  },
  audioTrackTitle: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  audioTrackTime: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
  },
  audioProgressBarWrap: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    background: 'rgba(255,255,255,0.08)',
    position: 'relative',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  audioProgressBarFill: {
    height: '100%',
    background: 'var(--gradient-brand)',
    borderRadius: 3,
    transition: 'width 0.1s linear',
  },
  noAudioMessage: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    fontStyle: 'italic',
    padding: '8px 0',
  },
  inputPillWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--bg-glass)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '8px 8px 8px 18px',
    backdropFilter: 'blur(12px)',
    transition: 'border-color 0.2s',
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    flex: 1,
    gap: 10,
    background: 'transparent',
    border: 'none',
    borderRadius: 0,
    padding: 0,
  },
  textarea: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'var(--text-primary)',
    fontFamily: 'Inter, sans-serif',
    fontSize: '0.9rem',
    lineHeight: 1.6,
    resize: 'none',
    maxHeight: 160,
    overflowY: 'auto',
    padding: '2px 0',
    alignSelf: 'center',
  },
  inputActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  sendBtn: {
    width: 38,
    height: 38,
    padding: 0,
    borderRadius: '50%',
    flexShrink: 0,
  },
  emptyState: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 24px',
    overflowY: 'auto',
  },
  emptyContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: 620,
    width: '100%',
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    background: 'var(--bg-glass-strong)',
    border: '1px solid var(--border-accent)',
    padding: 12,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 32px rgba(37, 211, 102, 0.2), 0 0 24px rgba(139, 92, 246, 0.18)',
    marginBottom: 20,
  },
  emptyLogoImg: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
    objectFit: 'cover',
  },
  emptyTitle: {
    fontSize: '2.1rem',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    marginBottom: 10,
    color: 'var(--text-primary)',
  },
  emptySubtitle: {
    fontSize: '0.96rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    maxWidth: 520,
    marginBottom: 28,
  },
  featureGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: 16,
    width: '100%',
    marginBottom: 32,
  },
  featureCard: {
    background: 'rgba(255, 255, 255, 0.03)',
    border: '1px solid var(--border)',
    borderRadius: 16,
    padding: '20px 22px',
    textAlign: 'left',
    backdropFilter: 'blur(10px)',
  },
  featureHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  featureTitle: {
    fontSize: '0.95rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  featureDesc: {
    fontSize: '0.84rem',
    color: 'var(--text-muted)',
    lineHeight: 1.55,
    margin: 0,
  },
  actionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  heroChatBtn: {
    padding: '13px 28px',
    fontSize: '0.92rem',
    borderRadius: 14,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    fontWeight: 600,
    cursor: 'pointer',
  },
  heroCallBtn: {
    padding: '13px 28px',
    fontSize: '0.92rem',
    borderRadius: 14,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 10,
    fontWeight: 600,
    background: 'rgba(139, 92, 246, 0.12)',
    border: '1px solid rgba(139, 92, 246, 0.35)',
    color: '#a78bfa',
    cursor: 'pointer',
    transition: 'all 0.2s',
    boxShadow: '0 4px 16px rgba(139, 92, 246, 0.15)',
  },
};
