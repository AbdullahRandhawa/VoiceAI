import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquarePlus,
  Trash2,
  LogOut,
  Phone,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import { logout } from '../services/auth';
import { useNavigate } from 'react-router-dom';

export default function Sidebar({
  conversations,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
  user,
}) {
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState(null);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      await onDelete(id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <aside style={styles.sidebar}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <div style={styles.logoIcon}>✦</div>
          <span className="gradient-text" style={styles.logoText}>VoiceAI</span>
        </div>
        <button className="btn btn-primary" style={styles.newBtn} onClick={onNew}>
          <MessageSquarePlus size={15} />
          New Chat
        </button>
      </div>

      {/* Conversations list */}
      <div style={styles.listWrap}>
        <p style={styles.sectionLabel}>Conversations</p>
        <div style={styles.list}>
          <AnimatePresence>
            {loading ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={styles.loadingWrap}
              >
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Loading chats...</span>
              </motion.div>
            ) : conversations.length === 0 ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                style={styles.emptyMsg}
              >
                No conversations yet.
                <br />Start chatting!
              </motion.p>
            ) : (
              conversations.map((conv) => (
                <motion.div
                  key={conv.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                className="conv-item"
                style={{
                  ...styles.convItem,
                  ...(activeId === conv.id ? styles.convItemActive : {}),
                }}
                onClick={() => onSelect(conv.id)}
              >
                <MessageSquare size={14} style={{ flexShrink: 0, opacity: 0.6 }} />
                <span style={styles.convTitle}>{conv.title || 'New Chat'}</span>
                <button
                  className="conv-delete-btn"
                  style={styles.deleteBtn}
                  onClick={(e) => handleDelete(e, conv.id)}
                  title="Delete conversation"
                  disabled={deletingId === conv.id}
                >
                  {deletingId === conv.id ? (
                    <Loader2
                      size={13}
                      style={{ animation: 'spin 1s linear infinite' }}
                    />
                  ) : (
                    <Trash2 size={13} />
                  )}
                </button>
              </motion.div>
              ))
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* User footer */}
      <div style={styles.footer}>
        <div style={styles.userInfo}>
          {user.photoURL ? (
            <img src={user.photoURL} style={styles.avatar} alt="avatar" />
          ) : (
            <div style={styles.avatarFallback}>
              {(user.displayName || user.email || '?')[0].toUpperCase()}
            </div>
          )}
          <div style={styles.userText}>
            <p style={styles.userName}>{user.displayName || 'User'}</p>
            <p style={styles.userEmail}>{user.email}</p>
          </div>
        </div>
        <button className="btn-icon" onClick={handleLogout} title="Sign out">
          <LogOut size={16} />
        </button>
      </div>
    </aside>
  );
}

const styles = {
  sidebar: {
    width: 280,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    borderRight: '1px solid var(--border)',
    background: 'rgba(255,255,255,0.02)',
    overflow: 'hidden',
  },
  header: {
    padding: '20px 16px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    borderBottom: '1px solid var(--border)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    background: 'var(--gradient-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 16,
    boxShadow: '0 4px 12px var(--accent-glow)',
  },
  logoText: {
    fontSize: '1.2rem',
    fontWeight: 700,
  },
  newBtn: {
    height: 38,
    fontSize: '0.85rem',
    width: '100%',
  },
  voiceCallBtn: {
    margin: '12px 16px',
    padding: '10px 14px',
    borderRadius: 'var(--radius-md)',
    background: 'var(--gradient-brand-subtle)',
    border: '1px solid var(--border-accent)',
    color: 'var(--accent-primary)',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: '0.85rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  liveTag: {
    marginLeft: 'auto',
    fontSize: '0.65rem',
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 999,
    background: 'rgba(37,211,102,0.3)',
    color: '#25d366',
    letterSpacing: '0.08em',
  },
  listWrap: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    padding: '8px 0',
  },
  sectionLabel: {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    padding: '6px 20px',
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '4px 8px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  emptyMsg: {
    color: 'var(--text-muted)',
    fontSize: '0.82rem',
    textAlign: 'center',
    padding: '24px 16px',
    lineHeight: 1.7,
  },
  loadingWrap: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '32px 16px',
    color: 'var(--text-muted)',
    fontSize: '0.85rem',
    gap: 12,
  },
  convItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '9px 12px',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    color: 'var(--text-secondary)',
    fontSize: '0.855rem',
    minWidth: 0,
    position: 'relative',
  },
  convItemActive: {
    background: 'var(--bg-glass-strong)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-accent)',
  },
  convTitle: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  deleteBtn: {
    flexShrink: 0,
    padding: 4,
    borderRadius: 6,
    border: 'none',
    background: 'transparent',
    color: 'var(--text-muted)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    opacity: 0,
    transition: 'opacity 0.15s, color 0.15s',
  },
  footer: {
    padding: '14px 16px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  userInfo: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    objectFit: 'cover',
    flexShrink: 0,
  },
  avatarFallback: {
    width: 34,
    height: 34,
    borderRadius: '50%',
    background: 'var(--gradient-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.9rem',
    fontWeight: 700,
    flexShrink: 0,
  },
  userText: {
    minWidth: 0,
  },
  userName: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  userEmail: {
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
};
