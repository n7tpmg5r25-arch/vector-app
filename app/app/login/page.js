'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'

/**
 * LoginPage
 *
 * Minimal sign-in gate. Magic link, shouldCreateUser: false — strangers
 * can't self-signup. Anyone not on the access list sees a brief error.
 */

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  )
}

function LoginPageInner() {
  const supabase = createBrowserClient()
  const searchParams = useSearchParams()

  // Sign-in state
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Banner from auth callback redirect
  const [banner, setBanner] = useState(null)
  useEffect(() => {
    if (searchParams.get('error') === 'auth_callback_error') {
      setBanner({ kind: 'warn', text: 'Sign-in link expired or invalid. Request a new magic link below.' })
    }
  }, [searchParams])

  async function handleSignIn(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        shouldCreateUser: false,
      }
    })
    if (error) {
      if (error.message?.toLowerCase().includes('signups not allowed') ||
          error.message?.toLowerCase().includes('signup is disabled') ||
          error.message?.toLowerCase().includes('user not found')) {
        setError('This email isn\u2019t on the access list.')
      } else {
        setError(error.message)
      }
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  const cardStyle = {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: '28px 24px',
    width: '100%',
    maxWidth: 380,
    boxShadow: '0 8px 40px rgba(0,0,0,0.4), 0 0 60px rgba(184,151,90,0.05)',
    position: 'relative',
    zIndex: 1,
  }

  const inputStyle = {
    width: '100%', padding: '12px 14px',
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', fontSize: 15,
    color: 'var(--text-primary)', marginBottom: 12,
    outline: 'none', transition: 'border-color 0.2s',
  }

  const buttonStyle = (disabled) => ({
    width: '100%', padding: '12px',
    background: disabled ? 'var(--teal-dim)' : 'var(--teal)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 'var(--radius)', fontSize: 14,
    fontWeight: 600, letterSpacing: '0.04em',
    transition: 'background 0.2s',
    cursor: disabled ? 'default' : 'pointer',
  })

  const headingStyle = {
    fontFamily: 'var(--font-display)',
    fontSize: 18, fontWeight: 600,
    color: 'var(--teal)', marginBottom: 4,
  }

  const subheadStyle = {
    fontSize: 13, color: 'var(--text-muted)', marginBottom: 20,
    lineHeight: 1.5,
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
        backgroundImage: 'radial-gradient(ellipse at 50% 30%, rgba(184,151,90,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }}/>

      {/* Logo — inline SVG (matches home page mark) */}
      <div style={{ marginBottom: 32, textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, marginBottom: 8 }}>
          <svg width="44" height="38" viewBox="0 0 56 48" fill="none" aria-hidden="true"
            style={{ filter: 'drop-shadow(0 0 18px rgba(184,151,90,0.25))' }}>
            <path d="M4 4 L28 44 L52 4" stroke="var(--teal)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
            <path d="M28 44 L52 20" stroke="var(--teal-dim)" strokeWidth="4" strokeLinecap="round" fill="none"/>
            <polygon points="52,14 58,22 44,22" fill="var(--gold, #b8975a)"/>
          </svg>
          <div style={{ textAlign: 'left' }}>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 30, fontWeight: 700, color: 'var(--teal)',
              letterSpacing: '-0.01em', lineHeight: 1,
            }}>
              VECTOR <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 22 }}>| WA</span>
            </div>
          </div>
        </div>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginTop: 4,
        }}>Legislative Intelligence for Washington State</div>
      </div>

      {/* Banner */}
      {banner && (
        <div style={{
          maxWidth: 380, width: '100%', marginBottom: 16,
          padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
          background: banner.kind === 'warn'
            ? 'rgba(196,122,48,0.12)'
            : 'rgba(58,122,138,0.12)',
          border: `1px solid ${banner.kind === 'warn'
            ? 'rgba(196,122,48,0.4)'
            : 'rgba(58,122,138,0.4)'}`,
          color: 'var(--text-primary)',
          borderRadius: 'var(--radius)',
          position: 'relative', zIndex: 1,
        }}>
          {banner.text}
        </div>
      )}

      {/* SIGN-IN CARD */}
      <div style={cardStyle}>
        {sent ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>&#x2709;&#xFE0F;</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18, fontWeight: 600,
              color: 'var(--teal)', marginBottom: 8,
            }}>Check your email</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              We sent a magic link to <strong style={{ color: 'var(--text-primary)' }}>{email}</strong>. Click it to sign in.
            </div>
          </div>
        ) : (
          <>
            <div style={headingStyle}>Already have access?</div>
            <div style={subheadStyle}>
              Sign in with a magic link sent to your email.
            </div>

            <form onSubmit={handleSignIn}>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoComplete="email"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'rgba(184,151,90,0.5)'}
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
              <button type="submit" disabled={loading} style={buttonStyle(loading)}>
                {loading ? 'Sending\u2026' : 'Send magic link'}
              </button>
            </form>
          </>
        )}
      </div>

      <div style={{
        marginTop: 20, fontSize: 11,
        color: 'var(--text-faint)', textAlign: 'center',
        position: 'relative', zIndex: 1,
      }}>
        Vector | WA &copy; 2026
      </div>
    </div>
  )
}
