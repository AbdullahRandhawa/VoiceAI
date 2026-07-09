import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, MessageSquarePlus, Phone, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createConversation,
  deleteConversation,
  getConversations,
  getMessages,
  streamChat,
  transcribeAudio,
} from '../services/api';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import MessageBubble from '../components/MessageBubble';
import StreamingMessage from '../components/StreamingMessage';
import VoiceRecorderBtn from '../components/VoiceRecorder';

export default function ChatPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── State ─────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamPhase, setStreamPhase] = useState('idle'); // 'idle' | 'thinking' | 'streaming' | 'audio'
  const [autoRead, setAutoRead] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // ── Load conversations when user is authenticated ────────────────────────
  useEffect(() => {
    if (user) {
      loadConversations();
    }
  }, [user]);

  const loadConversations = async () => {
    try {
      setLoadingConversations(true);
      const res = await getConversations();
      setConversations(res.data.conversations || []);
    } catch {
      // Silently fail — user will see empty list
    } finally {
      setLoadingConversations(false);
    }
  };

  // ── Select conversation → load messages ──────────────────────────────────
  const selectConversation = useCallback(async (id) => {
    setActiveId(id);
    setStreamText('');
    setStreamPhase('idle');
    try {
      const res = await getMessages(id);
      setMessages(res.data.messages || []);
    } catch {
      setMessages([]);
    }
  }, []);

  // ── New conversation ──────────────────────────────────────────────────────
  const handleNew = async () => {
    if (activeId && messages.length === 0) return; // Prevent unlimited empty chats
    try {
      const res = await createConversation();
      const conv = res.data;
      setConversations((prev) => [conv, ...prev]);
      setActiveId(conv.id);
      setMessages([]);
    } catch {
      alert('Failed to create conversation.');
    }
  };

  // ── Delete conversation (also deletes Cloudinary assets via backend) ──────
  const handleDelete = async (id) => {
    await deleteConversation(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeId === id) {
      setActiveId(null);
      setMessages([]);
    }
  };

  // ── Scroll to bottom on new messages ─────────────────────────────────────
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamText, streamPhase]);

  // ── Send text message ─────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeId || streaming) return;

    setInput('');;
    setStreaming(true);
    setStreamText('');
    setStreamPhase('thinking');

    // Optimistically add user message to UI
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    let finalText = '';

    await streamChat(
      activeId,
      text,
      (token) => {
        finalText += token;
        setStreamText(finalText);
        setStreamPhase('streaming');
      },
      async (msgId, audioUrl) => {
        // Commit message with audio_url fully populated
        const assistantMsg = {
          id: msgId,
          role: 'assistant',
          content: finalText,
          audio_url: audioUrl || null,
          autoPlay: autoRead && !!audioUrl,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);

        // Clear streaming state
        setStreaming(false);
        setStreamText('');
        setStreamPhase('idle');

        loadConversations();
      },
      (err) => {
        setStreaming(false);
        setStreamText('');
        setStreamPhase('idle');
        console.error('Stream error:', err);
      }
    );
  };

  // ── Voice message ─────────────────────────────────────────────────────────
  const handleVoiceRecording = async (blob) => {
    if (!user) {
      alert('Please sign in to send voice messages');
      return;
    }

    if (!activeId) {
      try {
        const res = await createConversation('New Chat');
        const conv = res.data;
        setConversations((prev) => [conv, ...prev]);
        setActiveId(conv.id);
        await handleVoiceWithConvId(blob, conv.id);
      } catch {
        alert('Failed to create conversation.');
      }
    } else {
      await handleVoiceWithConvId(blob, activeId);
    }
  };

  const handleVoiceWithConvId = async (blob, convId) => {
    try {
      setStreaming(true);
      setStreamPhase('thinking');

      // Optimistically show placeholder voice message while uploading
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

      const res = await transcribeAudio(blob, convId);
      const { transcript, audio_url, message_id } = res.data;

      // Replace placeholder with real message
      const userMsg = {
        id: message_id,
        role: 'user',
        content: transcript,
        audio_url,
        transcript,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => prev.map((m) => m.id === tempId ? userMsg : m));

      // Stream LLM response for the transcript
      let finalText = '';
      setStreamText('');
      setStreamPhase('thinking');

      await streamChat(
        convId,
        transcript,
        (token) => {
          finalText += token;
          setStreamText(finalText);
          setStreamPhase('streaming');
        },
        async (msgId, audioUrl) => {
          const assistantMsg = {
            id: msgId,
            role: 'assistant',
            content: finalText,
            audio_url: audioUrl || null,
            autoPlay: !!audioUrl, // Always auto-play voice message responses
            created_at: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, assistantMsg]);
          setStreaming(false);
          setStreamText('');
          setStreamPhase('idle');
          loadConversations();
        },
        (err) => {
          setStreaming(false);
          setStreamText('');
          setStreamPhase('idle');
          console.error(err);
        },
        true // skipUserSave
      );
    } catch (err) {
      setStreaming(false);
      setStreamPhase('idle');
      console.error('Voice message error:', err);
    }
  };

  // ── Keyboard: Enter sends, Shift+Enter = newline ──────────────────────────
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Auto-resize textarea ──────────────────────────────────────────────────
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };

  // ── Status pill text ──────────────────────────────────────────────────────
  const statusPill = streamPhase === 'thinking'
    ? { text: 'Thinking…', icon: <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> }
    : streamPhase === 'streaming'
    ? { text: 'Generating audio…', icon: <span style={{ fontSize: 12 }}>🎵</span> }
    : null;

  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        loading={loadingConversations}
        onSelect={selectConversation}
        onNew={handleNew}
        onDelete={handleDelete}
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

              {/* Status pill — shows immediately when streaming starts */}
              {streaming && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={styles.streamingWrap}
                >
                  <div style={styles.streamingBubble}>
                    {/* Stream text renders as it arrives */}
                    {streamText && <StreamingMessage text={streamText} />}

                    {/* Status pill always visible while streaming */}
                    {statusPill && (
                      <div style={{
                        ...styles.statusPill,
                        marginTop: streamText ? 8 : 0,
                      }}>
                        {statusPill.icon}
                        <span>{statusPill.text}</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div style={styles.inputBar}>
              {/* Auto-read toggle above input */}
              <div style={styles.autoReadRow}>
                <button
                  style={{
                    ...styles.autoReadBtn,
                    ...(autoRead ? styles.autoReadBtnOn : {}),
                  }}
                  onClick={() => setAutoRead((v) => !v)}
                  title="Auto-read AI responses aloud"
                >
                  <span style={styles.autoReadDot} />
                  Auto-read {autoRead ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="input-bar-wrap" style={styles.inputWrap}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask anything… (Shift+Enter for newline)"
                  rows={1}
                  disabled={streaming}
                  style={styles.textarea}
                />

                <div style={styles.inputActions}>
                  <button
                    style={styles.voiceCallBtn}
                    onClick={() => navigate(`/voice-call/${activeId || 'new'}`)}
                    title="Real-time Voice Call"
                  >
                    <Phone size={16} />
                  </button>

                  <VoiceRecorderBtn
                    onRecordingComplete={handleVoiceRecording}
                    disabled={streaming}
                  />

                  <motion.button
                    whileTap={{ scale: 0.9 }}
                    onClick={handleSend}
                    disabled={!input.trim() || streaming}
                    className="btn btn-primary"
                    style={styles.sendBtn}
                    id="send-message-btn"
                  >
                    <Send size={16} />
                  </motion.button>
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Empty state — no conversation selected */
          <div style={styles.emptyState}>
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4 }}
              style={styles.emptyContent}
            >
              <div style={styles.emptyIcon}>
                <Sparkles size={32} color="#25d366" />
              </div>
              <h2 style={styles.emptyTitle}>
                Start a <span className="gradient-text">conversation</span>
              </h2>
              <p style={styles.emptySubtitle}>
                Click "New Chat" or select a conversation from the sidebar.
                <br />
                You can type or record a voice message.
              </p>
              <button
                className="btn btn-primary"
                style={{ marginTop: 8, padding: '12px 28px' }}
                onClick={handleNew}
              >
                <MessageSquarePlus size={16} />
                New Chat
              </button>
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
    padding: '24px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  streamingWrap: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 4,
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
  autoReadRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    paddingBottom: 6,
  },
  autoReadBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 999,
    padding: '5px 12px',
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
    transition: 'all 0.2s',
  },
  autoReadBtnOn: {
    color: '#25d366',
    borderColor: 'rgba(37,211,102,0.4)',
    background: 'rgba(37,211,102,0.1)',
  },
  autoReadDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: 'currentColor',
    display: 'inline-block',
  },
  inputBar: {
    padding: '10px 24px 20px',
    borderTop: '1px solid var(--border)',
    background: 'rgba(7,7,15,0.8)',
    backdropFilter: 'blur(20px)',
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: 'var(--bg-glass)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '10px 14px',
    backdropFilter: 'blur(12px)',
    transition: 'border-color 0.2s',
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
  voiceCallBtn: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    border: '1px solid var(--border-accent)',
    background: 'var(--gradient-brand-subtle)',
    color: 'var(--accent-primary)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.2s',
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
  },
  emptyContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    textAlign: 'center',
    maxWidth: 420,
    padding: 24,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    background: 'var(--gradient-brand-subtle)',
    border: '1px solid var(--border-accent)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: '1.8rem',
    fontWeight: 700,
    letterSpacing: '-0.03em',
  },
  emptySubtitle: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    lineHeight: 1.7,
  },
};
