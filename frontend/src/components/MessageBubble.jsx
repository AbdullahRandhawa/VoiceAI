import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Loader2, Copy, RotateCcw, MessageSquare } from 'lucide-react';
import AudioPlaybackPill from './AudioPlaybackPill';

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isVoiceMsg = !!message.audio_url && isUser;
  const isUploading = !!message._uploading;
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
      <div
        style={{
          ...styles.bubble,
          ...(isUser ? styles.bubbleUser : styles.bubbleAssistant),
          maxWidth: (isVoiceMsg || isUploading) ? 260 : '72%',
          opacity: isUploading ? 0.7 : 1,
        }}
      >
        {/* ── Uploading placeholder ── */}
        {isUploading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Uploading voice note…</span>
          </div>
        ) : isVoiceMsg ? (
          /* ── Voice Message ── */
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
                  <AudioPlaybackPill url={message.audio_url} variant="oscillator" />
                </motion.div>
              ) : (
                <motion.p
                  key="transcript"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={styles.transcriptText}
                >
                  {message.transcript || message.content || "Empty transcript."}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              style={styles.toggleBtn}
              onClick={() => setShowTranscript((s) => !s)}
            >
              {showTranscript ? (
                <><ChevronUp size={12} /> Hide Text</>
              ) : (
                <><MessageSquare size={12} /> Show Text</>
              )}
            </button>
          </div>
        ) : (
          /* ── Text Message ── */
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <p style={styles.textContent}>{message.content}</p>

            {/* Assistant Action Pills */}
            {!isUser && (
              <div style={styles.assistantActionsRow}>
                {message.audio_url && (
                  <AudioPlaybackPill url={message.audio_url} autoPlay={message.autoPlay} />
                )}
                <button style={styles.actionPill} onClick={handleCopy}>
                  <Copy size={13} />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

const styles = {
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
    justifyContent: 'center',
    gap: 6,
    fontSize: '0.75rem',
    fontWeight: 500,
    color: '#fff',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 999,
    padding: '6px 14px',
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
    transition: 'all 0.15s',
    width: 'fit-content',
    marginTop: 4,
  },
  assistantActionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    flexWrap: 'wrap',
  },
  actionPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'var(--text-secondary)',
    fontSize: '0.8rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
