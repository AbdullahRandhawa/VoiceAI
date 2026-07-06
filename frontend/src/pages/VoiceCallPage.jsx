import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { PhoneOff, Mic, MicOff } from 'lucide-react';
import { VoiceCallService } from '../services/websocket';
import { VoiceRecorder } from '../services/audio';

export default function VoiceCallPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('idle'); // 'idle' | 'recording' | 'processing' | 'speaking' | 'error'
  const [transcript, setTranscript] = useState('');
  const [response, setResponse] = useState('');
  const [error, setError] = useState('');
  const [isRecording, setIsRecording] = useState(false);

  const serviceRef = useRef(null);
  const recorderRef = useRef(null);

  // ── Connect to backend WebSocket ──────────────────────────────────────────
  const connect = useCallback(async () => {
    if (serviceRef.current?.isConnected) return;
    serviceRef.current = new VoiceCallService();
    try {
      await serviceRef.current.connect({
        onTranscript: (text) => {
          setTranscript(text);
          setStatus('processing');
          setResponse('');
        },
        onToken: (text) => {
          setResponse((r) => r + text);
          setStatus('speaking');
        },
        onDone: () => {
          setStatus('idle');
        },
        onError: (msg) => {
          setError(msg);
          setStatus('error');
        },
      });
    } catch {
      setError('Could not connect to voice server.');
      setStatus('error');
    }
  }, []);

  // ── Start recording ───────────────────────────────────────────────────────
  const startRecording = async () => {
    await connect();
    try {
      recorderRef.current = new VoiceRecorder();
      await recorderRef.current.start();
      setIsRecording(true);
      setStatus('recording');
      setTranscript('');
      setResponse('');
      setError('');
    } catch {
      setError('Microphone access denied.');
      setStatus('error');
    }
  };

  // ── Stop recording → send to server ──────────────────────────────────────
  const stopRecording = async () => {
    if (!recorderRef.current) return;
    setIsRecording(false);
    setStatus('processing');
    const blob = await recorderRef.current.stop();
    if (serviceRef.current) serviceRef.current.sendAudio(blob);
  };

  // ── End call ──────────────────────────────────────────────────────────────
  const endCall = () => {
    if (recorderRef.current) recorderRef.current.cancel();
    if (serviceRef.current) serviceRef.current.disconnect();
    navigate('/chat');
  };

  const statusConfig = {
    idle:       { label: 'Ready — hold to speak',  color: 'var(--text-secondary)' },
    recording:  { label: 'Listening…',              color: '#f87171' },
    processing: { label: 'Processing…',             color: '#facc15' },
    speaking:   { label: 'Speaking…',               color: '#34d399' },
    error:      { label: error || 'Error',          color: '#f87171' },
  };

  const { label, color } = statusConfig[status];

  return (
    <div style={styles.root}>
      {/* Background glow */}
      <div style={styles.bgGlow} />

      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        style={styles.card}
        className="glass"
      >
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logoMark}>✦</div>
          <h1 style={styles.title}>
            <span className="gradient-text">Voice</span> Call
          </h1>
          <p style={styles.subtitle}>Real-time AI conversation</p>
        </div>

        {/* Status indicator */}
        <div style={styles.statusArea}>
          <motion.div
            animate={{ scale: status === 'recording' ? [1, 1.08, 1] : 1 }}
            transition={{ duration: 1.2, repeat: Infinity }}
            style={{
              ...styles.statusDot,
              background: color,
              boxShadow: `0 0 16px ${color}`,
            }}
          />
          <span style={{ ...styles.statusLabel, color }}>{label}</span>
        </div>

        {/* Waveform visualiser */}
        <div style={styles.waveformArea}>
          {Array.from({ length: 20 }).map((_, i) => (
            <motion.span
              key={i}
              style={styles.waveBar}
              animate={
                status === 'recording' || status === 'speaking'
                  ? { scaleY: [0.2, Math.random() * 0.8 + 0.2, 0.2] }
                  : { scaleY: 0.2 }
              }
              transition={{
                duration: 0.5 + (i % 4) * 0.12,
                repeat: Infinity,
                delay: i * 0.04,
              }}
            />
          ))}
        </div>

        {/* Transcript */}
        <AnimatePresence>
          {transcript && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={styles.transcriptBox}
            >
              <p style={styles.transcriptLabel}>You said</p>
              <p style={styles.transcriptText}>"{transcript}"</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Response */}
        <AnimatePresence>
          {response && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              style={styles.responseBox}
            >
              <p style={styles.responseLabel}>Assistant</p>
              <p style={styles.responseText}>{response}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Controls */}
        <div style={styles.controls}>
          {/* Mic button */}
          <motion.button
            whileTap={{ scale: 0.92 }}
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onTouchStart={startRecording}
            onTouchEnd={stopRecording}
            disabled={status === 'processing' || status === 'speaking'}
            style={{
              ...styles.micBtn,
              ...(isRecording ? styles.micBtnActive : {}),
              ...(status === 'processing' || status === 'speaking' ? { opacity: 0.4 } : {}),
            }}
            id="voice-call-mic-btn"
          >
            {isRecording ? <MicOff size={28} /> : <Mic size={28} />}

            {/* Pulse rings while recording */}
            {isRecording && (
              <>
                <span style={{ ...styles.ring, animationDelay: '0s' }} />
                <span style={{ ...styles.ring, animationDelay: '0.5s' }} />
              </>
            )}
          </motion.button>

          <p style={styles.micHint}>
            {isRecording ? 'Release to send' : 'Hold to speak'}
          </p>

          {/* End call */}
          <motion.button
            whileTap={{ scale: 0.9 }}
            onClick={endCall}
            className="btn btn-ghost"
            style={styles.endBtn}
            id="end-call-btn"
          >
            <PhoneOff size={18} />
            End Call
          </motion.button>
        </div>
      </motion.div>

      <style>{`
        @keyframes ring-expand {
          0%   { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(2.2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  bgGlow: {
    position: 'fixed',
    inset: 0,
    background: 'radial-gradient(ellipse 70% 60% at 50% 40%, rgba(139,92,246,0.15) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  card: {
    width: '100%',
    maxWidth: 480,
    padding: '44px 40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 28,
    position: 'relative',
    zIndex: 1,
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  logoMark: {
    width: 56,
    height: 56,
    borderRadius: 18,
    background: 'var(--gradient-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 24,
    boxShadow: '0 8px 32px var(--accent-glow)',
    marginBottom: 4,
  },
  title: {
    fontSize: '1.8rem',
    fontWeight: 700,
    letterSpacing: '-0.03em',
  },
  subtitle: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
  },
  statusArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
  },
  statusLabel: {
    fontSize: '0.875rem',
    fontWeight: 500,
  },
  waveformArea: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    height: 60,
    width: '100%',
    justifyContent: 'center',
  },
  waveBar: {
    width: 4,
    height: '100%',
    background: 'var(--gradient-brand)',
    borderRadius: 4,
    transformOrigin: 'center',
    opacity: 0.7,
  },
  transcriptBox: {
    width: '100%',
    padding: '14px 18px',
    background: 'var(--bg-glass)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  },
  transcriptLabel: {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 6,
    fontWeight: 600,
  },
  transcriptText: {
    fontSize: '0.9rem',
    color: 'var(--text-secondary)',
    fontStyle: 'italic',
    lineHeight: 1.5,
  },
  responseBox: {
    width: '100%',
    padding: '14px 18px',
    background: 'var(--gradient-brand-subtle)',
    border: '1px solid var(--border-accent)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
  },
  responseLabel: {
    fontSize: '0.72rem',
    color: 'var(--accent-primary)',
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    marginBottom: 6,
    fontWeight: 600,
  },
  responseText: {
    fontSize: '0.9rem',
    color: 'var(--text-primary)',
    lineHeight: 1.6,
  },
  controls: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 14,
    width: '100%',
  },
  micBtn: {
    width: 80,
    height: 80,
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
  micBtnActive: {
    background: 'rgba(239,68,68,0.2)',
    borderColor: 'rgba(239,68,68,0.6)',
    color: '#f87171',
    boxShadow: '0 0 24px rgba(239,68,68,0.3)',
  },
  ring: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '2px solid rgba(239,68,68,0.4)',
    animation: 'ring-expand 1.4s ease-out infinite',
  },
  micHint: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  endBtn: {
    marginTop: 4,
    padding: '10px 24px',
  },
};
