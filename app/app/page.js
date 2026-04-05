'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../lib/supabase'
import Nav from './components/Nav'
import ScoreBadge from './components/ScoreBadge'

// Key dates for 2027 session
const NEXT_PREFILING = '2026-12-01'
const NEXT_SESSION   = '2027-01-13'

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date()
  return Math.max(0, Math.ceil(diff / 86400000))
}

function outlookLabel(avg) {
  if (avg >= 55) return { text: 'Very Strong', color: 'var(--teal-bright)', glow: 'var(--teal-glow)' }
  if (avg >= 45) return { text: 'Strong Outlook', color: 'var(--teal)', glow: 'var(--teal-glow)' }
  if (avg >= 35) return { text: 'Building Momentum', color: 'var(--gold)', glow: 'var(--gold-glow)' }
  if (avg >= 25) return { text: 'Watch Closely', color: 'var(--gold)', glow: 'var(--gold-glow)' }
  return { text: 'High Risk', color: 'var(--danger)', glow: 'var(--danger-glow)' }
}

function momentumLabel(bills) {
  const rising = bills.filter(b => (b.bills?.final_score || 0) >= 45).length
  const total = bills.length
  if (total === 0) return null
  const pct = rising / total
  if (pct >= 0.6) return { text: 'VELOCITY: RISING', color: 'var(--teal)' }
  if (pct >= 0.4) return { text: 'VELOCITY: MIXED', color: 'var(--gold)' }
  return { text: 'VELOCITY: DECLINING', color: 'var(--danger)' }
}

