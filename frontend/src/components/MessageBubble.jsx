import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import AudioPlaybackPill from './AudioPlaybackPill';

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isVoiceMsg = !!message.audio_url && isUser;
  const [showTranscript, setShowTranscript] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 6,
      }}
    >
      {/* Assistant avatar */}
      {!isUser && (
        <div style={styles.avatar}>
          <span style={{ fontSize: 14 }}>✦</span>
        </div>
      )}

      <div
        style={{
          ...styles.bubble,
          ...(isUser ? styles.bubbleUser : styles.bubbleAssistant),
          maxWidth: isVoiceMsg ? 260 : '72%',
        }}
      >
        {/* ── Voice Message ── */}
        {isVoiceMsg ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AnimatePresence mode="wait">
              {!showTranscript ? (
                <motion.div
                  key="voice"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div style={styles.voiceHeader}>
                    <span style={styles.voiceLabel}>🎤 Voice Message</span>
                  </div>
                  <AudioPlaybackPill url={message.audio_url} />
                </motion.div>
              ) : (
                <motion.p
                  key="transcript"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={styles.transcriptText}
                >
                  {message.transcript || message.content}
                </motion.p>
              )}
            </AnimatePresence>

            {message.transcript && (
              <button
                style={styles.toggleBtn}
                onClick={() => setShowTranscript((s) => !s)}
              >
                {showTranscript ? (
                  <><ChevronUp size={12} /> Show Voice Note</>
                ) : (
                  <><ChevronDown size={12} /> Show Text</>
                )}
              </button>
            )}
          </div>
        ) : (
          /* ── Text Message ── */
          <div>
            <p style={styles.textContent}>{message.content}</p>

            {/* TTS playback for assistant */}
            {!isUser && message.audio_url && (
              <div style={{ marginTop: 10 }}>
                <AudioPlaybackPill url={message.audio_url} />
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

const styles = {
  avatar: {
    width: 30,
    height: 30,
    borderRadius: '50%',
    background: 'var(--gradient-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: 10,
    marginTop: 4,
    boxShadow: '0 2px 8px var(--accent-glow)',
  },
  bubble: {
    padding: '12px 16px',
    borderRadius: 18,
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  bubbleUser: {
    background: 'var(--gradient-brand)',
    color: '#fff',
    borderBottomRightRadius: 6,
    boxShadow: '0 4px 16px var(--accent-glow)',
  },
  bubbleAssistant: {
    background: 'var(--bg-glass-strong)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    borderBottomLeftRadius: 6,
    backdropFilter: 'blur(12px)',
  },
  textContent: {
    fontSize: '0.9rem',
    whiteSpace: 'pre-wrap',
  },
  voiceHeader: {
    marginBottom: 8,
  },
  voiceLabel: {
    fontSize: '0.82rem',
    opacity: 0.85,
    fontWeight: 500,
  },
  transcriptText: {
    fontSize: '0.9rem',
    lineHeight: 1.6,
    fontStyle: 'italic',
    opacity: 0.92,
  },
  toggleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: '0.75rem',
    color: 'rgba(255,255,255,0.7)',
    background: 'rgba(255,255,255,0.12)',
    border: 'none',
    borderRadius: 999,
    padding: '4px 10px',
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
    transition: 'background 0.15s',
    width: 'fit-content',
  },
};
