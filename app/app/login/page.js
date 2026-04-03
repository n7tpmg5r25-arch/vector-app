'use client'
import { useState } from 'react'
import { createBrowserClient } from '../lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createBrowserClient()

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    })
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(ellipse at 50% 30%, rgba(0,229,204,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }}/>

      {/* Logo */}
      <div style={{ marginBottom: 48, textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <svg width="56" height="48" viewBox="0 0 56 48" fill="none" style={{ marginBottom: 12, filter: 'drop-shadow(0 0 16px rgba(0,229,204,0.3))' }}>
          <path d="M4 4 L28 44 L52 4" stroke="var(--teal)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <path d="M28 44 L52 20" stroke="var(--teal-dim)" strokeWidth="4" strokeLinecap="round" fill="none"/>
          <polygon points="52,14 58,22 44,22" fill="var(--gold)"/>
        </svg>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28, fontWeight: 700,
          color: 'var(--teal)',
          letterSpacing: '-0.02em',
          textShadow: '0 0 24px rgba(0,229,204,0.3)',
        }}>
          VECTOR <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 22 }}>| WA</span>
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginTop: 4,
        }}>Legislative Trajectories</div>
      </div>

      {/* Card */}
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '32px 28px',
        width: '100%', maxWidth: 360,
        boxShadow: '0 8px 40px rgba(0,0,0,0.4), 0 0 60px rgba(0,229,204,0.05)',
        position: 'relative', zIndex: 1,
      }}>
        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✉️</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600,
              color: 'var(--teal)', marginBottom: 8,
            }}>Check your email</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              We sent a magic link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>. Click it to sign in.
            </div>
          </div>
        ) : (
          <>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600,
              color: 'var(--teal)', marginBottom: 6,
            }}>Sign in</div>
            <div style={{
              fontSize: 13, color: 'var(--text-muted)', marginBottom: 24,
            }}>Enter your email to receive a magic link.</div>

            <form onSubmit={handleLogin}>
              <input
                type="email" value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                style={{
                  width: '100%', padding: '12px 14px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', fontSize: 15,
                  color: 'var(--text-primary)', marginBottom: 12,
                  outline: 'none', transition: 'border-color 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(0,229,204,0.5)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              {error && (
                <div style={{
                  fontSize: 12, color: 'var(--danger)',
                  marginBottom: 10, padding: '8px 12px',
                  background: 'var(--danger-pale)',
                  borderRadius: 6,
                }}>{error}</div>
              )}
              <button type="submit" disabled={loading} style={{
                width: '100%', padding: '13px',
                background: loading ? 'var(--teal-dim)' : 'var(--teal)',
                color: 'var(--bg)', border: 'none',
                borderRadius: 'var(--radius)', fontSize: 14,
                fontWeight: 600, letterSpacing: '0.04em',
                transition: 'background 0.2s',
                boxShadow: 'var(--teal-glow)',
              }}>
                {loading ? 'Sending...' : 'Send Magic Link'}
              </button>
            </form>
          </>
        )}
      </div>

      <div style={{
        marginTop: 24, fontSize: 11,
        color: 'var(--text-faint)', textAlign: 'center',
        position: 'relative', zIndex: 1,
      }}>
        Private access only · Vector WA &copy; 2026
      </div>
    </div>
  )
}