export default function HomePage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  // Phase 5C.7: Session derived inside component to avoid SSR/CSR mismatch.
  // Switches automatically once the 2027-2028 session begins.
  const SESSION = useMemo(
    () => (new Date() >= new Date('2027-01-13') ? '2027-2028' : '2025-2026'),
    []
  )

  // Phase 6.6: Interim mode = 2025-26 session is past sine die (Mar 12, 2026)
  // but before the 2027-28 session starts (Jan 13, 2027). Flips automatically.
  const IS_INTERIM = useMemo(
    () => SESSION === '2025-2026' && new Date() > new Date('2026-03-12'),
    [SESSION]
  )

  const [user, setUser]         = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [topBills, setTopBills]  = useState([])
  const [categories, setCategories] = useState([])
  const [passedBills, setPassedBills] = useState([])           // Phase 6.6: "What Passed"
  const [diedBills, setDiedBills]     = useState([])           // Phase 6.6: "What Died"
  const [passedCatCounts, setPassedCatCounts] = useState([])   // Phase 6.6: category rollup
  const [scoreDeltas, setScoreDeltas] = useState({}) // bill_id -> delta number
  const [lastSyncAt, setLastSyncAt] = useState(null)  // Phase 5A: stale data warning
  const [loading, setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const daysToPreFiling = daysUntil(NEXT_PREFILING)
  const daysToSession   = daysUntil(NEXT_SESSION)

  async function loadData() {
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)

    const { data: bills } = await supabase
      .from('bills')
      .select('bill_id, bill_number, title, final_score, stage, chamber, category, committee_name, prime_sponsor, prime_party, has_public_hearing, committee_passed, bipartisan, stalled, pulled_from_rules, hearing_date')
      .eq('session', SESSION)
      .not('final_score', 'is', null)
      .order('final_score', { ascending: false })
      .limit(12)
    setTopBills(bills || [])

    // Phase 6.6 — Interim-mode panels: "What Passed" and "What Died".
    // Only query when IS_INTERIM is true so active-session renders are unaffected.
    if (IS_INTERIM) {
      // What Passed — bills that actually became law this session
      const { data: passed } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, chamber, category, final_score, prime_sponsor, prime_party')
        .eq('session', SESSION)
        .eq('outcome_passed_law', true)
        .order('final_score', { ascending: false })
        .limit(20)
      setPassedBills(passed || [])

      // Roll up category counts for the passed bills (for the summary row)
      const counts = {}
      ;(passed || []).forEach(b => {
        const k = b.category || 'Other'
        counts[k] = (counts[k] || 0) + 1
      })
      setPassedCatCounts(
        Object.entries(counts)
          .map(([category, count]) => ({ category, count }))
          .sort((a, b) => b.count - a.count)
      )

      // What Died — high-momentum bills that didn't make it out. Likely 2027 reintroductions.
      const { data: died } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, chamber, category, final_score, prime_sponsor, prime_party, stage')
        .eq('session', SESSION)
        .gte('final_score', 60)
        .gte('stage', 2)
        .or('outcome_passed_law.is.null,outcome_passed_law.eq.false')
        .order('final_score', { ascending: false })
        .limit(10)
      setDiedBills(died || [])
    }

    if (user) {
      const { data: wl } = await supabase
        .from('tracked_bills')
        .select(`bill_id, client_tag, added_at, bills(bill_id, bill_number, title, final_score, stage, committee_passed, has_public_hearing)`)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })
      setWatchlist(wl?.filter(w => w.bills) || [])
    }

    try {
      const { data: cats } = await supabase
        .from('interim_intelligence')
        .select('*')
        .order('avg_score', { ascending: false })
        .limit(8)
      setCategories((cats || []).filter(c => c.category && c.category !== 'Other'))
    } catch (_) {}

    // Fetch score deltas for top bills and watchlist bills
    const allBillIds = [
      ...(bills || []).map(b => b.bill_id),
      ...(wl || []).filter(w => w.bills).map(w => w.bill_id),
    ]
    const uniqueIds = [...new Set(allBillIds)].slice(0, 30)
    if (uniqueIds.length > 0) {
      const { data: snaps } = await supabase
        .from('trajectory_snapshots')
        .select('bill_id, score, snapshot_date')
        .in('bill_id', uniqueIds)
        .order('snapshot_date', { ascending: false })
      if (snaps) {
        const deltas = {}
        const byBill = {}
        snaps.forEach(s => {
          if (!byBill[s.bill_id]) byBill[s.bill_id] = []
          if (byBill[s.bill_id].length < 2) byBill[s.bill_id].push(s)
        })
        Object.entries(byBill).forEach(([bid, arr]) => {
          if (arr.length >= 2) {
            deltas[bid] = (arr[0].score || 0) - (arr[1].score || 0)
          }
        })
        setScoreDeltas(deltas)
      }
    }

    // Phase 5A: Check last sync time for stale data warning
    try {
      const { data: syncLog } = await supabase
        .from('sync_log')
        .select('ran_at')
        .order('ran_at', { ascending: false })
        .limit(1)
      if (syncLog && syncLog.length > 0) {
        setLastSyncAt(new Date(syncLog[0].ran_at))
      }
    } catch (_) {}

    setLoading(false)
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  useEffect(() => { loadData() }, [])

  const watchedScores = watchlist.map(w => w.bills?.final_score ?? 0).filter(s => s != null)
  const avgScore = watchedScores.length > 0
    ? Math.round(watchedScores.reduce((a, b) => a + b, 0) / watchedScores.length)
    : null
  const outlook = avgScore !== null ? outlookLabel(avgScore) : null
  const momentum = momentumLabel(watchlist)
  const highMomentum = watchlist.filter(w => (w.bills?.final_score || 0) >= 50).length
  const atRisk = watchlist.filter(w => (w.bills?.final_score || 0) < 25).length

  const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp. Ch.', 'Conf.', 'Gov.']
  const sessionYear = SESSION.split('-')[0]

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>

      {/* ── HEADER ────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(180deg, #0d1520 0%, var(--bg) 100%)',
        padding: '52px 20px 20px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(ellipse at 70% 20%, rgba(0,229,204,0.08) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}/>

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Logo row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="28" height="24" viewBox="0 0 56 48" fill="none">
                <path d="M4 4 L28 44 L52 4" stroke="var(--teal)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <path d="M28 44 L52 20" stroke="var(--teal-dim)" strokeWidth="4" strokeLinecap="round" fill="none"/>
                <polygon points="52,14 58,22 44,22" fill="var(--gold)"/>
              </svg>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--teal)', letterSpacing: '-0.01em', lineHeight: 1, textShadow: '0 0 20px rgba(0,229,204,0.3)' }}>
                  VECTOR <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 14 }}>| WA</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 1 }}>
                  Legislative Trajectories
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: refreshing ? 0.3 : 0.5 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transition: 'transform 0.5s', transform: refreshing ? 'rotate(360deg)' : 'none' }}>
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
              <button
                onClick={() => router.push('/settings')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.5 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Status chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(212,168,75,0.1)',
              border: '1px solid rgba(212,168,75,0.25)',
              borderRadius: 20, padding: '4px 12px',
              fontSize: 11, color: 'var(--gold)',
              fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', boxShadow: 'var(--gold-glow)' }}/>
              WA Interim Period
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(0,229,204,0.06)',
              border: '1px solid var(--border)',
              borderRadius: 20, padding: '4px 12px',
              fontSize: 11, color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              Solo Practice
            </div>
          </div>

          {/* Advocacy outlook */}
          {outlook && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>
                Advocacy Outlook
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(0,229,204,0.08)',
                  border: '1px solid rgba(0,229,204,0.25)',
                  borderRadius: 20, padding: '5px 14px',
                  fontSize: 12, color: outlook.color, fontWeight: 600,
                  boxShadow: outlook.glow,
                }}>
                  {outlook.text}
                </div>
                {momentum && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'rgba(0,229,204,0.06)',
                    border: '1px solid var(--border)',
                    borderRadius: 20, padding: '5px 12px',
                    fontSize: 10, color: momentum.color,
                    fontFamily: 'var(--font-mono)', fontWeight: 500,
                    letterSpacing: '0.06em',
                  }}>
                    ▲ {momentum.text}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── STALE DATA WARNING (Phase 5A) ────────────────── */}
        {lastSyncAt && (Date.now() - lastSyncAt.getTime()) > 36 * 60 * 60 * 1000 && (
          <div style={{
            background: 'rgba(212,168,75,0.08)',
            border: '1px solid rgba(212,168,75,0.3)',
            borderRadius: 'var(--radius)',
            padding: '10px 14px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span style={{ fontSize: 11, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
              Data may be stale — last synced {lastSyncAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at {lastSyncAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
            </span>
          </div>
        )}

        {/* ── SESSION COUNTDOWN ─────────────────────────────── */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {IS_INTERIM ? 'Prefile Watch · 2027 Session' : '2027 Session Timeline'}
            </div>
            {IS_INTERIM && (
              <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--gold)', letterSpacing: '0.06em' }}>
                INTERIM · {daysToPreFiling}d TO PREFILE
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { label: 'Today', sublabel: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }), active: true },
              { label: 'Pre-Filing', sublabel: `${daysToPreFiling}d`, active: false },
              { label: '2027 Session', sublabel: `${daysToSession}d`, active: false },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: item.active ? 10 : 8, height: item.active ? 10 : 8,
                    borderRadius: '50%',
                    background: item.active ? 'var(--teal)' : 'var(--border)',
                    boxShadow: item.active ? 'var(--teal-glow)' : 'none',
                    animation: item.active ? 'dotPulse 2s ease-in-out infinite' : 'none',
                  }}/>
                  <span style={{ fontSize: 9, color: item.active ? 'var(--teal)' : 'var(--text-faint)', fontWeight: item.active ? 600 : 400, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                  <span style={{ fontSize: 8, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', textAlign: 'center' }}>
                    {item.sublabel}
                  </span>
                </div>
                {i < 2 && <div style={{ flex: 1, height: 1, background: 'var(--border)', margin: '0 6px', marginBottom: 24 }}/>}
              </div>
            ))}
          </div>
        </div>

        {/* ── WATCHLIST SUMMARY ─────────────────────────────── */}
        {watchlist.length > 0 ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Your Watchlist
              </div>
              <button onClick={() => router.push('/watchlist')} style={{ fontSize: 11, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                View all →
              </button>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              {[
                { label: 'Tracked', value: watchlist.length, color: 'var(--teal)' },
                { label: 'High Score', value: highMomentum, color: 'var(--teal-bright)' },
                { label: 'At Risk', value: atRisk, color: atRisk > 0 ? 'var(--danger)' : 'var(--text-muted)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, lineHeight: 1, textShadow: `0 0 12px ${color === 'var(--teal)' ? 'rgba(0,229,204,0.3)' : color === 'var(--danger)' ? 'rgba(255,82,82,0.3)' : 'transparent'}` }}>
                    {value}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {/* Top 3 watchlist bills */}
            {watchlist.slice(0, 3).map(({ bill_id, client_tag, bills: bill }) => {
              const delta = scoreDeltas[bill_id]
              return (
              <div
                key={bill_id}
                onClick={() => router.push(`/bill/${bill.bill_id}`)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px',
                  marginBottom: 7, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: 12,
                  transition: 'border-color 0.2s',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ position: 'relative' }}>
                  <ScoreBadge score={bill.final_score} size="md"/>
                  {delta != null && delta !== 0 && (
                    <span style={{
                      position: 'absolute', top: -6, right: -10,
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      padding: '1px 5px', borderRadius: 8,
                      background: delta > 0 ? 'rgba(0,229,204,0.15)' : 'rgba(255,82,82,0.15)',
                      color: delta > 0 ? 'var(--teal)' : 'var(--danger)',
                      border: `1px solid ${delta > 0 ? 'rgba(0,229,204,0.3)' : 'rgba(255,82,82,0.3)'}`,
                      whiteSpace: 'nowrap',
                    }}>
                      {delta > 0 ? '+' : ''}{delta}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                    {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    {client_tag && <span style={{ marginLeft: 6, color: 'var(--gold)', fontWeight: 600 }}>· {client_tag}</span>}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    {bill.committee_passed && <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>✓ CMTE PASS</span>}
                    {bill.has_public_hearing && <span style={{ fontSize: 9, color: 'var(--teal-mid)', fontFamily: 'var(--font-mono)' }}>● HEARING</span>}
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{STAGE_SHORT[bill.stage] || 'Intro'}</span>
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            )})}
          </div>
        ) : (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '20px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 8 }}>
              No bills tracked yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
              Start tracking bills to see your advocacy outlook and portfolio stats.
            </div>
            <button
              onClick={() => router.push('/search')}
              style={{
                padding: '8px 20px',
                background: 'var(--teal)', color: 'var(--bg)',
                border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                boxShadow: 'var(--teal-glow)',
              }}
            >Browse {SESSION} Bills</button>
          </div>
        )}

        {/* ── PHASE 6.6 · WHAT PASSED (interim mode only) ───── */}
        {IS_INTERIM && passedBills.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                What Passed · {SESSION} Session
              </div>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--teal)', fontWeight: 600 }}>
                {passedBills.length >= 20 ? '20+' : passedBills.length} signed into law
              </span>
            </div>

            {/* Category rollup chips */}
            {passedCatCounts.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {passedCatCounts.slice(0, 8).map(({ category, count }) => (
                  <span key={category} style={{
                    fontSize: 10, padding: '3px 9px',
                    background: 'rgba(0,229,204,0.08)',
                    border: '1px solid rgba(0,229,204,0.25)',
                    borderRadius: 10, color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {category} <span style={{ color: 'var(--teal)', fontWeight: 600 }}>{count}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Top passed bills list (show top 5; rest hidden behind All bills) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {passedBills.slice(0, 5).map((bill, idx) => (
                <div
                  key={bill.bill_id}
                  onClick={() => router.push(`/bill/${bill.bill_id}`)}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid rgba(0,229,204,0.2)',
                    borderRadius: 'var(--radius)', padding: '12px 14px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                    transition: 'border-color 0.2s, box-shadow 0.2s',
                    animation: `fadeUp 0.3s ease ${idx * 0.04}s both`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--teal)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(0,229,204,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(0,229,204,0.2)'; e.currentTarget.style.boxShadow = 'none' }}
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0,229,204,0.12)',
                    border: '1px solid rgba(0,229,204,0.4)',
                    flexShrink: 0,
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 2 }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                      <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>· {bill.category || 'Other'}</span>
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {bill.title || `Bill ${bill.bill_number}`}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 3 }}>
                      {bill.prime_sponsor || 'Unknown'}{bill.prime_party ? ` (${bill.prime_party.charAt(0)})` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TOP TRAJECTORY BILLS ──────────────────────────── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              {IS_INTERIM ? `Final Session Scores · ${SESSION}` : `Top Trajectory · ${SESSION}`}
            </div>
            <button onClick={() => router.push('/search')} style={{ fontSize: 11, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
              All bills →
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {loading ? (
              <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
            ) : topBills.map((bill, idx) => {
              const delta = scoreDeltas[bill.bill_id]
              return (
              <div
                key={bill.bill_id}
                onClick={() => router.push(`/bill/${bill.bill_id}`)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px',
                  cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                  transition: 'border-color 0.2s, box-shadow 0.2s',
                  animation: `fadeUp 0.3s ease ${idx * 0.04}s both`,
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(0,229,204,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-faint)', width: 16, paddingTop: 2, flexShrink: 0,
                }}>{idx + 1}</div>

                <div style={{ position: 'relative' }}>
                  <ScoreBadge score={bill.final_score} size="sm"/>
                  {delta != null && delta !== 0 && (
                    <span style={{
                      position: 'absolute', top: -5, right: -10,
                      fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      padding: '0px 4px', borderRadius: 6,
                      background: delta > 0 ? 'rgba(0,229,204,0.15)' : 'rgba(255,82,82,0.15)',
                      color: delta > 0 ? 'var(--teal)' : 'var(--danger)',
                      border: `1px solid ${delta > 0 ? 'rgba(0,229,204,0.3)' : 'rgba(255,82,82,0.3)'}`,
                      whiteSpace: 'nowrap',
                    }}>
                      {delta > 0 ? '+' : ''}{delta}
                    </span>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    </span>
                    {!bill.bipartisan && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'rgba(212,168,75,0.1)', color: 'var(--gold)', border: '1px solid rgba(212,168,75,0.25)', borderRadius: 8 }}>
                        Minority Only
                      </span>
                    )}
                    {bill.pulled_from_rules && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--teal-pale)', color: 'var(--teal-bright)', border: '1px solid rgba(0,229,204,0.2)', borderRadius: 8 }}>
                        ↑ Rules
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                      {bill.prime_sponsor || 'Unknown'}{bill.prime_party ? ` (${bill.prime_party.charAt(0)})` : ''}
                    </span>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>·</span>
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                      {STAGE_SHORT[bill.stage] || 'Intro'}
                    </span>
                    {bill.committee_passed && (
                      <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>✓ Pass</span>
                    )}
                  </div>
                </div>
                <a
                  href={`https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${sessionYear}`}
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
            )})}
          </div>
        </div>

        {/* ── PHASE 6.6 · WHAT DIED (interim mode only) ─────── */}
        {IS_INTERIM && diedBills.length > 0 && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                What Died · Likely 2027 Reintroductions
              </div>
              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--gold)' }}>
                High-momentum · stalled
              </span>
            </div>
            <div style={{
              fontSize: 11, color: 'var(--text-muted)',
              marginBottom: 10, lineHeight: 1.5,
            }}>
              Bills that cleared committee but didn't reach the governor. Candidates to resurface when pre-filing opens {new Date(NEXT_PREFILING).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {diedBills.slice(0, 10).map((bill, idx) => (
                <div
                  key={bill.bill_id}
                  onClick={() => router.push(`/bill/${bill.bill_id}`)}
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '10px 14px',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
                    transition: 'border-color 0.2s',
                    animation: `fadeUp 0.3s ease ${idx * 0.03}s both`,
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(212,168,75,0.35)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{
                    fontSize: 10, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-faint)', width: 16, flexShrink: 0,
                  }}>{idx + 1}</div>
                  <ScoreBadge score={bill.final_score} size="sm"/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginBottom: 2 }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                      <span style={{ marginLeft: 6, color: 'var(--text-faint)' }}>· {bill.category || 'Other'}</span>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                      {bill.title || `Bill ${bill.bill_number}`}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                      {bill.prime_sponsor || 'Unknown'}{bill.prime_party ? ` (${bill.prime_party.charAt(0)})` : ''}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── CATEGORY INTELLIGENCE ─────────────────────────── */}
        {categories.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
              Interim Intelligence · Category Pass Rates
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {categories.slice(0, 6).map(cat => {
                const avg = Math.round(cat.avg_score || 0)
                const barColor = avg >= 50 ? 'var(--teal)' : avg >= 35 ? 'var(--gold)' : 'var(--text-muted)'
                return (
                  <div key={cat.category}
                    onClick={() => router.push(`/search?category=${encodeURIComponent(cat.category)}`)}
                    style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '10px 14px',
                    cursor: 'pointer', transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-mid)', fontWeight: 500 }}>{cat.category}</span>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {cat.bill_count} bills
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: barColor, fontWeight: 600, textShadow: avg >= 50 ? '0 0 8px rgba(0,229,204,0.3)' : 'none' }}>
                          avg {avg}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(avg, 100)}%`,
                        background: barColor, borderRadius: 2,
                        boxShadow: avg >= 50 ? '0 0 8px rgba(0,229,204,0.3)' : 'none',
                        transition: 'width 0.4s ease',
                      }}/>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── QUICK ACTIONS ─────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'Browse Bills', icon: '🔍', path: '/search', desc: '3,111 scored' },
            { label: 'Hearing Schedule', icon: '📅', path: '/hearings', desc: 'Interim' },
            { label: 'Member Lookup', icon: '👤', path: '/members', desc: 'WA Legislature' },
            { label: 'Watchlist', icon: '🔖', path: '/watchlist', desc: `${watchlist.length} tracked` },
          ].map(({ label, icon, path, desc }) => (
            <button
              key={path}
              onClick={() => router.push(path)}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '14px',
                textAlign: 'left', cursor: 'pointer',
                transition: 'border-color 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{desc}</div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 0 4px', textAlign: 'center', fontSize: 10, color: 'var(--text-faint)' }}>
          Vector WA · Post & Policy · {SESSION} Session
        </div>
      </div>

      <Nav/>
    </div>
  )
}
