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
    }}>
      <div style={{ marginBottom: 48, textAlign: 'center' }}>
        <svg width="56" height="48" viewBox="0 0 56 48" fill="none" style={{ marginBottom: 12 }}>
          <path d="M4 4 L28 44 L52 4" stroke="#1e3a2f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
          <path d="M28 44 L52 20" stroke="#4a7c59" strokeWidth="4" strokeLinecap="round" fill="none"/>
          <polygon points="52,14 58,22 44,22" fill="#b8923a"/>
        </svg>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28, fontWeight: 700,
          color: 'var(--green-dark)',
          letterSpacing: '-0.02em',
        }}>
          VECTOR <span style={{ color: 'var(--green-light)', fontWeight: 400, fontSize: 22 }}>| WA</span>
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12, color: 'var(--text-muted)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginTop: 4,
        }}>Legislative Trajectories</div>
      </div>

      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '32px 28px',
        width: '100%', maxWidth: 360,
        boxShadow: 'var(--shadow-md)',
      }}>
        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✉️</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600,
              color: 'var(--green-dark)', marginBottom: 8,
            }}>Check your email</div>
            <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              We sent a magic link to <strong>{email}</strong>. Click it to sign in.
            </div>
          </div>
        ) : (
          <>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20, fontWeight: 600,
              color: 'var(--green-dark)', marginBottom: 6,
            }}>Sign in</div>
            <div style={{
              fontSize: 13, color: 'var(--text-muted)', marginBottom: 24,
            }}>Enter your email to receive a magic link.</div>

            <form onSubmit={handleLogin}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                style={{
                  width: '100%', padding: '12px 14px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', fontSize: 15,
                  color: 'var(--text-primary)', marginBottom: 12,
                  outline: 'none',
                }}
              />
              {error && (
                <div style={{
                  fontSize: 12, color: 'var(--danger)',
                  marginBottom: 10, padding: '8px 12px',
                  background: 'var(--danger-pale)', borderRadius: 6,
                }}>{error}</div>
              )}
              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%', padding: '13px',
                  background: 'var(--green-dark)',
                  color: 'white', border: 'none',
                  borderRadius: 'var(--radius)', fontSize: 14,
                  fontWeight: 600, letterSpacing: '0.04em',
                }}
              >
                {loading ? 'Sending...' : 'Send Magic Link'}
              </button>
            </form>
          </>
        )}
      </div>

      <div style={{
        marginTop: 24, fontSize: 11,
        color: 'var(--text-faint)', textAlign: 'center',
      }}>
        Private access only · Vector WA &copy; 2026
      </div>
    </div>
  )
}
