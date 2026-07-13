import React, { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Mic, Square, Play, X, ArrowUp } from 'lucide-react';
import { VoiceRecorder } from '../services/audio';

const VoiceRecorderBtn = forwardRef(function VoiceRecorderBtn({ onRecordingComplete, disabled }, ref) {
  const [state, setState] = useState('idle'); // 'idle' | 'recording' | 'paused' | 'processing'
  const [duration, setDuration] = useState(0);

  const recorderRef = useRef(null);
  const timerRef = useRef(null);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useImperativeHandle(ref, () => ({
    sendRecording: async () => {
      if (stateRef.current !== 'recording' && stateRef.current !== 'paused') return;
      await doSend();
    },
    isRecording: () => stateRef.current === 'recording' || stateRef.current === 'paused',
  }));

  const doSend = useCallback(async () => {
    clearInterval(timerRef.current);
    setState('processing');
    try {
      const blob = await recorderRef.current.stop();
      if (blob.size < 1000) {
        console.warn('[VoiceRecorder] Blob is very small');
      }
      onRecordingComplete(blob);
    } catch (err) {
      console.error('[VoiceRecorder] stop error:', err);
    } finally {
      setState('idle');
      setDuration(0);
    }
  }, [onRecordingComplete]);

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
    } catch (err) {
      console.error('[VoiceRecorder] start error:', err);
      alert('Microphone access denied. Please allow microphone permission in your browser.');
    }
  }, []);

  const togglePause = useCallback(() => {
    if (!recorderRef.current) return;
    if (state === 'recording') {
      recorderRef.current.pause();
      clearInterval(timerRef.current);
      setState('paused');
    } else if (state === 'paused') {
      recorderRef.current.resume();
      timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
      setState('recording');
    }
  }, [state]);

  const cancelRecording = useCallback(() => {
    clearInterval(timerRef.current);
    if (recorderRef.current) recorderRef.current.cancel();
    setState('idle');
    setDuration(0);
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
    };
  }, []);

  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const isActive = state === 'recording' || state === 'paused';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {isActive && (
        <div style={styles.recordingPill}>
          <button style={styles.smallIconBtn} onClick={cancelRecording} title="Cancel">
            <X size={14} />
          </button>
          <span style={styles.timer}>{fmt(duration)}</span>
          <button
            onClick={togglePause}
            style={styles.pauseBtn}
            title={state === 'paused' ? 'Resume' : 'Pause'}
          >
            {state === 'paused' ? <Play size={12} /> : <Square size={12} />}
          </button>
          <button
            onClick={doSend}
            style={styles.sendBtn}
            title="Send voice message"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      )}

      {!isActive && (
        <button
          disabled={disabled || state === 'processing'}
          onClick={startRecording}
          style={{
            ...styles.micBtn,
            ...(disabled ? { opacity: 0.4 } : {}),
          }}
          title="Record voice message"
        >
          {state === 'processing' ? (
            <span style={styles.spinner} />
          ) : (
            <Mic size={18} />
          )}
        </button>
      )}
    </div>
  );
});

const styles = {
  recordingPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 999,
    padding: '3px 6px 3px 8px',
    backdropFilter: 'blur(12px)',
    overflow: 'hidden',
  },
  smallIconBtn: {
    width: 24,
    height: 24,
    padding: 0,
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  pauseBtn: {
    width: 26,
    height: 26,
    padding: 0,
    borderRadius: 6,
    background: 'rgba(239, 68, 68, 0.3)',
    border: '1px solid rgba(239, 68, 68, 0.5)',
    color: '#f87171',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  sendBtn: {
    width: 26,
    height: 26,
    padding: 0,
    borderRadius: '50%',
    background: '#ef4444',
    border: 'none',
    color: '#fff',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
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
  timer: {
    fontSize: '0.8rem',
    fontVariantNumeric: 'tabular-nums',
    color: '#f87171',
    fontWeight: 600,
    minWidth: 36,
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

export default VoiceRecorderBtn;