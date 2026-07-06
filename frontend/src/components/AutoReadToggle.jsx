import React from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';

export default function AutoReadToggle({ enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      title={enabled ? 'Auto-read ON — click to disable' : 'Auto-read OFF — click to enable'}
      style={{
        ...styles.btn,
        ...(enabled ? styles.btnOn : styles.btnOff),
      }}
    >
      <motion.span
        key={String(enabled)}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.15 }}
        style={{ display: 'flex', alignItems: 'center' }}
      >
        {enabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </motion.span>
      <span style={styles.label}>{enabled ? 'ON' : 'OFF'}</span>
    </button>
  );
}

const styles = {
  btn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '6px 12px',
    borderRadius: 999,
    border: '1px solid',
    fontSize: '0.75rem',
    fontWeight: 600,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  btnOn: {
    background: 'rgba(139,92,246,0.18)',
    borderColor: 'rgba(139,92,246,0.45)',
    color: '#a78bfa',
  },
  btnOff: {
    background: 'var(--bg-surface)',
    borderColor: 'var(--border)',
    color: 'var(--text-muted)',
  },
  label: {
    letterSpacing: '0.05em',
  },
};
