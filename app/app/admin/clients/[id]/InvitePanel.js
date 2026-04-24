'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * InvitePanel — client-user invite form on /admin/clients/[id]
 *
 * Shipped in Thread 2 PR (b) (2026-04-23). Posts to /api/admin/invite,
 * which runs the service-role admin API server-side to create/upsert the
 * auth user, stamp app_metadata.role='client', and insert the
 * client_users row. The server route also returns a magic-link URL.
 *
 * The service-role key NEVER crosses the browser boundary. This component
 * only knows the email the admin typed.
 */

export default function InvitePanel({ clientId, clientSlug }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setResult(null)

    const trimmed = email.trim().toLowerCase()
    if (!trimmed || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) || trimmed.length > 320) {
      setError('Please enter a valid email address.')
      return
    }

    setBusy(true)
    try {
      const resp = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, email: trimmed }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.ok) {
        setError(json.error || `Invite failed (${resp.status}).`)
      } else {
        setResult({
          email: trimmed,
          already_member: !!json.already_member,
          magic_link: json.magic_link || null,
        })
        setEmail('')
        router.refresh()
      }
    } catch {
      setError('Network error \u2014 please try again.')
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = {
    padding: '8px 10px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-primary)',
    fontSize: 14,
    flex: '1 1 260px',
    minWidth: 0,
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        Invite a user
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="email"
          placeholder="person@company.com"
          value={email}
          onChange={e => setEmail(e.target.value)}
          style={inputStyle}
          disabled={busy}
          required
        />
        <button
          type="submit"
          disabled={busy || !email.trim()}
          style={{
            padding: '8px 18px',
            background: busy ? 'var(--bg)' : 'var(--gold, #b8975a)',
            color: busy ? 'var(--text-muted)' : '#0e1014',
            border: '1px solid var(--gold, #b8975a)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            fontWeight: 700,
            cursor: busy ? 'default' : 'pointer',
            letterSpacing: '0.03em',
          }}
        >
          {busy ? 'Inviting\u2026' : 'Send invite'}
        </button>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
        Creates the user (if needed), stamps <code>app_metadata.role=&#39;client&#39;</code>,
        and generates a magic link. Post-callback routing to <code>/c/{clientSlug}</code> ships with Thread 3.
      </p>

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', color: 'var(--danger, #d16a6a)', fontSize: 13 }}>
          {error}
        </p>
      )}
      {result && (
        <div style={{ margin: '10px 0 0', color: 'var(--gold-light, #d4b47a)', fontSize: 13 }}>
          {result.already_member
            ? <>{result.email} was already a member of this client.</>
            : <>Invite ready for {result.email}.</>}
          {result.magic_link && (
            <details style={{ marginTop: 6, color: 'var(--text-muted)' }} open>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                Copy magic link (paste into the user&#39;s browser if email is slow)
              </summary>
              <code style={{
                display: 'block',
                marginTop: 6,
                padding: '8px 10px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                fontSize: 11,
                wordBreak: 'break-all',
              }}>
                {result.magic_link}
              </code>
            </details>
          )}
        </div>
      )}
    </form>
  )
}
