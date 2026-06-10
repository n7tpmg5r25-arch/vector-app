'use client'
import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { watchlistStore } from '../../lib/watchlist-store'
import { useSession } from '../../lib/useSession'
import { useViewer } from '../../lib/viewer-capabilities'
import { isInterimPeriod } from '../../lib/session-config'
import { useDebouncedValue } from '../../lib/use-debounced-value'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import ScoreBadge from '../components/ScoreBadge'
import CohortCitation from '../components/CohortCitation'
import DropdownMenu from '../components/DropdownMenu'
import VectorLoader from '../components/VectorLoader'
import { Check } from 'lucide-react'

import { CATEGORIES } from '../../lib/categories'

const STAGES = [
  { label: 'All Stages', value: 0 },
  { label: 'Introduced', value: 1 },
  { label: 'Committee', value: 2 },
  { label: 'Floor', value: 3 },
  { label: 'Opp. Chamber', value: 4 },
  { label: 'Signed', value: 6 },
]

/** Highlight matched keyword in text. Returns React elements with <mark> wrapping. */
function highlightMatch(text, term) {
  if (!text || !term || term.length < 3) return text
  const idx = text.toLowerCase().indexOf(term.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: 'rgba(184,151,90,0.25)', color: 'var(--text-primary)', borderRadius: 2, padding: '0 1px' }}>
        {text.slice(idx, idx + term.length)}
      </mark>
      {text.slice(idx + term.length)}
    </>
  )
}

/** Get a snippet from ai_summary around the matched keyword. */
function getSummarySnippet(summary, term) {
  if (!summary || !term || term.length < 3) return null
  const idx = summary.toLowerCase().indexOf(term.toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - 60)
  const end = Math.min(summary.length, idx + term.length + 60)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < summary.length ? '...' : ''
  const snippet = summary.slice(start, end)
  return { snippet: prefix + snippet + suffix, matchStart: idx - start + prefix.length, matchLen: term.length }
}

