import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Loader2, Copy, MessageSquare } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import AudioPlaybackPill from './AudioPlaybackPill';

export default function MessageBubble({ message }) {
  const isUser = message.role === 'user';
  const isVoiceMsg = !!message.audio_url && isUser;
  const isUploading = !!message._uploading;
  const isAudioGenerating = !!message.audio_generating;
  const [showTranscript, setShowTranscript] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyBlock = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.08 }}
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 16,
        width: '100%',
      }}
    >
      <div
        style={{
          ...styles.baseContainer,
          ...(isUser ? styles.bubbleUser : styles.assistantLayout),
          maxWidth: isUser ? ((isVoiceMsg || isUploading) ? 260 : '70%') : '80%',
          width: isUser ? 'auto' : '100%',
          opacity: isUploading ? 0.7 : 1,
        }}
      >
        {/* ── Uploading placeholder ── */}
        {isUploading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
            <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
            <span style={{ fontSize: '0.85rem', opacity: 0.8 }}>Uploading voice note…</span>
          </div>
        ) : isVoiceMsg ? (
          /* ── Voice Message ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <AnimatePresence mode="wait">
              {!showTranscript ? (
                <motion.div
                  key="voice"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <AudioPlaybackPill url={message.audio_url} variant="oscillator" />
                </motion.div>
              ) : (
                <motion.p
                  key="transcript"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  style={styles.transcriptText}
                >
                  {message.transcript || message.content || "Empty transcript."}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              style={styles.toggleBtn}
              onClick={() => setShowTranscript((s) => !s)}
            >
              {showTranscript ? (
                <><ChevronUp size={12} /> Hide Text</>
              ) : (
                <><MessageSquare size={12} /> Show Text</>
              )}
            </button>
          </div>
        ) : (
          /* ── Text Message ── */
          <div style={{ display: 'flex', flexDirection: 'column', width: '100%' }}>
            <div style={!isUser ? { fontSize: '0.95rem', whiteSpace: 'normal', width: '100%' } : styles.textContent}>
              {!isUser ? (
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
                        child?.type === 'p' || child?.type === 'span' ? React.Children.toArray(child.props.children) : [child]
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
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
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
                            onClick={() => handleCopyBlock(codeText)}
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
                        fontStyle: 'italic'
                      }}>
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => {
                      // Extract table text for copy
                      const tableText = extractTableText(children);
                      return (
                        <div style={styles.tableWrap}>
                          <button
                            style={styles.copyBlockBtn}
                            onClick={() => handleCopyBlock(tableText)}
                            title="Copy table"
                          >
                            <Copy size={12} />
                          </button>
                          <div style={{ overflowX: 'auto', width: '100%' }}>
                            <table style={styles.tableEl}>
                              {children}
                            </table>
                          </div>
                        </div>
                      );
                    },
                    thead: ({ children }) => <thead style={{ borderBottom: '2px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}>{children}</thead>,
                    th: ({ children }) => <th style={{ padding: '10px 14px', fontWeight: '600', color: '#fff', whiteSpace: 'nowrap' }}>{children}</th>,
                    td: ({ children }) => <td style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{children}</td>,
                  }}
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                <p style={{ margin: 0, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{message.content}</p>
              )}
            </div>

            {/* Action pills row */}
            {!isUser && (
              <div style={styles.assistantActionsRow}>
                {message.audio_url && (
                  <AudioPlaybackPill url={message.audio_url} />
                )}
                {isAudioGenerating && !message.audio_url && (
                  <div style={styles.generatingPill}>
                    <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    <span>Generating</span>
                  </div>
                )}
                <button style={styles.actionPill} onClick={handleCopy}>
                  <Copy size={13} />
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

/** Extract plain-text representation of table children for copy. */
function extractTableText(children) {
  const rows = [];
  React.Children.forEach(children, (child) => {
    if (!child || !child.props) return;
    if (child.type === 'thead' || child.type === 'tbody') {
      React.Children.forEach(child.props.children, (row) => {
        if (!row || !row.props) return;
        const cells = [];
        React.Children.forEach(row.props.children, (cell) => {
          cells.push(React.Children.toArray(cell.props.children).flatMap(c => typeof c === 'string' ? c : c?.props?.children || '').join(''));
        });
        rows.push(cells.join('\t'));
      });
    }
  });
  return rows.join('\n');
}

const styles = {
  baseContainer: {
    lineHeight: 1.6,
    wordBreak: 'break-word',
  },
  bubbleUser: {
    padding: '12px 16px',
    borderRadius: 18,
    background: 'rgba(59, 130, 246, 0.22)',
    border: '1px solid rgba(59, 130, 246, 0.4)',
    color: '#fff',
    borderBottomRightRadius: 6,
    boxShadow: '0 4px 16px rgba(59, 130, 246, 0.15)',
    backdropFilter: 'blur(12px)',
  },
  assistantLayout: {
    padding: '4px 0px 8px 0px',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-primary)',
    backdropFilter: 'none',
  },
  textContent: {
    fontSize: '0.9rem',
    whiteSpace: 'pre-wrap',
  },
  transcriptText: {
    fontSize: '0.9rem',
    lineHeight: 1.6,
    fontStyle: 'italic',
    opacity: 0.92,
  },
  toggleBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    fontSize: '0.7rem',
    fontWeight: 500,
    color: '#fff',
    background: 'rgba(255,255,255,0.15)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: 999,
    padding: '3px 10px',
    cursor: 'pointer',
    fontFamily: 'Inter, sans-serif',
    transition: 'all 0.15s',
    width: 'fit-content',
    marginTop: 2,
  },
  assistantActionsRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    flexWrap: 'wrap',
  },
  actionPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 12px',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'var(--text-secondary)',
    fontSize: '0.75rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  generatingPill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '4px 12px',
    borderRadius: 6,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'var(--text-secondary)',
    fontSize: '0.75rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
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
  tableWrap: {
    position: 'relative',
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
};