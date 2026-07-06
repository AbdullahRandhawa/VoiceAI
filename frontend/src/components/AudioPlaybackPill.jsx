import React, { useState, useRef } from 'react';
import { Play, Pause } from 'lucide-react';

export default function AudioPlaybackPill({ url }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

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
};
