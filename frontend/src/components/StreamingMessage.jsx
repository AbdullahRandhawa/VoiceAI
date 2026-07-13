import React from 'react';
import { motion } from 'framer-motion';

/**
 * Renders the live-streaming LLM text as raw text with a blinking cursor.
 * No ReactMarkdown processing — incomplete markdown can't be parsed mid-stream.
 * Once streaming finishes, MessageBubble takes over with full rich rendering.
 */
export default function StreamingMessage({ text }) {
  return (
    <div style={styles.wrap}>
      <div style={styles.text}>{text}</div>
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
    width: '100%',
  },
  text: {
    fontSize: '0.95rem',
    lineHeight: 1.6,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    color: 'var(--text-primary)',
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