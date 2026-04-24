'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
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
        setStatus(err?.message || 'Sign-in failed. Please request a new link.')
        setTimeout(() => router.replace('/login'), 2500)
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

      <svg width="56" height="48" viewBox="0 0 56 48" fill="none" style={{ marginBottom: 24, filter: 'drop-shadow(0 0 16px rgba(184,151,90,0.3))' }}>
        <path d="M4 4 L28 44 L52 4" stroke="var(--gold)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <path d="M28 44 L52 20" stroke="var(--gold-light)" strokeWidth="4" strokeLinecap="round" fill="none"/>
        <polygon points="52,14 58,22 44,22" fill="var(--gold-light)"/>
      </svg>

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18, fontWeight: 600,
        color: isError ? 'var(--danger)' : 'var(--gold)',
        textAlign: 'center', maxWidth: 320,
        textShadow: isError ? 'none' : '0 0 16px rgba(184,151,90,0.2)',
      }}>
        {status}
      </div>

      {!isError && (
        <div style={{
          marginTop: 16, fontSize: 12, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          One moment
        </div>
      )}
    </div>
  )
}