function SearchContent() {
  const searchParams = useSearchParams()
  const supabase = createBrowserClient()
  const [SESSION] = useSession()
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  // Filter state
  // BUG FIX: initialize loading=true to prevent empty-state flash on mount
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebouncedValue(query, 250)
  const [category, setCategory] = useState(searchParams?.get('category') || 'All')
  const [chamber, setChamber] = useState('All')
  const [stage, setStage] = useState(0)
  const [sortBy, setSortBy] = useState('score')
  const [outcome, setOutcome] = useState('All')
  // BUG FIX: hearingOnly renamed from T144 — now labelled "Had Hearing" (historical flag, not future)
  const [hearingOnly, setHearingOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const PAGE_SIZE = 50

  // BUG FIX: use a ref to avoid stale page closure in fetchBills during Load More.
  // Without this, Load More calls fetchBills with the old page value (0) because
  // setPage is async — so it always re-fetches page 0 and appends duplicates.
  const pageRef = useRef(0)
  pageRef.current = page

  // Reduced motion preference
  const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Bulk watch state (auth-gated)
  const [watchedIds, setWatchedIds] = useState(new Set())
  const [showWatchAll, setShowWatchAll] = useState(false)
  const [bulkTag, setBulkTag] = useState('')
  const [bulkAdding, setBulkAdding] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)

  // Load watched bill IDs when authed
  useEffect(() => {
    if (viewerLoading) return
    if (!user) { setWatchedIds(new Set()); return }
    watchlistStore(user).ids()
      .then(({ data }) => {
        if (data) setWatchedIds(new Set(data.map(d => d.bill_id)))
      })
  }, [user?.id, viewerLoading])

  // BUG FIX: page intentionally NOT in fetchBills deps — we read pageRef.current
  // instead so the callback stays stable and Load More can call it synchronously
  // without hitting a stale closure.
  const fetchBills = useCallback(async (reset = false) => {
    setLoading(true)
    const currentPage = reset ? 0 : pageRef.current

    let q = supabase
      .from('bills')
      .select('bill_id, bill_number, title, ai_summary, custom_summary, final_score, stage, chamber, category, committee_name, has_public_hearing, committee_passed, status, confidence_label, prime_sponsor, prime_party, bipartisan')
      .eq('session', SESSION)
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1)

    if (category !== 'All') q = q.eq('category', category)
    if (chamber !== 'All') q = q.eq('chamber', chamber)
    if (stage > 0) q = q.eq('stage', stage)
    if (outcome !== 'All') q = q.eq('confidence_label', outcome)
    if (hearingOnly) q = q.eq('has_public_hearing', true)
    if (debouncedQuery.trim()) {
      q = q.or(`title.ilike.%${debouncedQuery}%,bill_number.ilike.%${debouncedQuery}%,ai_summary.ilike.%${debouncedQuery}%,custom_summary.ilike.%${debouncedQuery}%`)
    }

    if (sortBy === 'score') {
      q = q.order('final_score', { ascending: false })
    } else if (sortBy === 'number') {
      q = q.order('bill_number_seq', { ascending: true })
    } else if (sortBy === 'action') {
      q = q.order('last_action_date', { ascending: false, nullsFirst: false })
    } else if (sortBy === 'movers') {
      // BUG FIX: always apply the 7-day clamp regardless of isInterimPeriod().
      // Previously the clamp was skipped during interim, making "This Week" identical
      // to "Recent". Now if nothing moved in 7 days, we correctly return 0 results
      // and show an honest empty state instead of silently showing stale data.
      const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]
      q = q
        .gte('last_action_date', sevenDaysAgo)
        .order('last_action_date', { ascending: false, nullsFirst: false })
        .order('final_score', { ascending: false, nullsFirst: false })
    }

    const { data, error } = await q

    if (!error) {
      if (reset) setBills(data || [])
      else setBills(prev => [...prev, ...(data || [])])
      setHasMore((data || []).length === PAGE_SIZE)
    }

    setLoading(false)
  }, [debouncedQuery, category, chamber, stage, sortBy, outcome, hearingOnly])
  // Note: SESSION intentionally omitted — it never changes within a page session.
  // page intentionally omitted — read via pageRef.current.

  // Reset + refetch whenever any filter changes
  useEffect(() => {
    setPage(0)
    pageRef.current = 0
    fetchBills(true)
  }, [fetchBills])

  // Bulk watch all displayed bills
  async function bulkWatchAll() {
    if (!user || bills.length === 0) return
    setBulkAdding(true)
    setBulkResult(null)
    const newBills = bills.filter(b => !watchedIds.has(b.bill_id))
    if (newBills.length === 0) {
      setBulkResult({ added: 0, skipped: bills.length })
      setBulkAdding(false)
      return
    }
    const { error } = await watchlistStore(user).addMany(newBills.map(b => b.bill_id), { tag: bulkTag.trim() || null, notes: '' })
    if (!error) {
      const newIds = new Set(watchedIds)
      newBills.forEach(b => newIds.add(b.bill_id))
      setWatchedIds(newIds)
      setBulkResult({ added: newBills.length, skipped: bills.length - newBills.length })
    } else {
      setBulkResult({ error: 'Failed to add bills. Try again.' })
    }
    setBulkAdding(false)
    setShowWatchAll(false)
    setBulkTag('')
    setTimeout(() => setBulkResult(null), 4000)
  }

  // Toggle single bill watch inline
  async function handleToggleWatch(bill) {
    if (!user) return
    const billId = bill.bill_id
    if (watchedIds.has(billId)) {
      await watchlistStore(user).remove(billId)
      setWatchedIds(prev => { const n = new Set(prev); n.delete(billId); return n })
    } else {
      await watchlistStore(user).add(billId)
      setWatchedIds(prev => new Set([...prev, billId]))
    }
  }

  // Build active filter labels for the results summary bar
  const activeFilters = []
  if (chamber !== 'All') activeFilters.push(chamber)
  if (stage > 0) { const s = STAGES.find(s => s.value === stage); if (s) activeFilters.push(s.label) }
  if (category !== 'All') activeFilters.push(category)
  if (outcome !== 'All' && isInterimPeriod()) {
    const o = { LAW: 'Signed into Law', PASSED_CHAMBER: 'Passed Chamber', DEAD: 'Dead' }[outcome]
    if (o) activeFilters.push(o)
  }
  if (debouncedQuery.trim()) activeFilters.push(`"${debouncedQuery.trim()}"`)
  if (sortBy === 'movers') activeFilters.push('This Week')
  if (hearingOnly) activeFilters.push('Had Hearing')

  // Smart empty state message per active context
  const emptyMessage = sortBy === 'movers'
    ? 'No bills had new activity in the last 7 days.'
    : hearingOnly
    ? 'No bills with a committee hearing match your current filters.'
    : debouncedQuery.trim()
    ? `No bills match "${debouncedQuery.trim()}" — try fewer words or a different filter.`
    : 'No bills match your current filters.'

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {/* Hide horizontal scrollbar on category strip — works in Webkit (iOS Safari, Chrome) */}
      <style>{`.vec-cat-strip::-webkit-scrollbar { display: none }`}</style>

      {isAnonPublic && <PublicNav />}

      {/* ── Sticky header ── */}
      <div style={{
        background: 'rgba(14,16,20,0.97)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 16px 10px' : '52px 16px 10px',
        position: 'sticky', top: isAnonPublic ? 60 : 0, zIndex: 40,
      }}>

        {/* Row 1: Title + Watch All */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
            color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)',
          }}>Bill Search</div>

          {user && bills.length > 0 && (
            <button
              onClick={() => setShowWatchAll(!showWatchAll)}
              style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                background: showWatchAll ? 'var(--teal)' : 'transparent',
                color: showWatchAll ? 'var(--bg)' : 'var(--teal)',
                border: '1px solid var(--teal)', cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Watch {bills.length}{hasMore ? '+' : ''}
            </button>
          )}
        </div>

        {/* Bulk watch panel */}
        {showWatchAll && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid rgba(184,151,90,0.25)',
            borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 10,
          }}>
            <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 8, fontWeight: 500 }}>
              Add {bills.length} displayed bill{bills.length !== 1 ? 's' : ''} to your watchlist
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text" value={bulkTag} onChange={e => setBulkTag(e.target.value)}
                placeholder="Tag (optional, e.g. Housing, Transit)"
                aria-label="Tag for bulk-watched bills (optional)"
                style={{ flex: 1, padding: '8px 12px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 16, color: 'var(--text-primary)', outline: 'none' }}
                onFocus={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.5)'}
                onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
              />
              <button onClick={bulkWatchAll} disabled={bulkAdding} style={{
                padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: 'var(--teal)', color: 'var(--bg)',
                border: 'none', cursor: bulkAdding ? 'wait' : 'pointer',
                opacity: bulkAdding ? 0.6 : 1, whiteSpace: 'nowrap',
              }}>
                {bulkAdding ? 'Adding...' : 'Add All'}
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', marginTop: 6 }}>
              Already-tracked bills will be skipped.
            </div>
          </div>
        )}

        {/* Bulk result toast */}
        {bulkResult && (
          <div style={{
            background: bulkResult.error ? 'rgba(196,71,48,0.1)' : 'rgba(184,151,90,0.1)',
            border: `1px solid ${bulkResult.error ? 'rgba(196,71,48,0.3)' : 'rgba(184,151,90,0.3)'}`,
            borderRadius: 8, padding: '8px 12px', marginBottom: 10,
            fontSize: 12, color: bulkResult.error ? 'var(--danger)' : 'var(--teal)',
          }}>
            {bulkResult.error
              ? bulkResult.error
              : `Added ${bulkResult.added} bill${bulkResult.added !== 1 ? 's' : ''} to watchlist.${bulkResult.skipped > 0 ? ` ${bulkResult.skipped} already tracked.` : ''}`}
          </div>
        )}

        {/* Row 2: Search input */}
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <svg aria-hidden="true" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by title, bill number, or keyword..."
            aria-label="Search bills by title, number, or keyword"
            style={{
              width: '100%', padding: '10px 14px 10px 36px',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', fontSize: 16,
              color: 'var(--text-primary)', outline: 'none', boxSizing: 'border-box',
            }}
            onFocus={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.5)'}
            onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
          />
        </div>

        {/* Save as Radar term — appears once a signed-in user has typed a query.
            Deep-links to /radar?new=1&q=<query>, which opens the Radar create
            form pre-filled. Turns a one-off search into a standing watch for
            brand-new bills on the same terms. (Radar is registered-tier, so the
            CTA is gated on `user`.) */}
        {user && query.trim().length >= 2 && (
          <Link
            href={`/radar?new=1&q=${encodeURIComponent(query.trim())}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginBottom: 8, padding: '7px 12px', borderRadius: 8,
              background: 'transparent', color: 'var(--teal)',
              border: '1px solid var(--teal)', textDecoration: 'none',
              fontSize: 11, fontWeight: 600, alignSelf: 'flex-start',
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9"/>
              <circle cx="12" cy="12" r="4"/>
            </svg>
            Save as Radar term
          </Link>
        )}

        {/* Row 3: Filter controls — horizontally scrollable so they never wrap */}
        <div style={{
          display: 'flex', gap: 6, alignItems: 'center',
          overflowX: 'auto', WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none', msOverflowStyle: 'none',
          paddingBottom: 2,
        }}>
          <DropdownMenu
            value={chamber}
            onChange={v => setChamber(v)}
            options={[{ value: 'All', label: 'All' }, { value: 'House', label: 'House' }, { value: 'Senate', label: 'Senate' }]}
            ariaLabel="Filter by chamber"
          />
          <DropdownMenu
            value={stage}
            onChange={v => setStage(Number(v))}
            options={STAGES.map(s => ({ value: s.value, label: s.label }))}
            ariaLabel="Filter by stage"
          />
          <DropdownMenu
            value={sortBy}
            onChange={v => setSortBy(v)}
            options={[
              { value: 'score', label: 'Top Score' },
              { value: 'number', label: 'Bill #' },
              { value: 'action', label: 'Recent' },
              { value: 'movers', label: 'This Week' },
            ]}
            ariaLabel="Sort results"
          />
          {/* BUG FIX: renamed from "Hearing Scheduled" → "Had Hearing".
              has_public_hearing is a historical flag (set during session when a hearing
              was held). The session ended March 12 — no hearings are being scheduled now.
              "Had Hearing" is accurate; "Hearing Scheduled" implies future events. */}
          <button
            onClick={() => setHearingOnly(v => !v)}
            aria-pressed={hearingOnly}
            style={{
              flexShrink: 0, height: 36, padding: '0 11px',
              borderRadius: 8, fontSize: 11, fontWeight: hearingOnly ? 600 : 400,
              background: hearingOnly ? 'rgba(184,151,90,0.15)' : 'transparent',
              color: hearingOnly ? 'var(--teal)' : 'var(--text-muted)',
              border: `1px solid ${hearingOnly ? 'var(--teal)' : 'var(--border)'}`,
              cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
            }}
          >Had Hearing</button>
        </div>

        {/* Row 4: Category strip — single horizontal-scroll line, no wrap.
            Right-edge fade + chevron signal scrollability (iOS affordance pattern). */}
        <div style={{ position: 'relative', marginTop: 8 }}>
          <div
            className="vec-cat-strip"
            style={{
              display: 'flex', gap: 6,
              overflowX: 'auto', WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'none', msOverflowStyle: 'none',
              padding: '2px 40px 2px 0',
            }}
          >
            {CATEGORIES.map(c => (
              <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c} style={{
                flexShrink: 0,
                padding: '6px 12px', borderRadius: 16, fontSize: 11,
                background: category === c ? 'var(--teal)' : 'transparent',
                color: category === c ? 'var(--bg)' : 'var(--text-muted)',
                border: `1px solid ${category === c ? 'var(--teal)' : 'var(--border)'}`,
                cursor: 'pointer', fontWeight: category === c ? 600 : 400,
                boxShadow: category === c ? 'var(--teal-glow)' : 'none',
                transition: 'all 0.15s', whiteSpace: 'nowrap',
              }}>{c}</button>
            ))}
          </div>
          {/* Fade + chevron — non-interactive, signals more content to the right */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', right: 0, top: 0, bottom: 0, width: 44,
              background: 'linear-gradient(to right, transparent, rgba(14,16,20,0.97) 60%)',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              paddingRight: 2,
              pointerEvents: 'none',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </div>
        </div>

        {/* Outcome chips — interim only. Useful for post-session lobbying analysis. */}
        {isInterimPeriod() && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            {[
              { label: 'All Outcomes', value: 'All' },
              { label: 'Signed into Law', value: 'LAW', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
              { label: 'Passed Chamber', value: 'PASSED_CHAMBER', color: 'var(--gold)', bg: 'var(--gold-pale)' },
              { label: 'Dead', value: 'DEAD', color: 'var(--text-faint)', bg: 'rgba(255,255,255,0.04)' },
            ].map(o => (
              <button key={o.value} onClick={() => setOutcome(o.value)} aria-pressed={outcome === o.value} style={{
                padding: '5px 10px', borderRadius: 16, fontSize: 11,
                background: outcome === o.value ? (o.bg || 'var(--teal)') : 'transparent',
                color: outcome === o.value ? (o.color || 'var(--bg)') : 'var(--text-muted)',
                border: `1px solid ${outcome === o.value ? (o.color || 'var(--teal)') : 'var(--border)'}`,
                cursor: 'pointer', fontWeight: outcome === o.value ? 600 : 400,
              }}>{o.label}</button>
            ))}
          </div>
        )}
      </div>

      {/* ── Results ── */}
      <div style={{
        padding: '10px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
        opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s ease',
      }}>

        {/* Results summary bar */}
        {!loading && bills.length > 0 && (
          <div style={{
            fontSize: 11, color: 'var(--text-faint)',
            padding: '2px 2px 6px',
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6,
            borderBottom: '1px solid var(--border)', marginBottom: 2,
          }}>
            <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>
              {bills.length}{hasMore ? '+' : ''} bill{bills.length === 1 ? '' : 's'}
            </span>
            {activeFilters.length > 0 ? (
              <>
                <span aria-hidden="true">·</span>
                {activeFilters.map((f, i) => (
                  <span key={i} style={{
                    padding: '1px 7px', borderRadius: 10, fontSize: 10,
                    background: 'rgba(184,151,90,0.08)', color: 'var(--text-muted)',
                    border: '1px solid var(--border)',
                  }}>{f}</span>
                ))}
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <span style={{ fontStyle: 'italic' }}>top score · all categories</span>
              </>
            )}
          </div>
        )}

        {/* Bill cards */}
        {bills.map((bill, idx) => {
          const isWatched = watchedIds.has(bill.bill_id)
          return (
            <Link
              key={bill.bill_id}
              href={`/bill/${bill.bill_id}`}
              prefetch={false}
              style={{
                background: 'var(--bg-card)',
                border: `1px solid ${isWatched ? 'rgba(184,151,90,0.25)' : 'var(--border)'}`,
                borderRadius: 'var(--radius)', padding: '11px 12px',
                display: 'flex', alignItems: 'flex-start', gap: 10,
                cursor: 'pointer', transition: 'border-color 0.2s',
                animation: reducedMotion ? 'none' : `fadeUp 0.25s ease ${Math.min(idx * 0.02, 0.4)}s both`,
                textDecoration: 'none', color: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.35)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = isWatched ? 'rgba(184,151,90,0.25)' : 'var(--border)'}
            >
              {/* Score badge — pinned to top */}
              <div style={{ flexShrink: 0, paddingTop: 1 }}>
                <ScoreBadge score={bill.final_score} size="sm" status={bill.confidence_label}/>
              </div>

              {/* Main content */}
              <div style={{ flex: 1, minWidth: 0 }}>

                {/* Bill number + status chips */}
                <div style={{
                  fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)',
                  marginBottom: 2, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4,
                }}>
                  <span>{bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}</span>
                  {isWatched && (
                    <span style={{ fontSize: 9, color: 'var(--teal)', fontWeight: 600, background: 'rgba(184,151,90,0.15)', border: '1px solid rgba(184,151,90,0.3)', borderRadius: 8, padding: '1px 5px' }}>WATCHING</span>
                  )}
                  {bill.category && (
                    <span style={{ color: 'var(--text-faint)' }}>
                      · {bill.category === 'Other' && bill.committee_name
                        ? `Other — ${bill.committee_name.replace(/ \d+ Review$/, '').replace(/^Rules$/, 'General')}`
                        : bill.category}
                    </span>
                  )}
                  {isInterimPeriod() && bill.confidence_label === 'LAW' && (
                    <span style={{ fontSize: 9, padding: '1px 6px', background: 'var(--teal-pale)', color: 'var(--teal)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 10, fontWeight: 500 }}>Signed</span>
                  )}
                  {isInterimPeriod() && bill.confidence_label === 'PASSED_CHAMBER' && (
                    <span style={{ fontSize: 9, padding: '1px 6px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(212,180,122,0.25)', borderRadius: 10, fontWeight: 500 }}>Passed</span>
                  )}
                  {isInterimPeriod() && bill.confidence_label === 'DEAD' && (
                    <span style={{ fontSize: 9, padding: '1px 6px', background: 'rgba(255,255,255,0.04)', color: 'var(--text-faint)', border: '1px solid var(--border)', borderRadius: 10 }}>Dead</span>
                  )}
                </div>

                {/* Bill title — 2-line clamp */}
                <div style={{
                  fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                  overflow: 'hidden', lineHeight: 1.35, marginBottom: 3,
                }}>
                  {query.trim().length >= 3
                    ? highlightMatch(bill.title || bill.committee_name || `Bill ${bill.bill_number}`, query.trim())
                    : (bill.title || bill.committee_name || `Bill ${bill.bill_number}`)
                  }
                </div>

                {/* Sponsor + committee — always shown if available */}
                {(bill.prime_sponsor || bill.committee_name) && (
                  <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                    {bill.prime_sponsor && (
                      <span style={{ color: bill.prime_party === 'D' ? 'var(--party-d)' : bill.prime_party === 'R' ? 'var(--party-r)' : 'var(--text-muted)' }}>
                        {bill.prime_sponsor}
                      </span>
                    )}
                    {bill.prime_sponsor && bill.committee_name && <span> · </span>}
                    {bill.committee_name && (
                      <span>{bill.committee_name.replace(/ \d+ Review$/, '').replace(/^Rules$/, 'General')}</span>
                    )}
                  </div>
                )}

                {/* Summary snippet when keyword found in AI summary */}
                {(() => {
                  const snip = query.trim().length >= 3 ? getSummarySnippet(bill.custom_summary || bill.ai_summary, query.trim()) : null
                  if (!snip) return null
                  const { snippet, matchStart, matchLen } = snip
                  return (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                      {snippet.slice(0, matchStart)}
                      <mark style={{ background: 'rgba(184,151,90,0.25)', color: 'var(--text-primary)', borderRadius: 2, padding: '0 1px' }}>
                        {snippet.slice(matchStart, matchStart + matchLen)}
                      </mark>
                      {snippet.slice(matchStart + matchLen)}
                    </div>
                  )
                })()}

                {/* Status badges row */}
                {(bill.has_public_hearing || bill.committee_passed || bill.bipartisan === false) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 1 }}>
                    {bill.has_public_hearing && (
                      // BUG FIX: replaced var(--teal-mid) which is not defined in globals.css
                      <span style={{ fontSize: 9, color: 'rgba(184,151,90,0.75)', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' }}>HAD HEARING</span>
                    )}
                    {bill.committee_passed && (
                      <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <Check size={9} aria-hidden="true" strokeWidth={3} /> COMM. PASS
                      </span>
                    )}
                    {bill.bipartisan === false && (
                      <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', fontStyle: 'italic' }}>Minority Only</span>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons: bookmark + external link */}
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {user && (
                  <button
                    type="button"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); handleToggleWatch(bill) }}
                    style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: isWatched ? 'var(--teal)' : 'var(--text-faint)', opacity: isWatched ? 1 : 0.45, transition: 'all 0.2s', background: 'none', border: 'none', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                    onMouseLeave={e => { if (!isWatched) e.currentTarget.style.opacity = '0.45' }}
                    title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                    aria-label={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                    aria-pressed={isWatched}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill={isWatched ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                    </svg>
                  </button>
                )}
                <button
                  type="button"
                  onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(`https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${SESSION.split('-')[0]}`, '_blank', 'noopener,noreferrer') }}
                  style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', opacity: 0.4, transition: 'opacity 0.2s', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '0.4'}
                  title="View on leg.wa.gov"
                  aria-label="View on leg.wa.gov"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                  </svg>
                </button>
              </div>
            </Link>
          )
        })}

        {loading && <VectorLoader label="Searching bills" size="sm" />}

        {/* BUG FIX: Load More now correctly updates pageRef before calling fetchBills,
            so the stale closure reads the new page value instead of always fetching page 0. */}
        {!loading && hasMore && bills.length > 0 && (
          <button
            onClick={() => {
              pageRef.current = page + 1
              setPage(page + 1)
              fetchBills(false)
            }}
            style={{
              padding: '12px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              fontSize: 13, color: 'var(--teal)', fontWeight: 500,
              cursor: 'pointer', marginTop: 4, transition: 'border-color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >Load more</button>
        )}

        {/* BUG FIX: context-aware empty states instead of the generic
            "Start typing to search" message that appeared even when the page
            loads bills by default. */}
        {!loading && bills.length === 0 && (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-mid)', fontSize: 13, lineHeight: 1.6 }}>
            {emptyMessage}
          </div>
        )}

        {/* Calibration footnote — kept per methodology transparency requirement */}
        {!loading && bills.length > 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-faint)', padding: '8px 2px 0', lineHeight: 1.5 }}>
            <CohortCitation variant="calibration" />
          </div>
        )}
      </div>

      {!viewerLoading && !isAnonPublic && <Nav/>}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<VectorLoader label="Loading search" />}>
      <SearchContent />
    </Suspense>
  )
}
