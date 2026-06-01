'use client'
/**
 * VECTOR | WA — Radar (Thread R3, Phase 1 user-complete)
 *
 * The discovery layer that feeds the watchlist. Where the watchlist tracks
 * bills you already know about, Radar watches for brand-new bills the day
 * they are introduced — matched against saved terms (an issue, a client, a
 * place) using Postgres full-text search server-side (detect-radar.js).
 *
 * This page is the user surface for Phase 1:
 *   (a) create / edit / enable / delete terms (label, client, query, scope,
 *       cadence),
 *   (b) terms grouped by client with a match-count badge,
 *   (c) a reverse-chron feed of matches with Track (→ watchlist) and Open
 *       (→ bill detail).
 *
 * Registered-tier (owner-only) route: proxy.js redirects anon visitors to
 * /login before this renders, and radar_terms / radar_matches RLS is
 * owner-only, so every query is implicitly scoped to the signed-in user.
 *
 * Honors the deep-link /radar?new=1&q=<query> from the Search page's
 * "Save as Radar term" button — opens the form pre-filled.
 *
 * Mobile-only (480px column). No desktop breakpoints. scoreBill() untouched.
 */
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'
import DropdownMenu from '../components/DropdownMenu'
import VectorLoader from '../components/VectorLoader'

const SCOPES = [
  { value: 'all', label: 'Title + summaries' },
  { value: 'title', label: 'Title only' },
]
const CADENCES = [
  { value: 'immediate', label: 'Email right away' },
  { value: 'digest', label: 'Feed only' },
]

const REASON_LABEL = {
  new_bill: 'New bill',
  material_change: 'Language changed',
  new_language: 'New language',
}

