'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../../lib/supabase'

/**
 * Sign-out button for the client portal shell (Thread 3).
 *
 * Uses the browser Supabase client so the local session is cleared before
 * we push the user back to /login. Router push is unconditional — if the
 * signOut call errors (offline, token already invalid), we still want the
 * user off this page.
 */
export default function SignOutButton({ style }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function handleSignOut() {
    if (busy) return
    setBusy(true)
    try {
      const supabase = createBrowserClient()
      await supabase.auth.signOut()
    } catch (_) {
      // Intentional: always leave the page on sign-out click.
    } finally {
      router.replace('/login')
    }
  }

  const baseStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '6px 12px',
    fontSize: 12,
    fontWeight: 500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    color: '#f5f0e6',
    background: 'transparent',
    border: '1px solid rgba(245, 240, 230, 0.35)',
    borderRadius: 6,
    cursor: busy ? 'default' : 'pointer',
    opacity: busy ? 0.5 : 1,
    transition: 'background 0.15s, border-color 0.15s',
    ...style,
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      disabled={busy}
      style={baseStyle}
      onMouseEnter={(e) => {
        if (busy) return
        e.currentTarget.style.background = 'rgba(245, 240, 230, 0.08)'
        e.currentTarget.style.borderColor = 'rgba(245, 240, 230, 0.6)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.borderColor = 'rgba(245, 240, 230, 0.35)'
      }}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
