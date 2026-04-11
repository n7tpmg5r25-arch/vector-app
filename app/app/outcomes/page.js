'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, isInterimPeriod, getNextBiennium, formatSessionDate } from '../../lib/session-config'
import { useSession } from '../../lib/useSession'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const CATEGORIES = [
  'All', 'Health', 'Education', 'Criminal Justice', 'Housing', 'Transportation',
  'Business / Commerce', 'Environment', 'Employment / Labor', 'Budget / Appropriations',
  'Technology', 'Government Operations', 'Natural Resources', 'Agriculture', 'Veterans / Military',
]
const CHAMBERS = ['All', 'House', 'Senate']
const OUTCOMES = ['All', 'LAW', 'CARRY OVER', 'DEAD']
const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp. Ch.', 'Conf.', 'Gov.']

export default function OutcomesPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [SESSION] = useSession()
  const isInterim = useMemo(() => isInterimPeriod(), [])

  const [bills, setBills] = useState([])
  const [loading, setLoading] = useState(true)
  const [outcome, setOutcome] = useState('All')
  const [category, setCategory] = useState('All')
  const [chamber, setChamber] = useState('All')
  const [sortBy, setSortBy] = useState('score') // score | bill_number | category
  const [sortDir, setSortDir] = useState('desc')

  useEffect(() => {
    async function load() {
      // Paginate to get all bills
      let all = []
      let page = 0
      const PAGE_SIZE = 1000
      while (true) {
        const { data, error } = await supabase
          .from('bills')
          .select('bill_id, bill_number, title, final_score, stage, chamber, category, prime_sponsor, prime_party, confidence_label, stalled, signal_tier')
          .eq('session', SESSION)
          .not('final_score', 'is', null)
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
        if (error || !data || data.length === 0) break
        all = all.concat(data)
        if (data.length < PAGE_SIZE) break
        page++
      }
      setBills(all)
      setLoading(false)
    }
    load()
  }, [SESSION])

  // Filter
  const filtered = bills.filter(b => {
    if (outcome !== 'All' && b.confidence_label !== outcome) return false
    if (category !== 'All' && b.category !== category) return false
    if (chamber !== 'All' && b.chamber !== chamber) return false
    return true
  })

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    let cmp = 0
    if (sortBy === 'score') cmp = (a.final_score || 0) - (b.final_score || 0)
    else if (sortBy === 'bill_number') cmp = (a.bill_number || 0) - (b.bill_number || 0)
    else if (sortBy === 'category') cmp = (a.category || '').localeCompare(b.category || '')
    return sortDir === 'desc' ? -cmp : cmp
  })

  // Counts
  const lawCount = bills.filter(b => b.confidence_label === 'LAW').length
  const carryCount = bills.filter(b => b.confidence_label === 'CARRY OVER').length
  const deadCount = bills.filter(b => b.confidence_label === 'DEAD').length

  function toggleSort(field) {
    if (sortBy === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(field); setSortDir('desc') }
  }

  const outcomeColor = (label) =>
    label === 'LAW' ? 'var(--teal)' : label === 'CARRY OVER' ? 'var(--gold)' : 'var(--text-faint)'

  const outcomeBadgeStyle = (label) => ({
    fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 600,
    padding: '2px 8px', borderRadius: 10,
    color: outcomeColor(label),
    background: label === 'LAW' ? 'rgba(184,151,90,0.1)' : label === 'CARRY OVER' ? 'rgba(184,151,90,0.08)' : 'rgba(255,255,255,0.04)',
    border: `1px solid ${label === 'LAW' ? 'rgba(184,151,90,0.25)' : label === 'CARRY OVER' ? 'rgba(184,151,90,0.2)' : 'var(--border)'}`,
  })

  // Chip style helper
  const chip = (active) => ({
    padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
    background: active ? 'var(--bg-surface)' : 'transparent',
    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
    border: `1px solid ${active ? 'var(--border-light)' : 'var(--border)'}`,
    cursor: 'pointer', transition: 'all 0.15s',
  })

  return (
    <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>

      {/* ── HEADER ──────────────────────────────── */}
      <div style={{
        background: 'rgba(14,16,20,0.95)', backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', marginBottom: 4, textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>
          Session Outcomes
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          {SESSION} Biennium · {bills.length} bills scored
        </div>

        {!isInterim && (
          <div style={{
            background: 'var(--gold-pale)', border: '1px solid rgba(184,151,90,0.25)',
            borderRadius: 8, padding: '10px 12px', marginBottom: 12,
            fontSize: 11, color: 'var(--gold)', fontWeight: 500,
          }}>
            Session is still active. Final outcomes will appear after sine die.
          </div>
        )}

        {/* Stat cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
          {[
            { label: 'Signed', value: lawCount, color: 'var(--teal)', filterVal: 'LAW' },
            { label: 'Passed Chamber', value: carryCount, color: 'var(--gold)', filterVal: 'CARRY OVER', tooltip: 'Passed at least one chamber but did not become law this session' },
            { label: 'Dead', value: deadCount, color: 'var(--text-muted)', filterVal: 'DEAD' },
          ].map(({ label, value, color, filterVal, tooltip }) => (
            <button key={label} onClick={() => setOutcome(outcome === filterVal ? 'All' : filterVal)} title={tooltip || ''} style={{
              background: outcome === filterVal ? 'var(--bg-surface)' : 'var(--bg-card)',
              border: `1px solid ${outcome === filterVal ? color : 'var(--border)'}`,
              borderRadius: 'var(--radius)', padding: '10px 8px', textAlign: 'center', cursor: 'pointer',
              transition: 'all 0.15s',
            }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
            </button>
          ))}
        </div>

        {/* Filters */}
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 6 }}>
          {CHAMBERS.map(c => (
            <button key={c} onClick={() => setChamber(c)} style={chip(chamber === c)}>{c}</button>
          ))}
          <span style={{ width: 1, background: 'var(--border)', flexShrink: 0 }}/>
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            style={{
              padding: '5px 8px', borderRadius: 16, fontSize: 11,
              background: category !== 'All' ? 'var(--bg-surface)' : 'transparent',
              color: category !== 'All' ? 'var(--text-primary)' : 'var(--text-muted)',
              border: `1px solid ${category !== 'All' ? 'var(--border-light)' : 'var(--border)'}`,
              cursor: 'pointer', appearance: 'none', paddingRight: 20,
              backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'10\' height=\'6\' viewBox=\'0 0 10 6\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l4 4 4-4\' stroke=\'%23666\' stroke-width=\'1.5\' fill=\'none\'/%3E%3C/svg%3E")',
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center',
            }}
          >
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {/* Sort controls */}
        <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: 'var(--text-faint)' }}>
          <span>Sort:</span>
          {[
            { key: 'score', label: 'Score' },
            { key: 'bill_number', label: 'Bill #' },
            { key: 'category', label: 'Category' },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => toggleSort(key)} style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: 10,
              color: sortBy === key ? 'var(--teal)' : 'var(--text-faint)',
              fontWeight: sortBy === key ? 600 : 400,
            }}>
              {label} {sortBy === key ? (sortDir === 'desc' ? '↓' : '↑') : ''}
            </button>
          ))}
        </div>
      </div>

      {/* ── RESULTS ──────────────────────────────── */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', marginBottom: 4 }}>
          {filtered.length} bills{outcome !== 'All' ? ` · ${outcome}` : ''}{category !== 'All' ? ` · ${category}` : ''}
        </div>

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : sorted.slice(0, 100).map((bill, idx) => (
          <div
            key={bill.bill_id}
            onClick={() => router.push(`/bill/${bill.bill_id}`)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '10px 12px',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
              transition: 'border-color 0.2s',
              animation: idx < 20 ? `fadeUp 0.3s ease ${idx * 0.02}s both` : 'none',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <ScoreBadge score={bill.final_score} size="sm" status={bill.confidence_label}/>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                </span>
                <span style={outcomeBadgeStyle(bill.confidence_label)}>
                  {bill.confidence_label === 'LAW' ? 'Signed' : bill.confidence_label === 'CARRY OVER' ? 'Passed Chamber' : 'Dead'}
                </span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {bill.title || `Bill ${bill.bill_number}`}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 3, fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                <span>{bill.category || 'Other'}</span>
                <span>·</span>
                <span>{bill.prime_sponsor || 'Unknown'}{bill.prime_party ? ` (${bill.prime_party.charAt(0)})` : ''}</span>
                <span>·</span>
                <span>{STAGE_SHORT[bill.stage] || 'Intro'}</span>
              </div>
            </div>
          </div>
        ))}
        {sorted.length > 100 && (
          <div style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-faint)', padding: '12px 0' }}>
            Showing first 100 of {sorted.length} bills. Use filters to narrow results.
          </div>
        )}
      </div>

      <Nav/>
    </div>
  )
}
