'use client'
import { Suspense, useEffect, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession } from '../../lib/session-config'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const SESSION = typeof window !== 'undefined' ? getCurrentSession() : '2025-2026'

const CATEGORIES = ['All', 'Health', 'Education', 'Criminal Justice', 'Environment',
  'Government Operations', 'Business / Commerce', 'Budget / Appropriations',
  'Transportation', 'Employment / Labor', 'Housing', 'Technology',
  'Veterans / Military', 'Agriculture', 'Natural Resources']

const STAGES = [
  { label: 'All Stages', value: 0 },
  { label: 'Introduced', value: 1 },
  { label: 'Committee', value: 2 },
  { label: 'Floor', value: 3 },
  { label: 'Opp. Chamber', value: 4 },
  { label: 'Signed', value: 6 },
]

function SearchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createBrowserClient()
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(searchParams?.get('category') || 'All')
  const [chamber, setChamber] = useState('All')
  const [stage, setStage] = useState(0)
  const [sortBy, setSortBy] = useState('score')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const PAGE_SIZE = 50

  const fetchBills = useCallback(async (reset = false) => {
    setLoading(true)
    const currentPage = reset ? 0 : page

    let q = supabase
      .from('bills')
      .select('bill_id, bill_number, title, final_score, stage, chamber, category, committee_name, has_public_hearing, committee_passed, status')
      .eq('session', SESSION)
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1)

    if (category !== 'All') q = q.eq('category', category)
    if (chamber !== 'All') q = q.eq('chamber', chamber)
    if (stage > 0) q = q.eq('stage', stage)
    if (query.trim()) {
      q = q.or(`title.ilike.%${query}%,bill_number.ilike.%${query}%`)
    }

    if (sortBy === 'score') q = q.order('final_score', { ascending: false })
    else if (sortBy === 'number') q = q.order('bill_number_seq', { ascending: true })
    else if (sortBy === 'action') q = q.order('last_action_date', { ascending: false, nullsFirst: false })

    const { data, error } = await q

    if (!error) {
      if (reset) setBills(data || [])
      else setBills(prev => [...prev, ...(data || [])])
      setHasMore((data || []).length === PAGE_SIZE)
    }

    setLoading(false)
  }, [query, category, chamber, stage, sortBy, page])

  useEffect(() => {
    setPage(0)
    fetchBills(true)
  }, [query, category, chamber, stage, sortBy])

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{
        background: 'rgba(8,12,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 12px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22, fontWeight: 700,
          color: 'var(--teal)', marginBottom: 12,
          textShadow: '0 0 16px rgba(0,229,204,0.2)',
        }}>Browse Bills</div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <svg style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by title or bill number..."
            style={{
              width: '100%', padding: '10px 14px 10px 36px',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', fontSize: 14,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          <select value={chamber} onChange={e => setChamber(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 12, color: 'var(--text-mid)', flexShrink: 0 }}>
            <option>All</option><option>House</option><option>Senate</option>
          </select>
          <select value={stage} onChange={e => setStage(Number(e.target.value))}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 12, color: 'var(--text-mid)', flexShrink: 0 }}>
            {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', fontSize: 12, color: 'var(--text-mid)', flexShrink: 0 }}>
            <option value="score">Top Score</option>
            <option value="number">Bill #</option>
            <option value="action">Recent</option>
          </select>
        </div>

        {/* Category chips */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, flexShrink: 0,
              background: category === c ? 'var(--teal)' : 'transparent',
              color: category === c ? 'var(--bg)' : 'var(--text-muted)',
              border: `1px solid ${category === c ? 'var(--teal)' : 'var(--border)'}`,
              cursor: 'pointer', fontWeight: category === c ? 600 : 400,
              boxShadow: category === c ? 'var(--teal-glow)' : 'none',
            }}>{c}</button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bills.map((bill, idx) => (
          <div
            key={bill.bill_id}
            onClick={() => router.push(`/bill/${bill.bill_id}`)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', transition: 'border-color 0.2s',
              animation: `fadeUp 0.25s ease ${Math.min(idx * 0.02, 0.5)}s both`,
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <ScoreBadge score={bill.final_score} size="sm"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 1 }}>
                {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                {bill.category && (
                  <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>&#183; {bill.category === 'Other' && bill.committee_name ? `Other — ${bill.committee_name.replace(/ \d+ Review$/, '').replace(/^Rules$/, 'General')}` : bill.category}</span>
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                {bill.has_public_hearing && (
                  <span style={{ fontSize: 9, color: 'var(--teal-mid)', fontFamily: 'var(--font-mono)' }}>&#9679; Hearing</span>
                )}
                {bill.committee_passed && (
                  <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>&#10003; Comm. Pass</span>
                )}
              </div>
            </div>
            <a
              href={`https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${SESSION.split('-')[0]}`}
              target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              style={{ flexShrink: 0, padding: 4, color: 'var(--text-faint)', opacity: 0.5, transition: 'opacity 0.2s' }}
              onMouseEnter={e => e.currentTarget.style.opacity = '1'}
              onMouseLeave={e => e.currentTarget.style.opacity = '0.5'}
              title="View on leg.wa.gov"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
        ))}

        {loading && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        )}

        {!loading && hasMore && bills.length > 0 && (
          <button
            onClick={() => { setPage(p => p + 1); fetchBills() }}
            style={{
              padding: '12px', background: 'var(--bg-card)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              fontSize: 13, color: 'var(--teal)', fontWeight: 500,
              cursor: 'pointer', marginTop: 4,
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >Load more</button>
        )}

        {!loading && bills.length === 0 && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
            No bills found. Try adjusting your filters.
          </div>
        )}
      </div>

      <Nav/>
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading search...</div>}>
      <SearchContent />
    </Suspense>
  )
}
