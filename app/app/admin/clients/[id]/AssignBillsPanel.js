'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../../../lib/supabase'

/**
 * AssignBillsPanel — assign/unassign bills on /admin/clients/[id]
 *
 * Fetches the owner's tracked_bills (user_id = me). Each row renders with
 * a checkbox that's checked when client_id === this client. Toggling rows
 * and clicking "Save" POSTs to /api/admin/assign-bills which does the
 * service-role UPDATE for all changed rows in one round-trip.
 *
 * Why service_role on the server? The owner's tracked_bills SELECT policy
 * returns rows, but UPDATE of client_id has no special policy. Writing
 * via service_role keeps the admin surface consistent and sidesteps any
 * client-scoped RLS that might land later.
 *
 * v1 scope: only re-parents rows already on the owner's watchlist. Bulk-
 * adding bills from search was deliberately NOT chosen for Thread 2 — the
 * spec text reads "update tracked_bills.client_id for rows where user_id
 * = owner", i.e. re-parent existing rows.
 */

export default function AssignBillsPanel({ clientId }) {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [rows, setRows]     = useState(null) // null = loading
  const [search, setSearch] = useState('')
  const [sel, setSel]       = useState({})   // { bill_id: bool } — desired state
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    let mounted = true
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (mounted) setRows([])
        return
      }
      const { data, error } = await supabase
        .from('tracked_bills')
        .select(`
          bill_id, client_id, tag, added_at,
          bills ( bill_id, bill_number, title, stage, session )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

      if (!mounted) return
      if (error) {
        setError(`Could not load your watchlist: ${error.message}`)
        setRows([])
        return
      }
      const items = (data || []).filter(r => r.bills)
      setRows(items)
      const initial = {}
      for (const r of items) {
        initial[r.bill_id] = r.client_id === clientId
      }
      setSel(initial)
    }
    load()
    return () => { mounted = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const filtered = useMemo(() => {
    if (!rows) return null
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r => {
      const num = (r.bills.bill_number || r.bill_id || '').toLowerCase()
      const title = (r.bills.title || '').toLowerCase()
      const tag = (r.tag || '').toLowerCase()
      return num.includes(q) || title.includes(q) || tag.includes(q)
    })
  }, [rows, search])

  function toggle(billId) {
    setSel(prev => ({ ...prev, [billId]: !prev[billId] }))
  }

  // Any row whose desired state differs from its loaded state counts as a
  // change. Negligible work with ~11 bills.
  const changes = useMemo(() => {
    if (!rows) return { assign: [], unassign: [] }
    const assign = []
    const unassign = []
    for (const r of rows) {
      const was = r.client_id === clientId
      const now = !!sel[r.bill_id]
      if (now && !was) assign.push(r.bill_id)
      if (!now && was) unassign.push(r.bill_id)
    }
    return { assign, unassign }
  }, [rows, sel, clientId])

  const hasChanges = changes.assign.length + changes.unassign.length > 0

  async function handleSave() {
    setError('')
    setStatus('')
    if (!hasChanges) return
    setBusy(true)
    try {
      const resp = await fetch('/api/admin/assign-bills', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          assign: changes.assign,
          unassign: changes.unassign,
        }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.ok) {
        setError(json.error || `Save failed (${resp.status}).`)
      } else {
        setStatus(`Updated ${json.assigned ?? 0} assigned, ${json.unassigned ?? 0} unassigned.`)
        router.refresh()
        // Re-sync local rows so the baseline matches the new state.
        setRows(prev => (prev || []).map(r => ({
          ...r,
          client_id: sel[r.bill_id] ? clientId : (r.client_id === clientId ? null : r.client_id),
        })))
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
    width: '100%',
    boxSizing: 'border-box',
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>Assign bills</div>
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
          Pick from your watchlist. Changes save in one batch.
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Search bill number, title, or tag"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={inputStyle}
          disabled={busy || rows === null}
        />
      </div>

      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        maxHeight: 360,
        overflowY: 'auto',
      }}>
        {rows === null ? (
          <p style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>Loading your watchlist\u2026</p>
        ) : rows.length === 0 ? (
          <p style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            You have no tracked bills yet. Add some to your watchlist first, then return to assign them.
          </p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: 16, color: 'var(--text-muted)', fontSize: 13, margin: 0 }}>
            No watchlist rows match &ldquo;{search}&rdquo;.
          </p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filtered.map(r => {
              const otherClient = r.client_id && r.client_id !== clientId
              return (
                <li
                  key={r.bill_id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderBottom: '1px solid var(--border)',
                    cursor: busy ? 'default' : 'pointer',
                  }}
                  onClick={() => !busy && toggle(r.bill_id)}
                >
                  <input
                    type="checkbox"
                    checked={!!sel[r.bill_id]}
                    onChange={() => toggle(r.bill_id)}
                    disabled={busy}
                    onClick={e => e.stopPropagation()}
                    style={{ cursor: busy ? 'default' : 'pointer', accentColor: 'var(--gold, #b8975a)' }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {r.bills.bill_number || r.bill_id}
                      </span>
                      {r.bills.title ? (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                          {r.bills.title.length > 80 ? r.bills.title.slice(0, 80) + '\u2026' : r.bills.title}
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
                      {r.bills.stage ? <>{r.bills.stage}</> : null}
                      {r.tag ? <> &middot; tag: {r.tag}</> : null}
                      {otherClient ? (
                        <> &middot; <span style={{ color: 'var(--danger, #d16a6a)' }}>
                          already assigned to another client
                        </span></>
                      ) : null}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Save bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy || !hasChanges}
          style={{
            padding: '8px 18px',
            background: hasChanges && !busy ? 'var(--gold, #b8975a)' : 'var(--bg)',
            color: hasChanges && !busy ? '#0e1014' : 'var(--text-muted)',
            border: '1px solid var(--gold, #b8975a)',
            borderRadius: 'var(--radius)',
            fontSize: 13,
            fontWeight: 700,
            cursor: hasChanges && !busy ? 'pointer' : 'default',
            letterSpacing: '0.03em',
          }}
        >
          {busy
            ? 'Saving\u2026'
            : hasChanges
              ? `Save (${changes.assign.length + changes.unassign.length})`
              : 'No changes'}
        </button>
        {hasChanges && (
          <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
            +{changes.assign.length} assign &middot; &minus;{changes.unassign.length} unassign
          </span>
        )}
      </div>

      {error && (
        <p role="alert" style={{ margin: '10px 0 0', color: 'var(--danger, #d16a6a)', fontSize: 13 }}>
          {error}
        </p>
      )}
      {status && (
        <p style={{ margin: '10px 0 0', color: 'var(--gold-light, #d4b47a)', fontSize: 13 }}>
          {status}
        </p>
      )}
    </div>
  )
}
