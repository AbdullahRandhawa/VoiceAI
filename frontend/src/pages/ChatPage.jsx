import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Sparkles, MessageSquarePlus } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  createConversation,
  deleteConversation,
  generateTTS,
  getConversations,
  getMessages,
  streamChat,
  transcribeAudio,
} from '../services/api';
import Sidebar from '../components/Sidebar';
import MessageBubble from '../components/MessageBubble';
import StreamingMessage from '../components/StreamingMessage';
import VoiceRecorderBtn from '../components/VoiceRecorder';
import AutoReadToggle from '../components/AutoReadToggle';

export default function ChatPage() {
  const { user } = useAuth();

  // ── State ─────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [autoRead, setAutoRead] = useState(false);
  const [isTTSLoading, setIsTTSLoading] = useState(false);

  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // ── Load conversations on mount ───────────────────────────────────────────
  useEffect(() => {
    loadConversations();
  }, []);

  const loadConversations = async () => {
    try {
      const res = await getConversations();
      setConversations(res.data.conversations);
    } catch {
      // Silently fail — user will see empty list
    }
  };

  // ── Select conversation → load messages ──────────────────────────────────
  const selectConversation = useCallback(async (id) => {
    setActiveId(id);
    setStreamText('');
    try {
      const res = await getMessages(id);
      setMessages(res.data.messages);
    } catch {
      setMessages([]);
    }
  }, []);

  // ── New conversation ──────────────────────────────────────────────────────
  const handleNew = async () => {
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

  // ── Delete conversation ───────────────────────────────────────────────────
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
  }, [messages, streamText]);

  // ── Send text message ─────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim();
    if (!text || !activeId || streaming) return;

    setInput('');
    setStreaming(true);
    setStreamText('');

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
      },
      async (msgId) => {
        setStreaming(false);
        setStreamText('');

        const assistantMsg = {
          id: msgId,
          role: 'assistant',
          content: finalText,
          created_at: new Date().toISOString(),
        };

        // If auto-read, generate TTS and attach URL
        if (autoRead) {
          setIsTTSLoading(true);
          try {
            const ttsRes = await generateTTS(finalText);
            assistantMsg.audio_url = ttsRes.data.audio_url;
            setMessages((prev) => [...prev, assistantMsg]);
            // Auto-play
            new Audio(ttsRes.data.audio_url).play();
          } catch {
            setMessages((prev) => [...prev, assistantMsg]);
          } finally {
            setIsTTSLoading(false);
          }
        } else {
          setMessages((prev) => [...prev, assistantMsg]);
        }

        // Refresh conversation list (title may have been updated)
        loadConversations();
      },
      (err) => {
        setStreaming(false);
        setStreamText('');
        console.error('Stream error:', err);
      }
    );
  };

  // ── Voice message ─────────────────────────────────────────────────────────
  const handleVoiceRecording = async (blob) => {
    if (!activeId) {
      // Auto-create conversation for voice messages too
      try {
        const res = await createConversation('Voice Chat');
        const conv = res.data;
        setConversations((prev) => [conv, ...prev]);
        setActiveId(conv.id);
        await handleVoiceWithConvId(blob, conv.id);
      } catch {
        alert('Failed to create conversation.');
      }
      return;
    }
    await handleVoiceWithConvId(blob, activeId);
  };

  const handleVoiceWithConvId = async (blob, convId) => {
    try {
      setStreaming(true);
      const res = await transcribeAudio(blob, convId);
      const { transcript, audio_url, message_id } = res.data;

      const userMsg = {
        id: message_id,
        role: 'user',
        content: transcript,
        audio_url,
        transcript,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);

      // Now stream LLM response for the transcript
      let finalText = '';
      setStreamText('');
      await streamChat(
        convId,
        transcript,
        (token) => {
          finalText += token;
          setStreamText(finalText);
        },
        async (msgId) => {
          setStreaming(false);
          setStreamText('');

          const assistantMsg = {
            id: msgId,
            role: 'assistant',
            content: finalText,
            created_at: new Date().toISOString(),
          };

          // Always generate TTS for voice message responses
          setIsTTSLoading(true);
          try {
            const ttsRes = await generateTTS(finalText);
            assistantMsg.audio_url = ttsRes.data.audio_url;
            setMessages((prev) => [...prev, assistantMsg]);
            new Audio(ttsRes.data.audio_url).play();
          } catch {
            setMessages((prev) => [...prev, assistantMsg]);
          } finally {
            setIsTTSLoading(false);
          }
          loadConversations();
        },
        (err) => {
          setStreaming(false);
          setStreamText('');
          console.error(err);
        }
      );
    } catch (err) {
      setStreaming(false);
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

  return (
    <div style={styles.root}>
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeId={activeId}
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

              {/* Streaming assistant message */}
              {streaming && streamText && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  style={styles.streamingWrap}
                >
                  <div style={styles.streamingAvatar}>✦</div>
                  <div style={styles.streamingBubble}>
                    <StreamingMessage text={streamText} />
                    {isTTSLoading && (
                      <p style={styles.ttsHint}>Generating voice…</p>
                    )}
                  </div>
                </motion.div>
              )}

              {/* TTS loading without stream text (e.g. after stream done) */}
              {!streaming && isTTSLoading && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={styles.ttsHint}
                >
                  Generating voice…
                </motion.p>
              )}

              <div ref={bottomRef} />
            </div>

            {/* Input bar */}
            <div style={styles.inputBar}>
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
                  <VoiceRecorderBtn
                    onRecordingComplete={handleVoiceRecording}
                    disabled={streaming}
                  />

                  <AutoReadToggle
                    enabled={autoRead}
                    onToggle={() => setAutoRead((v) => !v)}
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
                <Sparkles size={32} color="#a78bfa" />
              </div>
              <h2 style={styles.emptyTitle}>
                Start a <span className="gradient-text">conversation</span>
              </h2>
              <p style={styles.emptySubtitle}>
                Click "New Chat" or select a conversation from the sidebar.
                <br />
                You can type, record voice, or use a real-time voice call.
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
  streamingAvatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: 'var(--gradient-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 4,
    fontSize: 14,
    boxShadow: '0 2px 8px var(--accent-glow)',
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
  ttsHint: {
    fontSize: '0.75rem',
    color: 'var(--text-muted)',
    marginTop: 6,
    paddingLeft: 40,
    animation: 'shimmer 1.2s ease-in-out infinite',
  },
  inputBar: {
    padding: '12px 24px 20px',
    borderTop: '1px solid var(--border)',
    background: 'rgba(7,7,15,0.8)',
    backdropFilter: 'blur(20px)',
  },
  inputWrap: {
    display: 'flex',
    alignItems: 'flex-end',
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
    padding: 0,
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
