'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../../lib/supabase'
import { isAdmin } from '../../../lib/admin'

/**
 * Thread 3 added role-aware post-login routing. The flow:
 *
 *   1. Exchange the magic-link code for a session (existing behavior).
 *   2. If the signed-in user is the Vector admin (Colin, by UID), send
 *      them to '/'. Admin is detected before client_users lookup because
 *      Colin is also a member of the "Shorepine Internal" test client
 *      — without the admin-first rule, he'd be routed into /c/internal
 *      on every login, which is the wrong default for the owner.
 *   3. Otherwise, query the user's client_users memberships via the
 *      browser Supabase client. RLS on client_users (user_id = auth.uid())
 *      and clients (auth_user_client_ids) both admit the authed user for
 *      rows they own, so no service_role is needed here.
 *   4. If the user has at least one membership, redirect to the first
 *      slug's portal (/c/{slug}). If none, fall back to '/'. A stranded
 *      authed user with no admin flag and no memberships lands on the
 *      owner home, which at minimum will render (it's the anon-friendly
 *      public home when PUBLIC_LAYER is on) and prompts Colin to fix the
 *      provisioning on his side.
 *
 * The lookup is one round-trip and is bounded to the rows the user can
 * see by RLS, so it stays cheap even as client counts grow.
 */
async function resolveLandingPath(supabase, user) {
  if (!user) return '/login'
  if (isAdmin(user)) return '/'
  try {
    const { data, error } = await supabase
      .from('client_users')
      .select('clients(slug)')
      .order('invited_at', { ascending: true })
      .limit(1)
    if (error) throw error
    const slug = data?.[0]?.clients?.slug
    if (slug) return `/c/${slug}`
  } catch (err) {
    // Non-fatal: the user is authed, we just can't determine a portal
    // slug. Send them to '/' and let the owner/admin unblock manually.
    console.error('[auth/callback] client_users lookup failed', err)
  }
  return '/'
}

/**
 * Thread 54 (Phase 5) — map known Supabase auth/PKCE error patterns to
 * friendly, actionable copy. Raw library strings ("PKCE code verifier
 * not found in storage...") are technically accurate but break user
 * trust on first sign-in and don't tell anyone what to do next. Per
 * Brand Guide v1.2 §05 (voice — plain English, actionable). Patterns
 * checked in priority order; everything else falls through to a default
 * catch-all that points users back at /login. The single `expired`
 * substring covers `otp_expired`, `link_expired`, and our own thrown
 * "The link may have expired." string from the no-session branch.
 */
function errorToCopy(err) {
  const raw = (err?.message || '').toLowerCase()
  if (raw.includes('code verifier')) {
    return 'Your sign-in link expired or was opened in a different browser. Request a new one.'
  }
  if (raw.includes('expired')) {
    return 'This sign-in link has expired. Magic links are valid for 1 hour.'
  }
  if (raw.includes('invalid')) {
    return 'This sign-in link is no longer valid. Request a new one.'
  }
  return 'Sign-in failed. Please request a new link from /login.'
}

export default function AuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState('Signing you in...')
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    const supabase = createBrowserClient()

    async function complete() {
      try {
        // The browser client auto-detects the code/token from the URL on init
        // (detectSessionInUrl: true by default). If PKCE, exchange the code.
        const url = typeof window !== 'undefined' ? window.location.href : ''
        const hasCode = url.includes('code=')

        if (hasCode && supabase.auth.exchangeCodeForSession) {
          const { error } = await supabase.auth.exchangeCodeForSession(url)
          if (error) throw error
        }

        // Give the client a tick to persist the session, then verify
        await new Promise(r => setTimeout(r, 400))
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error

        if (data?.session) {
          setStatus('Success — redirecting...')
          const landing = await resolveLandingPath(supabase, data.session.user)
          router.replace(landing)
        } else {
          throw new Error('No session returned. The link may have expired.')
        }
      } catch (err) {
        console.error('[auth/callback]', err)
        setIsError(true)
        // Thread 54: never surface raw Supabase strings; map to friendly
        // copy via errorToCopy(). Auto-redirect extended to 4500ms so
        // users have time to read the message and choose to click the
        // "Sign in again" CTA before the redirect fires.
        setStatus(errorToCopy(err))
        setTimeout(() => router.replace('/login'), 4500)
      }
    }

    complete()
  }, [router])

  return (
    <div style={{
      minHeight: '100vh', background: 'var(--bg)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: '24px', position: 'relative', overflow: 'hidden',
      fontFamily: 'var(--font-body)',
    }}>
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'radial-gradient(ellipse at 50% 30%, rgba(184,151,90,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }}/>

      {/* Thread 54: canonical primary lockup per Brand Guide v1.2 §02.
          Replaces a hand-rolled inline V-mark that pre-dated the v1.2
          logo asset set. Mirrors the precedent set on /login (lines
          122-134) so the auth flow uses one logo treatment end-to-end. */}
      <img
        src="/logos/vector-wa-primary.svg"
        alt="Vector | WA"
        width={200}
        style={{
          height: 'auto',
          maxWidth: '80%',
          marginBottom: 24,
          filter: 'drop-shadow(0 0 18px rgba(184,151,90,0.25))',
          position: 'relative',
          zIndex: 1,
        }}
      />

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18, fontWeight: 600,
        color: isError ? 'var(--danger)' : 'var(--brass-light)',
        textAlign: 'center', maxWidth: 320,
        textShadow: isError ? 'none' : '0 0 16px rgba(184,151,90,0.2)',
        position: 'relative', zIndex: 1,
      }}>
        {status}
      </div>

      {!isError && (
        <div style={{
          marginTop: 16, fontSize: 12, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          position: 'relative', zIndex: 1,
        }}>
          One moment
        </div>
      )}

      {isError && (
        <Link
          href="/login"
          className="vec-cta-primary"
          style={{
            display: 'inline-block',
            marginTop: 24,
            padding: '12px 28px',
            background: 'var(--brass)',
            color: 'var(--bg)',
            textDecoration: 'none',
            border: 'none',
            borderRadius: 'var(--radius)',
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: '0.04em',
            fontFamily: 'var(--font-body)',
            position: 'relative', zIndex: 1,
          }}
        >
          Sign in again
        </Link>
      )}
    </div>
  )
}
