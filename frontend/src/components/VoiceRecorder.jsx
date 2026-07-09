import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Square, X } from 'lucide-react';
import { VoiceRecorder } from '../services/audio';

const NUM_BARS = 20;

export default function VoiceRecorderBtn({ onRecordingComplete, disabled }) {
  const [state, setState] = useState('idle'); // 'idle' | 'recording' | 'processing'
  const [duration, setDuration] = useState(0);
  const [barHeights, setBarHeights] = useState(Array(NUM_BARS).fill(3));
  const [micLevel, setMicLevel] = useState(0); // 0-100, for debug

  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const animFrameRef = useRef(null);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);

  // ── Start live volume analysis ──────────────────────────────────────────────
  const startAnalyser = useCallback((stream) => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.75;
      source.connect(analyser);
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);

        // Map frequency bins to bar heights
        const binsPerBar = Math.floor(dataArray.length / NUM_BARS);
        const heights = Array.from({ length: NUM_BARS }, (_, i) => {
          let sum = 0;
          for (let j = 0; j < binsPerBar; j++) {
            sum += dataArray[i * binsPerBar + j];
          }
          const avg = sum / binsPerBar; // 0-255
          return Math.max(3, Math.round((avg / 255) * 28)); // 3-28px
        });

        const overall = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setMicLevel(Math.round((overall / 255) * 100));
        setBarHeights(heights);
        animFrameRef.current = requestAnimationFrame(tick);
      };

      animFrameRef.current = requestAnimationFrame(tick);
    } catch (e) {
      console.warn('[VoiceRecorder] AnalyserNode failed:', e);
    }
  }, []);

  const stopAnalyser = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    setBarHeights(Array(NUM_BARS).fill(3));
    setMicLevel(0);
  }, []);

  // ── Recording controls ──────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    if (!VoiceRecorder.isSupported()) {
      alert('Audio recording is not supported in this browser.');
      return;
    }
    try {
      recorderRef.current = new VoiceRecorder();
      await recorderRef.current.start();

      // Hook analyser onto the live stream
      if (recorderRef.current.stream) {
        startAnalyser(recorderRef.current.stream);
      }

      setState('recording');
      setDuration(0);
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
    } catch (err) {
      console.error('[VoiceRecorder] start error:', err);
      alert('Microphone access denied. Please allow microphone permission in your browser.');
    }
  }, [startAnalyser]);

  const stopRecording = useCallback(async () => {
    if (!recorderRef.current) return;
    clearInterval(timerRef.current);
    stopAnalyser();
    setState('processing');
    try {
      const blob = await recorderRef.current.stop();
      console.log('[VoiceRecorder] Blob:', blob.type, blob.size, 'bytes');
      if (blob.size < 1000) {
        console.warn('[VoiceRecorder] Blob is very small — mic may be silent or unmuted too quickly');
      }
      onRecordingComplete(blob);
    } catch (err) {
      console.error('[VoiceRecorder] stop error:', err);
    } finally {
      setState('idle');
      setDuration(0);
    }
  }, [onRecordingComplete, stopAnalyser]);

  const cancelRecording = useCallback(() => {
    clearInterval(timerRef.current);
    stopAnalyser();
    if (recorderRef.current) recorderRef.current.cancel();
    setState('idle');
    setDuration(0);
  }, [stopAnalyser]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      stopAnalyser();
    };
  }, [stopAnalyser]);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <AnimatePresence>
        {/* Cancel button */}
        {state === 'recording' && (
          <motion.button
            key="cancel"
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
            key="timer"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={styles.timer}
          >
            {fmt(duration)}
          </motion.span>
        )}
      </AnimatePresence>

      {/* ── Live waveform — bars driven by real mic input ── */}
      <AnimatePresence>
        {state === 'recording' && (
          <motion.div
            key="waveform"
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            style={styles.waveform}
          >
            {barHeights.map((h, i) => (
              <span
                key={i}
                style={{
                  ...styles.waveBar,
                  height: h,
                  opacity: 0.5 + (h / 28) * 0.5,
                  transform: `scaleY(1)`, // no CSS animation — driven by JS
                }}
              />
            ))}
            {/* Tiny mic-level debug indicator */}
            <span style={styles.levelHint} title={`Mic level: ${micLevel}%`}>
              {micLevel > 0 ? `${micLevel}%` : 'silent'}
            </span>
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

        {/* Pulse ring — intensity driven by mic level */}
        {state === 'recording' && (
          <>
            <span style={{
              ...styles.pulseRing,
              animationDuration: micLevel > 20 ? '0.8s' : '1.6s',
              opacity: 0.3 + micLevel / 200,
            }} />
            <span style={{
              ...styles.pulseRing,
              animationDuration: micLevel > 20 ? '1.2s' : '2.4s',
              animationDelay: '0.3s',
              opacity: 0.2 + micLevel / 300,
            }} />
          </>
        )}
      </motion.button>

      <style>{`
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
    gap: 2,
    height: 32,
    overflow: 'hidden',
    padding: '0 4px',
  },
  waveBar: {
    width: 3,
    borderRadius: 3,
    background: '#f87171',
    transformOrigin: 'center',
    transition: 'height 0.05s ease-out',
    flexShrink: 0,
  },
  levelHint: {
    fontSize: '0.65rem',
    color: '#f87171',
    opacity: 0.8,
    minWidth: 36,
    marginLeft: 4,
    fontVariantNumeric: 'tabular-nums',
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
