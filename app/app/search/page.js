'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../lib/supabase'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const CATEGORIES = ['All', 'Health', 'Education', 'Housing', 'Environment',
  'Technology', 'Budget / Appropriations', 'Employment / Labor',
  'Criminal Justice', 'Transportation', 'Agriculture', 'Business / Commerce']

const STAGES = [
  { label: 'All Stages', value: 0 },
  { label: 'Introduced', value: 1 },
  { label: 'Committee', value: 2 },
  { label: 'Floor', value: 3 },
  { label: 'Opp. Chamber', value: 4 },
  { label: 'Signed', value: 6 },
]

const PAGE_SIZE = 50

export default function SearchPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [chamber, setChamber] = useState('All')
  const [stage, setStage] = useState(0)
  const [sortBy, setSortBy] = useState('score')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(true)

  async function fetchBills(reset = false) {
    setLoading(true)
    const currentPage = reset ? 0 : page

    let q = supabase
      .from('bills')
      .select('bill_id,bill_number,title,final_score,stage,chamber,category,committee_name,has_public_hearing,committee_passed')
      .eq('session', '2025-2026')
      .range(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE - 1)

    if (category !== 'All') q = q.eq('category', category)
    if (chamber !== 'All') q = q.eq('chamber', chamber)
    if (stage > 0) q = q.eq('stage', stage)
    if (query.trim()) q = q.or(`title.ilike.%${query}%,bill_number.ilike.%${query}%`)
    if (sortBy === 'score') q = q.order('final_score', { ascending: false })
    else if (sortBy === 'number') q = q.order('bill_number_seq', { ascending: true })
    else q = q.order('last_action_date', { ascending: false, nullsFirst: false })

    const { data } = await q
    if (reset) setBills(data || [])
    else setBills(prev => [...prev, ...(data || [])])
    setHasMore((data || []).length === PAGE_SIZE)
    setLoading(false)
  }

  useEffect(() => {
    setPage(0)
    fetchBills(true)
  }, [query, category, chamber, stage, sortBy])

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={{
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        padding: '52px 16px 12px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
          color: 'var(--green-dark)', marginBottom: 12,
        }}>Browse Bills</div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <input
            type="text" value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search title or bill number..."
            style={{
              width: '100%', padding: '10px 14px 10px 36px',
              background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', fontSize: 14,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
          <span style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)', fontSize: 14, color: 'var(--text-faint)',
          }}>🔍</span>
        </div>

        <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
          <select value={chamber} onChange={e => setChamber(e.target.value)} style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg)', fontSize: 12, color: 'var(--text-mid)', flexShrink: 0,
          }}>
            <option>All</option>
            <option>House</option>
            <option>Senate</option>
          </select>
          <select value={stage} onChange={e => setStage(Number(e.target.value))} style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg)', fontSize: 12, color: 'var(--text-mid)', flexShrink: 0,
          }}>
            {STAGES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{
            padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg)', fontSize: 12, color: 'var(--text-mid)', flexShrink: 0,
          }}>
            <option value="score">Top Score</option>
            <option value="number">Bill #</option>
            <option value="action">Recent</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 4 }}>
          {CATEGORIES.map(c => (
            <button key={c} onClick={() => setCategory(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, flexShrink: 0,
              background: category === c ? 'var(--green-dark)' : 'var(--bg)',
              color: category === c ? 'white' : 'var(--text-muted)',
              border: `1px solid ${category === c ? 'var(--green-dark)' : 'var(--border)'}`,
              cursor: 'pointer', fontWeight: category === c ? 600 : 400,
            }}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bills.map(bill => (
          <div key={bill.bill_id}
            onClick={() => router.push(`/bill/${bill.bill_id}`)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '12px 14px',
              display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
            }}>
            <ScoreBadge score={bill.final_score} size="sm"/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 11, fontFamily: 'var(--font-mono)',
                color: 'var(--text-muted)', marginBottom: 1,
              }}>
                {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                {bill.category && bill.category !== 'Other' && (
                  <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>· {bill.category}</span>
                )}
              </div>
              <div style={{
                fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>{bill.title || bill.committee_name || `Bill ${bill.bill_number}`}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 3 }}>
                {bill.has_public_hearing && (
                  <span style={{ fontSize: 9, color: 'var(--green-mid)', fontFamily: 'var(--font-mono)' }}>● Hearing</span>
                )}
                {bill.committee_passed && (
                  <span style={{ fontSize: 9, color: 'var(--green-dark)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>✓ Comm. Pass</span>
                )}
              </div>
            </div>
            <span style={{ color: 'var(--text-faint)', fontSize: 16 }}>›</span>
          </div>
        ))}

        {loading && (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        )}

        {!loading && hasMore && bills.length > 0 && (
          <button onClick={() => { setPage(p => p + 1); fetchBills() }} style={{
            padding: '12px', background: 'var(--bg-card)',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            fontSize: 13, color: 'var(--green-mid)', fontWeight: 500, cursor: 'pointer',
          }}>Load more</button>
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
