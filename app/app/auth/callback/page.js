'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../../lib/supabase'

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
          router.replace('/')
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
        backgroundImage: 'radial-gradient(ellipse at 50% 30%, rgba(0,229,204,0.06) 0%, transparent 60%)',
        pointerEvents: 'none',
      }}/>

      <svg width="56" height="48" viewBox="0 0 56 48" fill="none" style={{ marginBottom: 24, filter: 'drop-shadow(0 0 16px rgba(0,229,204,0.3))' }}>
        <path d="M4 4 L28 44 L52 4" stroke="var(--teal)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <path d="M28 44 L52 20" stroke="var(--teal-dim)" strokeWidth="4" strokeLinecap="round" fill="none"/>
        <polygon points="52,14 58,22 44,22" fill="var(--gold)"/>
      </svg>

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18, fontWeight: 600,
        color: isError ? 'var(--danger)' : 'var(--teal)',
        textAlign: 'center', maxWidth: 320,
        textShadow: isError ? 'none' : '0 0 16px rgba(0,229,204,0.2)',
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
