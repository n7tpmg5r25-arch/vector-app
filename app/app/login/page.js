'use client'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'

/**
 * LoginPage — Brand P2b
 *
 * Two sections:
 *   1. Waitlist — for new visitors. Public launch is August 2027.
 *      Posts to /api/waitlist, double-opt-in via confirmation email.
 *   2. Sign in — for users already provisioned in Supabase. Magic link,
 *      shouldCreateUser: false (strangers can't self-signup until launch).
 *
 * Copy follows Shorepine Civic Tech brand guide v1.1 §7:
 *   - Precise, not dense.
 *   - Free means free (no upsell, no "premium coming soon").
 *   - Show the facts (public launch date), not the pitch.
 */

const PUBLIC_LAUNCH = 'August 2027'

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

  // Waitlist state
  const [waitlistEmail, setWaitlistEmail] = useState('')
  const [waitlistHp, setWaitlistHp] = useState('') // honeypot
  const [waitlistLoading, setWaitlistLoading] = useState(false)
  const [waitlistDone, setWaitlistDone] = useState(false)
  const [waitlistError, setWaitlistError] = useState('')

  // Banner from confirmation redirect
  const [banner, setBanner] = useState(null)
  useEffect(() => {
    const w = searchParams.get('waitlist')
    if (w === 'confirmed') setBanner({ kind: 'success', text: 'Thanks — your email is confirmed. We\u2019ll notify you when public accounts open.' })
    else if (w === 'already_confirmed') setBanner({ kind: 'info', text: 'This email is already confirmed. We have your spot.' })
    else if (w === 'invalid') setBanner({ kind: 'warn', text: 'That confirmation link is no longer valid. Re-enter your email below to get a new one.' })
    else if (w === 'error') setBanner({ kind: 'warn', text: 'Something went wrong confirming your email. Try again in a minute.' })
    else if (searchParams.get('error') === 'auth_callback_error') setBanner({ kind: 'warn', text: 'Sign-in link expired or invalid. Request a new magic link below.' })
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
        setError('This email isn\u2019t on the access list yet. Public accounts open ' + PUBLIC_LAUNCH + ' \u2014 join the waitlist below to be notified.')
      } else {
        setError(error.message)
      }
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  async function handleJoinWaitlist(e) {
    e.preventDefault()
    setWaitlistLoading(true)
    setWaitlistError('')
    try {
      const resp = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: waitlistEmail,
          source: 'login_page',
          hp: waitlistHp,
        }),
      })
      const data = await resp.json().catch(() => ({}))
      if (resp.ok && data.ok) {
        setWaitlistDone(true)
      } else {
        setWaitlistError(data.error || 'Could not join the list. Try again.')
      }
    } catch {
      setWaitlistError('Network error. Try again.')
    }
    setWaitlistLoading(false)
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

  const buttonStyle = (disabled, variant = 'brass') => ({
    width: '100%', padding: '12px',
    background: disabled
      ? 'var(--teal-dim)'
      : variant === 'brass' ? 'var(--gold, #b8975a)' : 'var(--teal)',
    color: variant === 'brass' ? '#0e1014' : 'var(--bg)',
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

      {/* Logo */}
      <div style={{ marginBottom: 32, textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <img
          src="/logo-wordmark.png"
          alt="Vector | WA"
          style={{
            maxWidth: 260, width: '100%', height: 'auto',
            marginBottom: 8,
            filter: 'drop-shadow(0 0 18px rgba(184,151,90,0.2))',
          }}
        />
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginTop: 4,
        }}>Free legislative intelligence for Washington State</div>
      </div>

      {/* Banner */}
      {banner && (
        <div style={{
          maxWidth: 380, width: '100%', marginBottom: 16,
          padding: '10px 14px', fontSize: 13, lineHeight: 1.5,
          background: banner.kind === 'success'
            ? 'rgba(122,171,110,0.12)'
            : banner.kind === 'warn'
              ? 'rgba(196,122,48,0.12)'
              : 'rgba(58,122,138,0.12)',
          border: `1px solid ${banner.kind === 'success'
            ? 'rgba(122,171,110,0.4)'
            : banner.kind === 'warn'
              ? 'rgba(196,122,48,0.4)'
              : 'rgba(58,122,138,0.4)'}`,
          color: 'var(--text-primary)',
          borderRadius: 'var(--radius)',
          position: 'relative', zIndex: 1,
        }}>
          {banner.text}
        </div>
      )}

      {/* WAITLIST CARD */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        {waitlistDone ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>&#x2709;&#xFE0F;</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18, fontWeight: 600,
              color: 'var(--gold, #b8975a)', marginBottom: 8,
            }}>Check your inbox.</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              We sent a confirmation link to <strong style={{ color: 'var(--text-primary)' }}>{waitlistEmail}</strong>. Click it to confirm your spot.
            </div>
          </div>
        ) : (
          <>
            <div style={headingStyle}>Join the waitlist</div>
            <div style={subheadStyle}>
              Vector | WA is free. Public accounts open <strong style={{ color: 'var(--text-primary)' }}>{PUBLIC_LAUNCH}</strong>. Leave your email and we&rsquo;ll notify you the day signup opens.
            </div>

            <form onSubmit={handleJoinWaitlist}>
              <input
                type="email"
                value={waitlistEmail}
                onChange={e => setWaitlistEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'rgba(184,151,90,0.5)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />
              {/* Honeypot — hidden from humans, bots fill it */}
              <div aria-hidden="true" style={{
                position: 'absolute', left: '-9999px', top: 'auto',
                width: 1, height: 1, overflow: 'hidden',
              }}>
                <label htmlFor="hp_field">Leave this field blank</label>
                <input
                  id="hp_field"
                  type="text"
                  tabIndex={-1}
                  autoComplete="off"
                  value={waitlistHp}
                  onChange={e => setWaitlistHp(e.target.value)}
                />
              </div>
              {waitlistError && (
                <div style={{
                  fontSize: 12, color: 'var(--danger)',
                  marginBottom: 10, padding: '8px 12px',
                  background: 'var(--danger-pale)',
                  borderRadius: 6,
                }}>{waitlistError}</div>
              )}
              <button type="submit" disabled={waitlistLoading} style={buttonStyle(waitlistLoading, 'brass')}>
                {waitlistLoading ? 'Joining\u2026' : 'Join waitlist'}
              </button>
            </form>
            <p style={{
              margin: '12px 0 0', fontSize: 11, color: 'var(--text-faint)',
              lineHeight: 1.5, textAlign: 'center',
            }}>
              No spam. No tracking. We&rsquo;ll email you once when signup opens, then you&rsquo;re off the list.
            </p>
          </>
        )}
      </div>

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
              <button type="submit" disabled={loading} style={buttonStyle(loading, 'teal')}>
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
        Vector | WA &copy; 2026 Shorepine Civic Tech &middot; Nonpartisan &middot; We don&rsquo;t lobby
      </div>
    </div>
  )
}
