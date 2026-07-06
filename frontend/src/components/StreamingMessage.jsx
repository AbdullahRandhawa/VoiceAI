import React from 'react';
import { motion } from 'framer-motion';

/** Renders the live-streaming LLM text with a blinking cursor at the end. */
export default function StreamingMessage({ text }) {
  return (
    <div style={styles.wrap}>
      <p style={styles.text}>{text}</p>
      <motion.span
        animate={{ opacity: [1, 0, 1] }}
        transition={{ duration: 0.8, repeat: Infinity }}
        style={styles.cursor}
      />
    </div>
  );
}

const styles = {
  wrap: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 2,
    flexWrap: 'wrap',
  },
  text: {
    fontSize: '0.9rem',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  cursor: {
    display: 'inline-block',
    width: 2,
    height: 18,
    background: 'var(--accent-primary)',
    borderRadius: 2,
    flexShrink: 0,
    marginBottom: 2,
  },
};
