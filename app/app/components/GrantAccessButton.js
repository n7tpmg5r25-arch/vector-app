'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

/**
 * GrantAccessButton — inline action for /admin/waitlist rows.
 *
 * Props:
 *   waitlistId     {string}   — UUID of the waitlist row (for converted_at update)
 *   email          {string}   — applicant email (passed to inviteUserByEmail)
 *   alreadyInvited {boolean}  — true when converted_at is already set on page load
 *
 * States: idle → loading → invited | error
 *   idle:    brass-outline "Grant access" button
 *   loading: muted "Sending…" (button disabled)
 *   invited: DM Mono "Invited ✓" in brass (no button)
 *   error:   inline error message + "Retry" button
 *
 * Thread 78 — 2026-05-11.
 */
export default function GrantAccessButton({ waitlistId, email, alreadyInvited }) {
  const [status, setStatus] = useState(alreadyInvited ? 'invited' : 'idle')
  const [errMsg, setErrMsg] = useState('')

  async function handleGrant() {
    setStatus('loading')
    setErrMsg('')

    try {
      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      )
      const { data: { session } } = await sb.auth.getSession()
      if (!session) {
        setStatus('error')
        setErrMsg('Not signed in')
        return
      }

      const res = await fetch('/api/admin/grant-access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ email, waitlistId }),
      })

      const json = await res.json()
      if (!res.ok || !json.ok) {
        setStatus('error')
        setErrMsg(json.error || 'Unknown error')
        return
      }

      setStatus('invited')

    } catch {
      setStatus('error')
      setErrMsg('Network error')
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (status === 'invited') {
    return (
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: 'var(--teal)',
      }}>
        Invited ✓
      </span>
    )
  }

  if (status === 'error') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <button onClick={handleGrant} style={btnStyle(false)}>Retry</button>
        <span style={{ color: 'var(--danger, #c44730)', fontSize: 11 }}>{errMsg}</span>
      </span>
    )
  }

  return (
    <button
      onClick={handleGrant}
      disabled={status === 'loading'}
      style={btnStyle(status === 'loading')}
    >
      {status === 'loading' ? 'Sending…' : 'Grant access'}
    </button>
  )
}

function btnStyle(disabled) {
  return {
    padding: '4px 10px',
    borderRadius: 'var(--radius)',
    border: `1px solid ${disabled ? 'var(--border)' : 'var(--teal)'}`,
    background: disabled ? 'var(--bg-card)' : 'rgba(184,151,90,0.10)',
    color: disabled ? 'var(--text-muted)' : 'var(--teal)',
    fontSize: 11,
    fontWeight: 600,
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: disabled ? 'default' : 'pointer',
    transition: 'opacity 0.15s',
  }
}
