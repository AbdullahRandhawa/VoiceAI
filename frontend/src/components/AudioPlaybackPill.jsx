import React, { useState, useRef } from 'react';
import { Play, Pause } from 'lucide-react';

export default function AudioPlaybackPill({ url, autoPlay, variant = 'pill' }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  // Auto-play logic
  React.useEffect(() => {
    if (autoPlay && url) {
      if (!audioRef.current) {
        audioRef.current = new Audio(url);
        audioRef.current.onended = () => setPlaying(false);
      }
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {});
    }
  }, [autoPlay, url]);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(url);
      audioRef.current.onended = () => setPlaying(false);
    }

    if (playing) {
      audioRef.current.pause();
      setPlaying(false);
    } else {
      audioRef.current.play();
      setPlaying(true);
    }
  };

  if (variant === 'oscillator') {
    return (
      <div style={styles.oscillatorContainer}>
        <button onClick={toggle} style={styles.playBtnIcon}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div style={styles.oscillatorBars}>
          {Array.from({ length: 15 }).map((_, i) => (
            <span
              key={i}
              style={{
                ...styles.oscillatorBar,
                animationPlayState: playing ? 'running' : 'paused',
                animationDelay: `${i * 0.05}s`,
                height: 6 + Math.random() * 14,
              }}
            />
          ))}
        </div>
        <style>{`
          @keyframes osc-bounce {
            0%, 100% { transform: scaleY(0.4); }
            50%      { transform: scaleY(1.2); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <button onClick={toggle} style={styles.pill}>
      <span style={styles.icon}>
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </span>
      <span style={styles.label}>{playing ? 'Stop' : 'Listen'}</span>

      {/* Animated bars when playing */}
      {playing && (
        <span style={styles.bars}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              style={{
                ...styles.bar,
                animationDelay: `${i * 0.1}s`,
              }}
            />
          ))}
        </span>
      )}

      <style>{`
        @keyframes bar-bounce {
          0%, 100% { transform: scaleY(0.3); }
          50%       { transform: scaleY(1); }
        }
      `}</style>
    </button>
  );
}

const styles = {
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 14px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.14)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: 'inherit',
    fontSize: '0.8rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'background 0.15s',
    backdropFilter: 'blur(8px)',
  },
  icon: {
    display: 'flex',
    alignItems: 'center',
  },
  label: {
    lineHeight: 1,
  },
  bars: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    height: 14,
  },
  bar: {
    display: 'inline-block',
    width: 2.5,
    height: 14,
    borderRadius: 2,
    background: 'currentColor',
    transformOrigin: 'center',
    animation: 'bar-bounce 0.6s ease-in-out infinite',
  },
  oscillatorContainer: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    borderRadius: 999,
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    backdropFilter: 'blur(8px)',
  },
  playBtnIcon: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: 'var(--accent-primary)',
    color: '#fff',
    border: 'none',
    cursor: 'pointer',
  },
  oscillatorBars: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    height: 20,
  },
  oscillatorBar: {
    display: 'inline-block',
    width: 3,
    borderRadius: 2,
    background: '#fff',
    transformOrigin: 'center',
    animation: 'osc-bounce 0.5s ease-in-out infinite',
  },
};
