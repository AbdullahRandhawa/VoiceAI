import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Mail, Lock, LogIn, UserPlus, Globe2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  signInWithEmail,
  signUpWithEmail,
  signInWithGoogle,
} from '../services/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
      }
      navigate('/chat');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Authentication failed';
      setError(msg.replace('Firebase: ', '').replace(/\(auth.*\)\.?/, '').trim());
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError('');
    setLoading(true);
    try {
      await signInWithGoogle();
      navigate('/chat');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.root}>
      {/* Floating orbs */}
      <div style={{ ...styles.orb, ...styles.orb1 }} />
      <div style={{ ...styles.orb, ...styles.orb2 }} />

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="glass"
        style={styles.card}
      >
        {/* Logo */}
        <div style={styles.logoArea}>
          <div style={styles.logoIcon}>
            <Mic size={26} color="#fff" />
          </div>
          <h1 style={styles.logoText}>
            <span className="gradient-text">Voice</span>
            <span style={{ color: 'var(--text-primary)' }}>AI</span>
          </h1>
          <p style={styles.tagline}>Your intelligent voice assistant</p>
        </div>

        {/* Tab toggle */}
        <div style={styles.tabBar}>
          {['signin', 'signup'].map((m) => (
            <button
              key={m}
              style={{ ...styles.tab, ...(mode === m ? styles.tabActive : {}) }}
              onClick={() => { setMode(m); setError(''); }}
            >
              {m === 'signin' ? 'Sign In' : 'Sign Up'}
            </button>
          ))}
        </div>

        {/* Form */}
        <AnimatePresence mode="wait">
          <motion.form
            key={mode}
            initial={{ opacity: 0, x: mode === 'signin' ? -10 : 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onSubmit={handleSubmit}
            style={styles.form}
          >
            <div style={styles.fieldWrap}>
              <Mail size={16} style={styles.fieldIcon} />
              <input
                id="email"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="input"
                style={{ paddingLeft: 44 }}
              />
            </div>

            <div style={styles.fieldWrap}>
              <Lock size={16} style={styles.fieldIcon} />
              <input
                id="password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="input"
                style={{ paddingLeft: 44 }}
              />
            </div>

            <AnimatePresence>
              {error && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  style={styles.errorMsg}
                >
                  {error}
                </motion.p>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary"
              style={{ width: '100%', height: 44, fontSize: '0.95rem' }}
            >
              {loading ? (
                <span style={styles.spinner} />
              ) : mode === 'signin' ? (
                <><LogIn size={16} /> Sign In</>
              ) : (
                <><UserPlus size={16} /> Create Account</>
              )}
            </button>
          </motion.form>
        </AnimatePresence>

        {/* Divider */}
        <div style={styles.divider}>
          <span style={styles.dividerLine} />
          <span style={styles.dividerText}>or</span>
          <span style={styles.dividerLine} />
        </div>

        {/* Google */}
        <button
          onClick={handleGoogle}
          disabled={loading}
          className="btn btn-ghost"
          style={{ width: '100%', height: 44 }}
        >
          <Globe2 size={18} />
          Continue with Google
        </button>
      </motion.div>
    </div>
  );
}

const styles = {
  root: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    position: 'relative',
    overflow: 'hidden',
  },
  orb: {
    position: 'fixed',
    borderRadius: '50%',
    filter: 'blur(80px)',
    pointerEvents: 'none',
  },
  orb1: {
    width: 400,
    height: 400,
    top: '-10%',
    left: '-5%',
    background: 'radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)',
  },
  orb2: {
    width: 350,
    height: 350,
    bottom: '-10%',
    right: '5%',
    background: 'radial-gradient(circle, rgba(59,130,246,0.14) 0%, transparent 70%)',
  },
  card: {
    width: '100%',
    maxWidth: 400,
    padding: '40px 36px',
    display: 'flex',
    flexDirection: 'column',
    gap: 20,
    position: 'relative',
    zIndex: 1,
  },
  logoArea: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  logoIcon: {
    width: 60,
    height: 60,
    borderRadius: '18px',
    background: 'var(--gradient-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 8px 32px var(--accent-glow)',
  },
  logoText: {
    fontSize: '2rem',
    fontWeight: 700,
    letterSpacing: '-0.5px',
    display: 'flex',
    gap: 4,
  },
  tagline: {
    fontSize: '0.85rem',
    color: 'var(--text-muted)',
    letterSpacing: '0.02em',
  },
  tabBar: {
    display: 'flex',
    background: 'var(--bg-input)',
    borderRadius: 'var(--radius-md)',
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    padding: '8px',
    borderRadius: 'calc(var(--radius-md) - 2px)',
    border: 'none',
    background: 'transparent',
    color: 'var(--text-secondary)',
    fontSize: '0.875rem',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all var(--transition-base)',
    fontFamily: 'Inter, sans-serif',
  },
  tabActive: {
    background: 'var(--bg-glass-strong)',
    color: 'var(--text-primary)',
    boxShadow: 'var(--shadow-sm)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  fieldWrap: {
    position: 'relative',
  },
  fieldIcon: {
    position: 'absolute',
    left: 14,
    top: '50%',
    transform: 'translateY(-50%)',
    color: 'var(--text-muted)',
    pointerEvents: 'none',
  },
  errorMsg: {
    color: '#f87171',
    fontSize: '0.82rem',
    padding: '8px 12px',
    background: 'rgba(248,113,113,0.1)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid rgba(248,113,113,0.2)',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    background: 'var(--border)',
  },
  dividerText: {
    fontSize: '0.8rem',
    color: 'var(--text-muted)',
  },
  spinner: {
    display: 'inline-block',
    width: 18,
    height: 18,
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.7s linear infinite',
  },
};
