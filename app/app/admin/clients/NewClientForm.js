'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * NewClientForm — inline create-client form on /admin/clients
 *
 * Posts to /api/admin/clients, which does the service_role INSERT and
 * returns the new row. We then router.refresh() to rehydrate the server-
 * rendered table in the parent page.
 *
 * Validation mirrors the DB CHECK constraint (reserved slugs) — the server
 * is the source of truth; this pre-check is only there to save a round-trip
 * and give a friendlier inline error.
 */

const RESERVED_SLUGS = new Set([
  'app', 'admin', 'login', 'c', 'auth', 'api', 'www',
  'public', 'signup', 'signin', 'signout', 'settings',
])

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

export default function NewClientForm() {
  const router = useRouter()
  const [name, setName]       = useState('')
  const [slug, setSlug]       = useState('')
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [success, setSuccess] = useState('')

  function slugify(s) {
    return s.toLowerCase().trim()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setSuccess('')

    const trimmedName = name.trim()
    const finalSlug = (slug || slugify(trimmedName)).trim()

    if (!trimmedName) { setError('Name is required.'); return }
    if (!SLUG_RE.test(finalSlug)) {
      setError('Slug must be 1–40 chars, lowercase letters, digits, or hyphens. No leading/trailing hyphen.')
      return
    }
    if (RESERVED_SLUGS.has(finalSlug)) {
      setError(`"${finalSlug}" is reserved — pick another slug.`)
      return
    }

    setBusy(true)
    try {
      const resp = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, slug: finalSlug }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.ok) {
        setError(json.error || `Could not create team (${resp.status}).`)
      } else {
        setSuccess(`Created "${trimmedName}" at /c/${finalSlug}.`)
        setName('')
        setSlug('')
        router.refresh()
      }
    } catch (err) {
      setError('Network error — please try again.')
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
    minWidth: 0,
    flex: '1 1 auto',
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: 'var(--text-primary)' }}>
        New team
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          type="text"
          placeholder='Name (e.g. "Joint Base Lewis-McChord")'
          value={name}
          onChange={e => {
            setName(e.target.value)
            // Auto-suggest slug as user types, unless they've already edited it.
            if (!slug) setSlug('')
          }}
          style={{ ...inputStyle, minWidth: 260 }}
          disabled={busy}
        />
        <input
          type="text"
          placeholder={name ? slugify(name) : 'slug'}
          value={slug}
          onChange={e => setSlug(e.target.value.toLowerCase())}
          style={{ ...inputStyle, maxWidth: 180, fontFamily: 'monospace' }}
          disabled={busy}
          maxLength={40}
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
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
          {busy ? 'Creating\u2026' : 'Create team'}
        </button>
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--text-faint)' }}>
        URL will be <code>/c/{slug || slugify(name) || '[slug]'}</code>.
        Reserved slugs (app, admin, login, api, c, auth, www, public, signup, signin, signout, settings) are blocked.
      </p>

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', color: 'var(--danger, #d16a6a)', fontSize: 13 }}>
          {error}
        </p>
      )}
      {success && (
        <p style={{ margin: '10px 0 0', color: 'var(--gold-light, #d4b47a)', fontSize: 13 }}>
          {success}
        </p>
      )}
    </form>
  )
}
