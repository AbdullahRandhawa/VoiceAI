import React from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy } from 'lucide-react';

/**
 * Renders the live-streaming LLM text with full markdown formatting + a blinking cursor.
 * Uses ReactMarkdown so bold, tables, headers, lists etc. render as tokens arrive.
 */
export default function StreamingMessage({ text }) {
  return (
    <div style={styles.wrap}>
      <div style={styles.markdownWrap}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            p: ({ children }) => (
              <p style={{ margin: '0 0 12px 0', lineHeight: '1.6', fontSize: '0.95rem', color: 'var(--text-primary)', textAlign: 'justify' }}>
                {children}
              </p>
            ),
            ul: ({ children }) => (
              <ul style={{ margin: '0 0 12px 0', paddingLeft: '24px', lineHeight: '1.6', listStyleType: 'disc' }}>
                {children}
              </ul>
            ),
            ol: ({ children }) => (
              <ol style={{ margin: '0 0 12px 0', paddingLeft: '24px', lineHeight: '1.6' }}>
                {children}
              </ol>
            ),
            li: ({ children }) => {
              const flat = React.Children.toArray(children).flatMap(child =>
                child?.type === 'p' || child?.type === 'span'
                  ? React.Children.toArray(child.props.children)
                  : [child]
              );
              return <li style={{ margin: '0 0 6px 0', lineHeight: '1.6', color: 'var(--text-primary)' }}>{flat}</li>;
            },
            h1: ({ children }) => (
              <h1 style={{ margin: '16px 0 8px 0', fontSize: '1.25rem', fontWeight: 700, lineHeight: '1.3', color: '#fff' }}>
                {children}
              </h1>
            ),
            h2: ({ children }) => (
              <h2 style={{ margin: '14px 0 6px 0', fontSize: '1.15rem', fontWeight: 700, lineHeight: '1.3', color: '#fff' }}>
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 style={{ margin: '12px 0 4px 0', fontSize: '1.05rem', fontWeight: 600, lineHeight: '1.3', color: '#fff' }}>
                {children}
              </h3>
            ),
            code: ({ children, ...props }) => {
              if (props.inline) {
                return (
                  <code style={{
                    background: 'rgba(255,255,255,0.08)',
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: '0.85em',
                    color: '#e2e8f0',
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  }}>
                    {children}
                  </code>
                );
              }
              const codeText = typeof children === 'string' ? children : String(children || '');
              return (
                <div style={styles.codeBlockWrap}>
                  <button
                    style={styles.copyBlockBtn}
                    onClick={() => navigator.clipboard.writeText(codeText)}
                    title="Copy code"
                  >
                    <Copy size={12} />
                  </button>
                  <pre style={styles.codePre}>
                    <code style={{ color: '#ecf0f1' }}>{children}</code>
                  </pre>
                </div>
              );
            },
            strong: ({ children }) => <strong style={{ fontWeight: 700, color: '#fff' }}>{children}</strong>,
            em: ({ children }) => <em style={{ fontStyle: 'italic', color: 'inherit' }}>{children}</em>,
            blockquote: ({ children }) => (
              <blockquote style={{
                borderLeft: '4px solid #3b82f6',
                paddingLeft: '14px',
                margin: '12px 0',
                color: 'var(--text-secondary)',
                fontStyle: 'italic',
              }}>
                {children}
              </blockquote>
            ),
            table: ({ children }) => (
              <div style={styles.tableWrap}>
                <div style={{ overflowX: 'auto', width: '100%' }}>
                  <table style={styles.tableEl}>{children}</table>
                </div>
              </div>
            ),
            thead: ({ children }) => (
              <thead style={{ borderBottom: '2px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}>
                {children}
              </thead>
            ),
            th: ({ children }) => (
              <th style={{ padding: '10px 14px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap' }}>{children}</th>
            ),
            td: ({ children }) => (
              <td style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {children}
              </td>
            ),
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
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
  markdownWrap: {
    flex: 1,
    fontSize: '0.95rem',
    lineHeight: 1.6,
    color: 'var(--text-primary)',
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
    alignSelf: 'flex-end',
  },
  codeBlockWrap: {
    position: 'relative',
    margin: '14px 0',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    background: '#0d1117',
    overflow: 'hidden',
  },
  codePre: {
    padding: '14px',
    margin: 0,
    fontSize: '0.85rem',
    lineHeight: '1.5',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    overflowX: 'auto',
    overflowY: 'auto',
    maxWidth: '100%',
    WebkitOverflowScrolling: 'touch',
  },
  copyBlockBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: '3px 8px',
    borderRadius: 4,
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'var(--text-secondary)',
    fontSize: '0.7rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'all 0.2s',
    lineHeight: 1,
  },
  tableWrap: {
    margin: '16px 0',
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.02)',
    overflow: 'hidden',
  },
  tableEl: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.9rem',
    textAlign: 'left',
    lineHeight: '1.5',
  },
};