function relativeDate(iso) {
  if (!iso) return ''
  const then = new Date(iso)
  const diff = Date.now() - then.getTime()
  const day = 86400000
  if (diff < day) return 'Today'
  if (diff < 2 * day) return 'Yesterday'
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function RadarContent() {
  const searchParams = useSearchParams()
  const supabase = createBrowserClient()
  const { user, loading: viewerLoading } = useViewer()

  const [loading, setLoading] = useState(true)
  const [clients, setClients] = useState([])
  const [terms, setTerms] = useState([])
  const [matches, setMatches] = useState([])
  const [trackedIds, setTrackedIds] = useState(new Set())

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [fLabel, setFLabel] = useState('')
  const [fClient, setFClient] = useState('')
  const [fQuery, setFQuery] = useState('')
  const [fScope, setFScope] = useState('all')
  const [fCadence, setFCadence] = useState('immediate')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)

  const loadAll = useCallback(async () => {
    if (!user) return
    setLoading(true)

    const [clientsRes, termsRes, matchesRes, trackedRes] = await Promise.all([
      supabase.from('clients').select('id, name').order('name'),
      supabase
        .from('radar_terms')
        .select('id, label, client_id, query, match_scope, cadence, enabled, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('radar_matches')
        .select(`
          id, term_id, bill_id, match_reason, detected_at, seen_at,
          bills ( bill_id, bill_number, title, chamber, final_score, confidence_label )
        `)
        .order('detected_at', { ascending: false })
        .limit(500),
      supabase.from('tracked_bills').select('bill_id').eq('user_id', user.id),
    ])

    setClients(clientsRes.data || [])
    setTerms(termsRes.data || [])
    setMatches(matchesRes.data || [])
    setTrackedIds(new Set((trackedRes.data || []).map(r => r.bill_id)))
    setLoading(false)
  }, [user?.id])

  useEffect(() => {
    if (viewerLoading) return
    loadAll()
  }, [viewerLoading, loadAll])

  // Deep-link: /radar?new=1&q=<query> opens the form pre-filled (from the
  // Search page's "Save as Radar term" button). Runs once on mount.
  useEffect(() => {
    if (searchParams?.get('new') === '1') {
      const q = searchParams.get('q') || ''
      setFQuery(q)
      setFLabel(q ? q.replace(/["'-]/g, '').trim().slice(0, 60) : '')
      setShowForm(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function resetForm() {
    setEditingId(null)
    setFLabel('')
    setFClient('')
    setFQuery('')
    setFScope('all')
    setFCadence('immediate')
    setFormError('')
  }

  function startEdit(term) {
    setEditingId(term.id)
    setFLabel(term.label)
    setFClient(term.client_id || '')
    setFQuery(term.query)
    setFScope(term.match_scope)
    setFCadence(term.cadence)
    setFormError('')
    setShowForm(true)
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function submitTerm() {
    if (!user) return
    const label = fLabel.trim()
    const query = fQuery.trim()
    if (!label || !query) {
      setFormError('Give the term a name and something to watch for.')
      return
    }
    setSaving(true)
    setFormError('')

    if (editingId) {
      // Edit: query/scope changes take effect on the next sync going forward;
      // we deliberately do NOT reset last_checked_at, so an edit never replays
      // historical bills as "new."
      const { error } = await supabase
        .from('radar_terms')
        .update({
          label,
          client_id: fClient || null,
          query,
          match_scope: fScope,
          cadence: fCadence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId)
      setSaving(false)
      if (error) { setFormError('Could not save changes. Try again.'); return }
    } else {
      // Create: last_checked_at defaults to now(), so a new term only matches
      // bills introduced from here forward — Radar is a going-forward watch,
      // not a back-search. (Use Search for bills already on the books.)
      const { error } = await supabase
        .from('radar_terms')
        .insert({
          user_id: user.id,
          label,
          client_id: fClient || null,
          query,
          match_scope: fScope,
          cadence: fCadence,
        })
      setSaving(false)
      if (error) { setFormError('Could not create term. Try again.'); return }
    }

    resetForm()
    setShowForm(false)
    loadAll()
  }

  async function toggleEnabled(term) {
    // Optimistic flip
    setTerms(prev => prev.map(t => t.id === term.id ? { ...t, enabled: !t.enabled } : t))
    const { error } = await supabase
      .from('radar_terms')
      .update({ enabled: !term.enabled, updated_at: new Date().toISOString() })
      .eq('id', term.id)
    if (error) {
      setTerms(prev => prev.map(t => t.id === term.id ? { ...t, enabled: term.enabled } : t))
    }
  }

  async function deleteTerm(term) {
    setConfirmDelete(null)
    // radar_matches cascade-delete via FK; the feed reloads below.
    setTerms(prev => prev.filter(t => t.id !== term.id))
    await supabase.from('radar_terms').delete().eq('id', term.id)
    loadAll()
  }

  async function trackMatch(match) {
    if (!user || trackedIds.has(match.bill_id)) return
    setTrackedIds(prev => new Set([...prev, match.bill_id]))
    setMatches(prev => prev.map(m => m.id === match.id ? { ...m, seen_at: new Date().toISOString() } : m))
    await supabase.from('tracked_bills').insert({ bill_id: match.bill_id, user_id: user.id, tag: null, notes: '' })
    await supabase.from('radar_matches').update({ seen_at: new Date().toISOString() }).eq('id', match.id)
  }

  // ── Derived ──
  const countByTerm = {}
  for (const m of matches) countByTerm[m.term_id] = (countByTerm[m.term_id] || 0) + 1

  // Group terms by client. clientId '' bucket = "General (no client)".
  const clientName = id => clients.find(c => c.id === id)?.name || null
  const groups = []
  const byClient = new Map()
  for (const t of terms) {
    const key = t.client_id || '__none__'
    if (!byClient.has(key)) {
      const g = { key, label: t.client_id ? (clientName(t.client_id) || 'Client') : 'General', terms: [] }
      byClient.set(key, g)
      groups.push(g)
    }
    byClient.get(key).terms.push(t)
  }
  // Clients first (alpha), General last.
  groups.sort((a, b) => (a.key === '__none__' ? 1 : b.key === '__none__' ? -1 : a.label.localeCompare(b.label)))

  const clientOptions = [{ value: '', label: 'General (no client)' }, ...clients.map(c => ({ value: c.id, label: c.name }))]

  if (viewerLoading || (loading && terms.length === 0 && matches.length === 0)) {
    return (
      <div style={{ paddingBottom: 90, fontFamily: 'var(--font-body)' }}>
        <RadarHeader />
        <VectorLoader label="Loading Radar" />
        <Nav />
      </div>
    )
  }

  return (
    <div style={{ paddingBottom: 90, fontFamily: 'var(--font-body)' }}>
      <RadarHeader />

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 22 }}>

        {/* Explainer */}
        <div style={{
          fontSize: 13, color: 'var(--text-mid)', lineHeight: 1.55,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '12px 14px',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.1em', color: 'var(--gold)', textTransform: 'uppercase', display: 'block', marginBottom: 5 }}>
            How Radar works
          </span>
          Save the issues, clients, and places you watch. When a brand-new bill is
          introduced and matches one of your terms, Vector&nbsp;|&nbsp;WA catches it on the
          next sync and folds it into your alert email. Radar watches going forward —
          for bills already on the books, use <Link href="/search" style={{ color: 'var(--teal)' }}>Search</Link>.
        </div>

        {/* New term button / form toggle */}
        {!showForm && (
          <button
            onClick={() => { resetForm(); setShowForm(true) }}
            className="vec-tap"
            style={{
              alignSelf: 'flex-start',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 'var(--radius)',
              background: 'var(--teal)', color: 'var(--bg)',
              border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-body)',
              boxShadow: 'var(--teal-glow)',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New Radar term
          </button>
        )}

        {/* Create / edit form */}
        {showForm && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid rgba(184,151,90,0.3)',
            borderRadius: 'var(--radius)', padding: '16px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--teal)' }}>
              {editingId ? 'Edit term' : 'New Radar term'}
            </div>

            {/* Label */}
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Name
              </label>
              <input
                type="text" value={fLabel} onChange={e => setFLabel(e.target.value)}
                placeholder="e.g. Cap-and-invest, Pierce County, Acme Corp"
                aria-label="Term name"
                style={inputStyle}
                onFocus={focusBorder} onBlur={blurBorder}
              />
            </div>

            {/* Client */}
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Client
              </label>
              <DropdownMenu
                value={fClient}
                onChange={v => setFClient(v)}
                options={clientOptions}
                ariaLabel="Assign to client"
                width="100%"
                triggerStyle={{ width: '100%', padding: '10px 32px 10px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-primary)', fontSize: 14, minHeight: 44 }}
              />
            </div>

            {/* Query */}
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Watch for
              </label>
              <input
                type="text" value={fQuery} onChange={e => setFQuery(e.target.value)}
                placeholder={'"cap and invest" OR carbon -commemorative'}
                aria-label="Search terms to watch for"
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                onFocus={focusBorder} onBlur={blurBorder}
              />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6, lineHeight: 1.5 }}>
                A space means <strong style={{ color: 'var(--text-muted)' }}>and</strong>. Use{' '}
                <strong style={{ color: 'var(--text-muted)' }}>OR</strong> for either,{' '}
                <strong style={{ color: 'var(--text-muted)' }}>&quot;quotes&quot;</strong> for an exact phrase, and{' '}
                <strong style={{ color: 'var(--text-muted)' }}>-word</strong> to exclude.
              </div>
            </div>

            {/* Match scope */}
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Match against
              </label>
              <SegToggle options={SCOPES} value={fScope} onChange={setFScope} />
            </div>

            {/* Cadence */}
            <div>
              <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                When a bill matches
              </label>
              <SegToggle options={CADENCES} value={fCadence} onChange={setFCadence} />
            </div>

            {formError && (
              <div style={{ fontSize: 12, color: 'var(--danger)' }}>{formError}</div>
            )}

            <div style={{ display: 'flex', gap: 10, marginTop: 2 }}>
              <button
                onClick={submitTerm} disabled={saving}
                style={{
                  flex: 1, padding: '11px', borderRadius: 'var(--radius)',
                  background: 'var(--teal)', color: 'var(--bg)', border: 'none',
                  fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create term'}
              </button>
              <button
                onClick={() => { resetForm(); setShowForm(false) }}
                style={{
                  padding: '11px 18px', borderRadius: 'var(--radius)',
                  background: 'transparent', color: 'var(--text-muted)',
                  border: '1px solid var(--border)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Terms grouped by client */}
        <div>
          <SectionLabel>Your terms{terms.length > 0 ? ` · ${terms.length}` : ''}</SectionLabel>
          {terms.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '14px 2px', lineHeight: 1.5 }}>
              No terms yet. Add one to start watching for new bills.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {groups.map(g => (
                <div key={g.key}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 7 }}>
                    {g.label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {g.terms.map(term => (
                      <div key={term.id} style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', padding: '12px 14px',
                        opacity: term.enabled ? 1 : 0.6,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3 }}>
                              {term.label}
                            </div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', wordBreak: 'break-word', marginBottom: 5 }}>
                              {term.query}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, alignItems: 'center' }}>
                              <MetaChip>{term.match_scope === 'title' ? 'Title only' : 'Title + summaries'}</MetaChip>
                              <MetaChip>{term.cadence === 'immediate' ? 'Email right away' : 'Feed only'}</MetaChip>
                              {countByTerm[term.id] > 0 && (
                                <span style={{
                                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                                  color: 'var(--gold)', background: 'var(--gold-pale)',
                                  border: '1px solid rgba(212,180,122,0.25)', borderRadius: 10,
                                  padding: '2px 8px',
                                }}>
                                  {countByTerm[term.id]} match{countByTerm[term.id] !== 1 ? 'es' : ''}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Enable toggle */}
                          <button
                            onClick={() => toggleEnabled(term)}
                            role="switch" aria-checked={term.enabled}
                            aria-label={term.enabled ? `Disable ${term.label}` : `Enable ${term.label}`}
                            style={{
                              flexShrink: 0, width: 44, height: 24, borderRadius: 12, border: 'none',
                              cursor: 'pointer', position: 'relative', marginTop: 2,
                              background: term.enabled ? 'var(--teal)' : 'var(--border)', transition: 'background 0.2s',
                            }}
                          >
                            <span style={{
                              position: 'absolute', top: 3, left: term.enabled ? 23 : 3,
                              width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'left 0.2s',
                            }} />
                          </button>
                        </div>

                        {/* Row actions */}
                        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                          <button onClick={() => startEdit(term)} className="vec-tap" style={rowActionStyle}>Edit</button>
                          {confirmDelete === term.id ? (
                            <>
                              <button onClick={() => deleteTerm(term)} className="vec-tap" style={{ ...rowActionStyle, color: 'var(--danger)', borderColor: 'rgba(196,71,48,0.4)' }}>Confirm delete</button>
                              <button onClick={() => setConfirmDelete(null)} className="vec-tap" style={rowActionStyle}>Keep</button>
                            </>
                          ) : (
                            <button onClick={() => setConfirmDelete(term.id)} className="vec-tap" style={rowActionStyle}>Delete</button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Match feed */}
        <div>
          <SectionLabel>Matches{matches.length > 0 ? ` · ${matches.length}` : ''}</SectionLabel>
          {matches.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '14px 2px', lineHeight: 1.5 }}>
              No matches yet. When a newly introduced bill hits one of your terms, it shows up here.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {matches.map(m => {
                const bill = m.bills
                const tracked = trackedIds.has(m.bill_id)
                const termLabel = terms.find(t => t.id === m.term_id)?.label
                return (
                  <div key={m.id} style={{
                    background: 'var(--bg-card)',
                    border: `1px solid ${m.seen_at ? 'var(--border)' : 'rgba(184,151,90,0.25)'}`,
                    borderRadius: 'var(--radius)', padding: '11px 12px',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}>
                    <div style={{ flexShrink: 0, paddingTop: 1 }}>
                      <ScoreBadge score={bill?.final_score} size="sm" status={bill?.confidence_label} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 2 }}>
                        <span>{bill ? `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}` : m.bill_id}</span>
                        <span style={{
                          fontSize: 9, color: 'var(--gold)', background: 'var(--gold-pale)',
                          border: '1px solid rgba(212,180,122,0.25)', borderRadius: 8, padding: '1px 6px',
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}>
                          {REASON_LABEL[m.match_reason] || m.match_reason}
                        </span>
                        <span style={{ color: 'var(--text-faint)' }}>· {relativeDate(m.detected_at)}</span>
                      </div>
                      <div style={{
                        fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.35,
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                        marginBottom: termLabel ? 3 : 0,
                      }}>
                        {bill?.title || `Bill ${m.bill_id}`}
                      </div>
                      {termLabel && (
                        <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                          matched <span style={{ color: 'var(--text-muted)' }}>{termLabel}</span>
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                        <button
                          onClick={() => trackMatch(m)} disabled={tracked} className="vec-tap"
                          style={{
                            flex: 1, padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                            background: tracked ? 'transparent' : 'var(--teal)',
                            color: tracked ? 'var(--teal)' : 'var(--bg)',
                            border: tracked ? '1px solid var(--teal)' : 'none',
                            cursor: tracked ? 'default' : 'pointer',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                          }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill={tracked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                          </svg>
                          {tracked ? 'Watching' : 'Track'}
                        </button>
                        <Link
                          href={`/bill/${m.bill_id}`}
                          className="vec-tap"
                          style={{
                            padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
                            background: 'transparent', color: 'var(--text-muted)',
                            border: '1px solid var(--border)', textDecoration: 'none',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}
                        >
                          Open
                        </Link>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <Nav />
    </div>
  )
}

// ── Small presentational helpers ──

function RadarHeader() {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 50,
      background: 'rgba(14,16,20,0.95)',
      backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      borderBottom: '1px solid var(--border)',
      padding: '52px 20px 20px',
    }}>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>
        Radar
      </div>
    </div>
  )
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>
      {children}
    </div>
  )
}

function MetaChip({ children }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-muted)',
      background: 'var(--teal-pale)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '2px 8px',
    }}>{children}</span>
  )
}

function SegToggle({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(o => {
        const active = value === o.value
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            style={{
              flex: 1, minHeight: 44, padding: '8px 10px', borderRadius: 8,
              fontSize: 12, fontWeight: active ? 600 : 400,
              background: active ? 'rgba(184,151,90,0.15)' : 'transparent',
              color: active ? 'var(--teal)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'var(--teal)' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}
          >{o.label}</button>
        )
      })}
    </div>
  )
}

const inputStyle = {
  width: '100%', padding: '10px 12px',
  background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 8, fontSize: 16, color: 'var(--text-primary)',
  outline: 'none', boxSizing: 'border-box',
}
const rowActionStyle = {
  padding: '7px 14px', borderRadius: 8, fontSize: 12, fontWeight: 500,
  background: 'transparent', color: 'var(--text-muted)',
  border: '1px solid var(--border)', cursor: 'pointer',
}
function focusBorder(e) { e.currentTarget.style.borderColor = 'rgba(184,151,90,0.5)' }
function blurBorder(e) { e.currentTarget.style.borderColor = 'var(--border)' }

export default function RadarPage() {
  return (
    <Suspense fallback={<VectorLoader label="Loading Radar" />}>
      <RadarContent />
    </Suspense>
  )
}
