import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageSquarePlus,
  Phone,
  PhoneCall,
  Trash2,
  LogOut,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import { logout } from '../services/auth';
import { useNavigate } from 'react-router-dom';

/** Format a date string as "20:56  Thu · Jun" */
function formatTimestamp(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }); // Thu
    const mon = d.toLocaleDateString('en-US', { month: 'short' });   // Jun
    return `${hh}:${mm}  ${day} · ${mon}`;
  } catch {
    return '';
  }
}

export default function Sidebar({
  conversations,
  calls,
  activeId,
  loading,
  onSelect,
  onNew,
  onNewCall,
  onDelete,
  onDeleteCall,
  user,
}) {
  const navigate = useNavigate();
  const [deletingId, setDeletingId] = useState(null);
  const [callBtnHover, setCallBtnHover] = useState(false);

  // Safe user values — guard against undefined/null user prop
  const safeUser = user || {};
  const userPhoto = safeUser.photoURL || null;
  const userName = safeUser.displayName || '';
  const userEmail = safeUser.email || '';
  const userInitial = (userName || userEmail || '?')[0].toUpperCase();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleDelete = async (e, id, isCall) => {
    e.stopPropagation();
    setDeletingId(id);
    try {
      if (isCall) {
        await onDeleteCall(id);
      } else {
        await onDelete(id);
      }
    } finally {
      setDeletingId(null);
    }
  };

  // Merge conversations and calls into one list sorted by updated_at desc
  const chatItems = (conversations || []).map(c => ({ ...c, _type: 'chat' }));
  const callItems = (calls || []).map(c => ({ ...c, _type: 'call' }));
  const allItems = [...chatItems, ...callItems].sort((a, b) => {
    const ta = a.updated_at || a.created_at || '';
    const tb = b.updated_at || b.created_at || '';
    return tb.localeCompare(ta);
  });

  // Determine the current list zone so AnimatePresence can key transitions
  const listZone = loading ? 'loading' : allItems.length === 0 ? 'empty' : 'list';

  return (
    <aside style={styles.sidebar}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.logo}>
          <img
            src="/Gemini_Generated_Image_dsk7okdsk7okdsk7.png"
            alt="VoiceAI logo"
            style={styles.logoIcon}
          />
          <span className="gradient-text" style={styles.logoText}>VoiceAI</span>
        </div>

        {/* New Chat button */}
        <button className="btn btn-primary" style={styles.newBtn} onClick={onNew}>
          <MessageSquarePlus size={15} />
          New Chat
        </button>

        {/* New Call button */}
        <button
          style={{
            ...styles.newCallBtn,
            ...(callBtnHover ? styles.newCallBtnHover : {}),
          }}
          onClick={onNewCall}
          onMouseEnter={() => setCallBtnHover(true)}
          onMouseLeave={() => setCallBtnHover(false)}
        >
          <PhoneCall size={15} />
          New Call
        </button>
      </div>

      {/* Merged history list */}
      <div style={styles.listWrap}>
        <p style={styles.sectionLabel}>History</p>
        <div style={styles.list}>
          {/* Key on listZone so AnimatePresence properly handles switching between states */}
          <AnimatePresence mode="popLayout" initial={false}>
            {listZone === 'loading' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={styles.loadingWrap}
              >
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <span>Loading...</span>
              </motion.div>
            )}

            {listZone === 'empty' && (
              <motion.p
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                style={styles.emptyMsg}
              >
                No history yet.
                <br />Start chatting or call!
              </motion.p>
            )}

            {listZone === 'list' && allItems.map((item) => {
              const isCall = item._type === 'call';
              const isActive = activeId === item.id;
              const isDeleting = deletingId === item.id;
              return (
                <motion.div
                  key={item.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.18 }}
                  className="conv-item"
                  style={{
                    ...styles.convItem,
                    ...(isActive ? styles.convItemActive : {}),
                    ...(isActive && isCall ? styles.convItemCallActive : {}),
                  }}
                  onClick={() => onSelect(item.id, isCall)}
                >
                  {isCall
                    ? <Phone size={13} style={{ flexShrink: 0, opacity: 0.75, color: '#a78bfa' }} />
                    : <MessageSquare size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
                  }

                  <div style={styles.itemInfo}>
                    <span style={styles.convTitle}>
                      {item.title || (isCall ? 'Voice Call' : 'New Chat')}
                    </span>
                    <span style={styles.timestamp}>
                      {formatTimestamp(item.updated_at || item.created_at)}
                    </span>
                  </div>

                  {/* Delete button — visible on hover (CSS) or while deleting */}
                  <button
                    className="conv-delete-btn"
                    style={{
                      ...styles.deleteBtn,
                      ...(isDeleting ? styles.deleteBtnVisible : {}),
                    }}
                    onClick={(e) => handleDelete(e, item.id, isCall)}
                    title="Delete"
                    disabled={isDeleting}
                  >
                    {isDeleting ? (
                      <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                    ) : (
                      <Trash2 size={12} />
                    )}
                  </button>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* User footer */}
      <div style={styles.footer}>
        <div style={styles.userInfo}>
          {userPhoto ? (
            <img src={userPhoto} style={styles.avatar} alt="avatar" />
          ) : (
            <div style={styles.avatarFallback}>
              {userInitial}
            </div>
          )}
          <div style={styles.userText}>
            <p style={styles.userName}>{userName || 'User'}</p>
            <p style={styles.userEmail}>{userEmail}</p>
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
    gap: 10,
    borderBottom: '1px solid var(--border)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 4,
  },
  logoIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    objectFit: 'cover',
    boxShadow: '0 4px 12px var(--accent-glow)',
    flexShrink: 0,
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
  newCallBtn: {
    height: 36,
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontSize: '0.83rem',
    fontWeight: 500,
    fontFamily: 'Inter, sans-serif',
    borderRadius: 'var(--radius-md)',
    border: '1px solid rgba(139,92,246,0.4)',
    background: 'rgba(139,92,246,0.1)',
    color: '#a78bfa',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
  newCallBtnHover: {
    background: 'rgba(139,92,246,0.22)',
    borderColor: 'rgba(139,92,246,0.7)',
    color: '#c4b5fd',
    transform: 'translateY(-1px)',
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
    padding: '8px 10px',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
    transition: 'background 0.15s',
    color: 'var(--text-secondary)',
    fontSize: '0.845rem',
    minWidth: 0,
    position: 'relative',
    // Default transparent border prevents layout shift when active border is applied
    border: '1px solid transparent',
  },
  convItemActive: {
    background: 'var(--bg-glass-strong)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-accent)',
  },
  convItemCallActive: {
    border: '1px solid rgba(139,92,246,0.4)',
    background: 'rgba(139,92,246,0.08)',
  },
  itemInfo: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  convTitle: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    lineHeight: 1.3,
  },
  timestamp: {
    fontSize: '0.68rem',
    color: 'var(--text-muted)',
    letterSpacing: '0.02em',
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
  deleteBtnVisible: {
    opacity: 1,
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
