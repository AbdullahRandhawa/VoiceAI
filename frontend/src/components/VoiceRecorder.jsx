import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, X } from 'lucide-react';
import { VoiceRecorder } from '../services/audio';

export default function VoiceRecorderBtn({ onRecordingComplete, disabled }) {
  const [state, setState] = useState('idle'); // 'idle' | 'recording' | 'processing'
  const [duration, setDuration] = useState(0);
  const recorderRef = useRef(null);
  const timerRef = useRef(null);

  const startRecording = useCallback(async () => {
    if (!VoiceRecorder.isSupported()) {
      alert('Audio recording is not supported in this browser.');
      return;
    }
    try {
      recorderRef.current = new VoiceRecorder();
      await recorderRef.current.start();
      setState('recording');
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch {
      alert('Microphone permission denied.');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current) return;
    clearInterval(timerRef.current);
    setState('processing');
    try {
      const blob = await recorderRef.current.stop();
      onRecordingComplete(blob);
    } finally {
      setState('idle');
      setDuration(0);
    }
  }, [onRecordingComplete]);

  const cancelRecording = useCallback(() => {
    clearInterval(timerRef.current);
    if (recorderRef.current) recorderRef.current.cancel();
    setState('idle');
    setDuration(0);
  }, []);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <AnimatePresence>
        {/* Cancel button — visible while recording */}
        {state === 'recording' && (
          <motion.button
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            className="btn-icon"
            onClick={cancelRecording}
            title="Cancel"
          >
            <X size={16} color="var(--text-muted)" />
          </motion.button>
        )}

        {/* Timer */}
        {state === 'recording' && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={styles.timer}
          >
            {fmt(duration)}
          </motion.span>
        )}
      </AnimatePresence>

      {/* Waveform bars while recording */}
      <AnimatePresence>
        {state === 'recording' && (
          <motion.div
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            style={styles.waveform}
          >
            {Array.from({ length: 7 }).map((_, i) => (
              <span
                key={i}
                style={{
                  ...styles.waveBar,
                  animationDelay: `${i * 0.08}s`,
                  animationDuration: `${0.5 + (i % 3) * 0.15}s`,
                }}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main mic / stop button */}
      <motion.button
        whileTap={{ scale: 0.92 }}
        disabled={disabled || state === 'processing'}
        onClick={state === 'idle' ? startRecording : stopRecording}
        style={{
          ...styles.micBtn,
          ...(state === 'recording' ? styles.micBtnRecording : {}),
          ...(disabled ? { opacity: 0.4 } : {}),
        }}
        title={state === 'idle' ? 'Record voice message' : 'Stop recording'}
      >
        {state === 'recording' ? (
          <Square size={16} fill="currentColor" />
        ) : state === 'processing' ? (
          <span style={styles.spinner} />
        ) : (
          <Mic size={18} />
        )}

        {/* Pulse ring while recording */}
        {state === 'recording' && (
          <>
            <span style={{ ...styles.pulseRing, animationDelay: '0s' }} />
            <span style={{ ...styles.pulseRing, animationDelay: '0.4s' }} />
          </>
        )}
      </motion.button>

      <style>{`
        @keyframes wave-bar {
          0%, 100% { transform: scaleY(0.3); }
          50%       { transform: scaleY(1); }
        }
        @keyframes pulse-ring-anim {
          0%   { transform: scale(1); opacity: 0.6; }
          100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  micBtn: {
    width: 40,
    height: 40,
    borderRadius: '50%',
    border: 'none',
    background: 'var(--bg-glass-strong)',
    borderStyle: 'solid',
    borderWidth: 1,
    borderColor: 'var(--border)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    transition: 'all 0.2s',
    flexShrink: 0,
  },
  micBtnRecording: {
    background: 'rgba(239, 68, 68, 0.2)',
    borderColor: 'rgba(239, 68, 68, 0.5)',
    color: '#f87171',
  },
  pulseRing: {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    border: '2px solid rgba(239,68,68,0.5)',
    animation: 'pulse-ring-anim 1.2s ease-out infinite',
  },
  waveform: {
    display: 'flex',
    alignItems: 'center',
    gap: 3,
    height: 24,
    overflow: 'hidden',
  },
  waveBar: {
    width: 3,
    height: '100%',
    background: '#f87171',
    borderRadius: 3,
    transformOrigin: 'center',
    animation: 'wave-bar 0.5s ease-in-out infinite',
  },
  timer: {
    fontSize: '0.8rem',
    fontVariantNumeric: 'tabular-nums',
    color: '#f87171',
    fontWeight: 600,
    minWidth: 40,
  },
  spinner: {
    display: 'inline-block',
    width: 16,
    height: 16,
    border: '2px solid rgba(255,255,255,0.2)',
    borderTopColor: 'var(--accent-primary)',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
};
