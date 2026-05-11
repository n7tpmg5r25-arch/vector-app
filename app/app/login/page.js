'use client'
import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'

/**
 * LoginPage
 *
 * Minimal sign-in gate. Magic link, shouldCreateUser: false — strangers
 * can't self-signup. Anyone not on the access list sees a brief error.
 *
 * Anon exit ramp (Thread 65, 2026-05-03):
 *   Methodology + About brass-outline CTAs render below the sign-in card
 *   so visitors who aren't on the access list have a path to read what
 *   Vector | WA is and how scoring works before bouncing. Both routes
 *   are anon-allowlisted in proxy.js (isPublicLayerRoute). The pair sits
 *   OUTSIDE the card branch on purpose — they persist across the
 *   pre-send and post-send ("Check your email") states.
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

  // Beta signup state
  const [betaEmail, setBetaEmail] = useState('')
  const [betaSent, setBetaSent] = useState(false)
  const [betaLoading, setBetaLoading] = useState(false)
  const [betaError, setBetaError] = useState('')
  const [acks, setAcks] = useState({ a: false, b: false, c: false, d: false })
  const allAcked = acks.a && acks.b && acks.c && acks.d

  // Banner from auth callback redirect or waitlist confirmation
  const [banner, setBanner] = useState(null)
  useEffect(() => {
    const err = searchParams.get('error')
    const wl  = searchParams.get('waitlist')
    if (err === 'auth_callback_error') {
      setBanner({ kind: 'warn', text: 'Sign-in link expired or invalid. Request a new magic link below.' })
    } else if (wl === 'confirmed') {
      setBanner({ kind: 'ok', text: "Email confirmed — you’re on the beta list. We’ll be in touch around December 2026." })
    } else if (wl === 'already_confirmed') {
      setBanner({ kind: 'ok', text: "You’re already confirmed on the beta list. Watch for your invite in December 2026." })
    } else if (wl === 'invalid' || wl === 'error') {
      setBanner({ kind: 'warn', text: 'That confirmation link is invalid or expired. Try signing up again below.' })
    }
  }, [searchParams])

  async function handleBetaSignup(e) {
    e.preventDefault()
    if (!allAcked) return
    setBetaLoading(true)
    setBetaError('')
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: betaEmail,
          source: 'closed_beta',
          beta_ack_at: new Date().toISOString(),
        }),
      })
      const json = await res.json()
      if (json.ok) {
        setBetaSent(true)
      } else {
        setBetaError(json.error || 'Something went wrong. Try again.')
      }
    } catch {
      setBetaError('Network error. Check your connection and try again.')
    }
    setBetaLoading(false)
  }

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
        setError("This email isn’t on the access list.")
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
      padding: '40px 24px 48px',
      position: 'relative', overflowX: 'hidden',
    }}>
      {/* Background glow */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(ellipse at 50% 30%, rgba(184,151,90,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }}/>

      {/* Logo — Shorepine GR v4.6 primary lockup */}
      <div style={{ marginBottom: 32, textAlign: 'center', position: 'relative', zIndex: 1 }}>
        <img
          src="/logos/vector-wa-primary.svg"
          alt="Vector | WA"
          width={280}
          height={153}
          style={{
            maxWidth: '80%',
            height: 'auto',
            display: 'inline-block',
            filter: 'drop-shadow(0 0 18px rgba(184,151,90,0.25))',
          }}
        />
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginTop: 12,
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
              <button type="submit" disabled={loading} className="vec-cta-primary" style={buttonStyle(loading)}>
                {loading ? 'Sending…' : 'Send magic link'}
              </button>
            </form>
          </>
        )}
      </div>

      {/* Anon exit ramp (Thread 65) — Methodology + About brass-outline
          CTAs. Persist across pre-send and post-send card states. */}
      <div style={{
        marginTop: 24,
        width: '100%',
        maxWidth: 380,
        position: 'relative',
        zIndex: 1,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono, "DM Mono", monospace)',
          fontSize: 10,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--text-faint)',
          textAlign: 'center',
          marginBottom: 10,
        }}>
          Learn more
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          gap: 10,
        }}>
          <Link
            href="/methodology"
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 12px',
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid rgba(184,151,90,0.40)',
              borderRadius: 'var(--radius)',
              color: 'var(--brass-light, var(--gold))',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.02em',
              textDecoration: 'none',
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            Methodology
          </Link>
          <Link
            href="/about"
            style={{
              flex: 1,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '10px 12px',
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid rgba(184,151,90,0.40)',
              borderRadius: 'var(--radius)',
              color: 'var(--brass-light, var(--gold))',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 500,
              letterSpacing: '0.02em',
              textDecoration: 'none',
              transition: 'background 0.2s, border-color 0.2s',
            }}
          >
            About
          </Link>
        </div>
      </div>

      {/* Thread 72 — Roadmap CTA. Single centered link below the
          Methodology + About pair. Brass-outline treatment matches
          the existing pair; narrower to avoid cluttering the 380px
          card at small viewport widths. */}
      <div style={{
        marginTop: 10,
        width: '100%',
        maxWidth: 380,
        position: 'relative',
        zIndex: 1,
        textAlign: 'center',
      }}>
        <Link
          href="/roadmap"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '8px 20px',
            background: 'rgba(184,151,90,0.06)',
            border: '1px solid rgba(184,151,90,0.40)',
            borderRadius: 'var(--radius)',
            color: 'var(--brass-light, var(--gold))',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 500,
            letterSpacing: '0.02em',
            textDecoration: 'none',
            transition: 'background 0.2s, border-color 0.2s',
          }}
        >
          View roadmap &rarr;
        </Link>
      </div>

      {/* ── Closed Beta Signup (Thread 73) ───────────────────────────────
          Sits below the sign-in card + info CTAs. Separate concern from
          sign-in — different state machine, different endpoint, different
          confirmation flow. All four acknowledgment boxes must be checked
          before the button activates. */}
      <div style={{
        marginTop: 28,
        width: '100%',
        maxWidth: 380,
        position: 'relative',
        zIndex: 1,
      }}>
        {/* Divider */}
        <div style={{
          borderTop: '1px solid var(--border)',
          marginBottom: 24,
        }} />

        {betaSent ? (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
            textAlign: 'center',
          }}>
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: 10,
            }}>Request received</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 17, fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: 8,
            }}>Check your inbox</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6 }}>
              We sent a confirmation link to <strong style={{ color: 'var(--text-primary)' }}>{betaEmail}</strong>.
              Click it to lock in your spot.{' '}
              <Link href="/roadmap" style={{ color: 'var(--teal)', textDecoration: 'none' }}>
                See the roadmap &rarr;
              </Link>
            </div>
          </div>
        ) : (
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--teal)',
            borderRadius: 'var(--radius-lg)',
            padding: '24px',
          }}>
            {/* Eyebrow */}
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10, letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--teal)',
              marginBottom: 8,
            }}>Closed Beta &middot; December 2026</div>

            {/* Headline */}
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18, fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: 6,
            }}>Join the beta</div>

            {/* Subhead */}
            <div style={{
              fontSize: 13, color: 'var(--text-muted)',
              lineHeight: 1.55, marginBottom: 20,
            }}>
              Help shape Vector&nbsp;|&nbsp;WA before public launch.
              Bug-finders only &mdash; we&rsquo;ll send your invite around December&nbsp;2026.
            </div>

            <form onSubmit={handleBetaSignup}>
              {/* Email */}
              <input
                type="email"
                value={betaEmail}
                onChange={e => setBetaEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoComplete="email"
                style={{
                  width: '100%', padding: '11px 13px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', fontSize: 14,
                  color: 'var(--text-primary)', marginBottom: 16,
                  outline: 'none', boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = 'rgba(184,151,90,0.5)'}
                onBlur={e => e.target.style.borderColor = 'var(--border)'}
              />

              {/* Acknowledgments */}
              <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {[
                  { key: 'a', text: 'I understand this is pre-release software — bugs, missing features, and unexpected behavior are expected.' },
                  { key: 'b', text: 'I agree to report issues I encounter. A feedback channel will be included in my invite.' },
                  { key: 'c', text: 'I understand beta access may be adjusted or revoked at any time — this is a working collaboration, not a right of use.' },
                  { key: 'd', text: 'My email will only be used to send my beta invite. It won\'t be shared, sold, or used for any other purpose.' },
                ].map(({ key, text }) => (
                  <label key={key} style={{
                    display: 'flex', gap: 10, alignItems: 'flex-start',
                    cursor: 'pointer',
                  }}>
                    <input
                      type="checkbox"
                      checked={acks[key]}
                      onChange={e => setAcks(prev => ({ ...prev, [key]: e.target.checked }))}
                      style={{
                        marginTop: 2, flexShrink: 0,
                        width: 15, height: 15,
                        accentColor: 'var(--teal)',
                        cursor: 'pointer',
                      }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {text}
                    </span>
                  </label>
                ))}
              </div>

              {betaError && (
                <div style={{
                  fontSize: 12, color: 'var(--danger)',
                  marginBottom: 10, padding: '8px 12px',
                  background: 'var(--danger-pale)',
                  borderRadius: 6,
                }}>{betaError}</div>
              )}

              {/* Honeypot — hidden from humans, catches bots */}
              <input type="text" name="hp" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />

              <button
                type="submit"
                disabled={!allAcked || !betaEmail || betaLoading}
                className="vec-cta-primary"
                style={{
                  width: '100%', padding: '12px',
                  background: (allAcked && betaEmail && !betaLoading)
                    ? 'var(--teal)' : 'var(--teal-dim)',
                  color: 'var(--bg)',
                  border: 'none',
                  borderRadius: 'var(--radius)', fontSize: 14,
                  fontWeight: 600, letterSpacing: '0.04em',
                  cursor: (allAcked && betaEmail && !betaLoading) ? 'pointer' : 'default',
                  transition: 'background 0.2s',
                }}
              >
                {betaLoading ? 'Submitting…' : 'Request beta access'}
              </button>
            </form>

            <div style={{
              marginTop: 12, fontSize: 11,
              color: 'var(--text-faint)', lineHeight: 1.5,
              textAlign: 'center',
            }}>
              Emails are not shared. Public launch is Aug&nbsp;2027 &mdash; no signup required for that.
            </div>
          </div>
        )}
      </div>

      <div style={{
        marginTop: 20, fontSize: 11,
        color: 'var(--text-faint)', textAlign: 'center',
        position: 'relative', zIndex: 1,
      }}>
        Vector | WA &copy; {new Date().getFullYear()}
      </div>
    </div>
  )
}
