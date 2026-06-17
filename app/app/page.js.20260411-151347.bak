'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../lib/supabase'
import { getCurrentSession, getNextBiennium, daysUntil, isInterimPeriod, formatSessionDate } from '../lib/session-config'
import { useSession } from '../lib/useSession'
import Nav from './components/Nav'
import ScoreBadge from './components/ScoreBadge'

function outlookLabel(avg) {
  if (avg >= 55) return { text: 'Very Strong', color: 'var(--teal-bright)', glow: 'var(--teal-glow)' }
  if (avg >= 45) return { text: 'Strong Outlook', color: 'var(--teal)', glow: 'var(--teal-glow)' }
  if (avg >= 35) return { text: 'Building Momentum', color: 'var(--gold)', glow: 'var(--gold-glow)' }
  if (avg >= 25) return { text: 'Watch Closely', color: 'var(--gold)', glow: 'var(--gold-glow)' }
  return { text: 'High Risk', color: 'var(--danger)', glow: 'var(--danger-glow)' }
}

function momentumLabel(bills) {
  // 6G.3: Velocity is meaningless during interim — all bills have terminal states
  if (isInterimPeriod()) return null
  // 6A.3: Exclude stalled and signed bills — a stalled bill with score 65 is NOT "rising"
  const active = bills.filter(b => {
    const bill = b.bills
    if (!bill) return false
    if (bill.stalled) return false
    if (bill.stage >= 6) return false  // Already signed into law
    return true
  })
  if (active.length === 0) return null
  const rising = active.filter(b => (b.bills?.final_score || 0) >= 45).length
  const pct = rising / active.length
  if (pct >= 0.6) return { text: 'VELOCITY: RISING', color: 'var(--teal)' }
  if (pct >= 0.4) return { text: 'VELOCITY: MIXED', color: 'var(--gold)' }
  return { text: 'VELOCITY: DECLINING', color: 'var(--danger)' }
}

export default function HomePage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  // 6D.1: Session from useSession hook (localStorage-backed, user-switchable)
  const [SESSION, setSession] = useSession()
  const nextBiennium = useMemo(() => getNextBiennium(), [])
  const [availableSessions, setAvailableSessions] = useState([SESSION])

  const [user, setUser]         = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [topBills, setTopBills]  = useState([])
  const [categories, setCategories] = useState([])
  const [scoreDeltas, setScoreDeltas] = useState({}) // bill_id -> delta number
  const [lastSyncAt, setLastSyncAt] = useState(null)  // Phase 5A: stale data warning
  const [loading, setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  // 6B.1: Session outcome counts for interim display
  const [outcomeCounts, setOutcomeCounts] = useState({ law: 0, carryOver: 0, dead: 0 })
  const [totalBills, setTotalBills] = useState(0)

  const daysToPreFiling = daysUntil(nextBiennium.prefilingOpens || nextBiennium.start)
  const daysToSession   = daysUntil(nextBiennium.start)

  async function loadData() {
    // Phase 6.4 perf: Step 1 — auth check (required before tracked_bills)
    const { data: { user } } = await supabase.auth.getUser()
    setUser(user)

    // Phase 6.4 perf: Step 2 — fire all independent queries in parallel
    const [billsResult, wlResult, catsResult, syncResult] = await Promise.all([
      supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, category, committee_name, prime_sponsor, prime_party, has_public_hearing, committee_passed, bipartisan, stalled, pulled_from_rules, hearing_date, confidence_label')
        .eq('session', SESSION)
        .not('final_score', 'is', null)
        .order('final_score', { ascending: false })
        .limit(12),
      user
        ? supabase
            .from('tracked_bills')
            .select('bill_id, client_tag, added_at, bills(bill_id, bill_number, title, final_score, stage, committee_passed, has_public_hearing, stalled, confidence_label)')
            .eq('user_id', user.id)
            .order('added_at', { ascending: false })
        : Promise.resolve({ data: null }),
      supabase
        .from('interim_intelligence')
        .select('*')
        .order('avg_score', { ascending: false })
        .limit(8),
      supabase
        .from('sync_log')
        .select('ran_at')
        .order('ran_at', { ascending: false })
        .limit(1),
    ])

    const bills = billsResult.data || []
    setTopBills(bills)

    const wl = (wlResult.data || []).filter(w => w.bills)
    setWatchlist(wl)

    // 6K.2: Fetch total bill count for quick actions grid
    const totalRes = await supabase.from('bills').select('bill_id', { count: 'exact', head: true }).eq('session', SESSION)
    setTotalBills(totalRes.count || 0)

    // 6B.1: Count session outcomes for interim display
    if (isInterimPeriod()) {
      const [lawRes, coRes, deadRes] = await Promise.all([
        supabase.from('bills').select('bill_id', { count: 'exact', head: true }).eq('session', SESSION).eq('confidence_label', 'LAW'),
        supabase.from('bills').select('bill_id', { count: 'exact', head: true }).eq('session', SESSION).eq('confidence_label', 'CARRY OVER'),
        supabase.from('bills').select('bill_id', { count: 'exact', head: true }).eq('session', SESSION).eq('confidence_label', 'DEAD'),
      ])
      setOutcomeCounts({ law: lawRes.count || 0, carryOver: coRes.count || 0, dead: deadRes.count || 0 })
    }

    setCategories((catsResult.data || []).filter(c => c.category && c.category !== 'Other'))

    if (syncResult.data?.[0]) {
      setLastSyncAt(new Date(syncResult.data[0].ran_at))
    }

    // Phase 6.4 perf: Step 3 — snapshots (depends on bill IDs from step 2)
    // 6A.3: Skip delta computation during interim — scores are frozen, deltas are noise
    if (!isInterimPeriod()) {
      const allBillIds = [
        ...bills.map(b => b.bill_id),
        ...wl.map(w => w.bill_id),
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
    }

    setLoading(false)
  }

  // 6D.1: Discover which sessions have data for the dropdown
  async function loadSessions() {
    // Grab one bill per known session to check if data exists
    const known = ['2027-2028', '2025-2026']  // newest first
    const found = []
    for (const s of known) {
      const { count } = await supabase
        .from('bills')
        .select('bill_id', { count: 'exact', head: true })
        .eq('session', s)
      if (count && count > 0) found.push(s)
    }
    if (found.length > 0) setAvailableSessions(found)
  }

  async function handleRefresh() {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  useEffect(() => { loadData(); loadSessions() }, [SESSION])

  const watchedScores = watchlist.map(w => w.bills?.final_score ?? 0).filter(s => s != null)
  const avgScore = watchedScores.length > 0
    ? Math.round(watchedScores.reduce((a, b) => a + b, 0) / watchedScores.length)
    : null
  const outlook = avgScore !== null && !isInterimPeriod() ? outlookLabel(avgScore) : null
  const momentum = momentumLabel(watchlist)
  // 6H.2: During interim, show outcome counts instead of score-based stats
  const interimWatchCounts = isInterimPeriod() ? {
    law: watchlist.filter(w => w.bills?.confidence_label === 'LAW').length,
    carry: watchlist.filter(w => w.bills?.confidence_label === 'CARRY OVER').length,
    dead: watchlist.filter(w => w.bills?.confidence_label === 'DEAD').length,
  } : null
  const highMomentum = isInterimPeriod()
    ? (interimWatchCounts?.law || 0)
    : watchlist.filter(w => (w.bills?.final_score || 0) >= 50).length
  const atRisk = isInterimPeriod()
    ? (interimWatchCounts?.dead || 0)
    : watchlist.filter(w => (w.bills?.final_score || 0) < 25).length

  const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp. Ch.', 'Conf.', 'Gov.']
  const sessionYear = SESSION.split('-')[0]

  return (
    <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>

      {/* ── HEADER ────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(180deg, #0e1014 0%, var(--bg) 100%)',
        padding: '52px 20px 20px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Radial glow */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(ellipse at 70% 20%, rgba(184,151,90,0.08) 0%, transparent 60%)',
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
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--teal)', letterSpacing: '-0.01em', lineHeight: 1, textShadow: '0 0 20px rgba(184,151,90,0.3)' }}>
                  VECTOR <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 14 }}>| WA</span>
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 1 }}>
                  Legislative Trajectories
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Phase 7V: hide refresh during interim — scores are frozen */}
              {!isInterimPeriod() && (
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  aria-label="Refresh bill scores"
                  title={refreshing ? 'Refreshing…' : 'Refresh bill scores'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: refreshing ? 0.3 : 0.5 }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ transition: 'transform 0.5s', transform: refreshing ? 'rotate(360deg)' : 'none' }}>
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                </button>
              )}
              <button
                onClick={() => router.push('/settings')}
                aria-label="Settings"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.5 }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </button>
            </div>
          </div>

          {/* Status chips + session picker */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* 6D.1: Session picker dropdown */}
            {availableSessions.length > 1 ? (
              <select
                value={SESSION}
                onChange={e => setSession(e.target.value)}
                style={{
                  background: 'rgba(184,151,90,0.08)',
                  border: '1px solid rgba(184,151,90,0.25)',
                  borderRadius: 20, padding: '4px 12px',
                  fontSize: 11, color: 'var(--teal)',
                  fontFamily: 'var(--font-mono)',
                  cursor: 'pointer', outline: 'none',
                  WebkitAppearance: 'none', MozAppearance: 'none',
                  appearance: 'none',
                  backgroundImage: 'url("data:image/svg+xml,%3Csvg width=\'8\' height=\'5\' viewBox=\'0 0 8 5\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l3 3 3-3\' stroke=\'%2300e5cc\' stroke-width=\'1.5\' stroke-linecap=\'round\'/%3E%3C/svg%3E")',
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 10px center',
                  paddingRight: 26,
                }}
              >
                {availableSessions.map(s => (
                  <option key={s} value={s} style={{ background: '#0a0f1a', color: '#ccc' }}>{s}</option>
                ))}
              </select>
            ) : (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: 'rgba(184,151,90,0.08)',
                border: '1px solid rgba(184,151,90,0.25)',
                borderRadius: 20, padding: '4px 12px',
                fontSize: 11, color: 'var(--teal)',
                fontFamily: 'var(--font-mono)',
              }}>
                {SESSION}
              </div>
            )}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(184,151,90,0.1)',
              border: '1px solid rgba(184,151,90,0.25)',
              borderRadius: 20, padding: '4px 12px',
              fontSize: 11, color: 'var(--gold)',
              fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', boxShadow: 'var(--gold-glow)' }}/>
              {isInterimPeriod() ? 'Interim' : 'In Session'}
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid var(--border)',
              borderRadius: 20, padding: '4px 12px',
              fontSize: 11, color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}>
              Solo Practice
            </div>
          </div>

          {/* 6D.3: Transition messaging */}
          {nextBiennium.prefilingOpens && daysToPreFiling > 0 && daysToPreFiling <= 240 && (
            <div style={{
              marginTop: 10, padding: '8px 14px',
              background: 'rgba(184,151,90,0.04)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5,
            }}>
              {daysToPreFiling > 60 ? (
                <>Pre-filing for {nextBiennium.session} opens {formatSessionDate(nextBiennium.prefilingOpens)} ({daysToPreFiling} days)</>
              ) : daysToPreFiling > 0 ? (
                <>Pre-filing opens in <span style={{ color: 'var(--teal)', fontWeight: 600 }}>{daysToPreFiling} days</span> &mdash; {nextBiennium.session} bills will appear here automatically</>
              ) : null}
            </div>
          )}
          {nextBiennium.prefilingOpens && daysToPreFiling === 0 && daysToSession > 0 && (
            <div style={{
              marginTop: 10, padding: '8px 14px',
              background: 'rgba(184,151,90,0.08)',
              border: '1px solid rgba(184,151,90,0.2)',
              borderRadius: 'var(--radius)',
              fontSize: 12, color: 'var(--teal)', lineHeight: 1.5,
            }}>
              {availableSessions.includes(nextBiennium.session) ? (
                <>{nextBiennium.session} pre-filed bills are being tracked. <span onClick={() => setSession(nextBiennium.session)} style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>Switch to {nextBiennium.session}</span></>
              ) : (
                <>Pre-filing is open for {nextBiennium.session}. New bills will appear as they are filed.</>
              )}
            </div>
          )}
          {SESSION !== getCurrentSession() && (
            <div style={{
              marginTop: 10, padding: '8px 14px',
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid rgba(184,151,90,0.2)',
              borderRadius: 'var(--radius)',
              fontSize: 12, color: 'var(--gold)', lineHeight: 1.5,
            }}>
              Viewing historical session. <span onClick={() => setSession(getCurrentSession())} style={{ textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>Switch to current session</span>
            </div>
          )}

          {/* Advocacy outlook — 6B.4: require 5+ bills, 6H.2: outcome summary during interim */}
          {isInterimPeriod() && watchlist.length >= 5 && interimWatchCounts ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>
                Session Results
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 10,
                background: 'rgba(184,151,90,0.06)',
                border: '1px solid var(--border)',
                borderRadius: 20, padding: '5px 14px',
                fontSize: 12, fontFamily: 'var(--font-mono)',
              }}>
                <span style={{ color: 'var(--teal)', fontWeight: 600 }}>{interimWatchCounts.law} passed</span>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                {interimWatchCounts.carry > 0 && (<>
                  <span style={{ color: 'var(--gold)', fontWeight: 600 }}>{interimWatchCounts.carry} passed chamber</span>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                </>)}
                <span style={{ color: 'var(--text-muted)' }}>{interimWatchCounts.dead} dead</span>
              </div>
            </div>
          ) : outlook && watchlist.length >= 5 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>
                Advocacy Outlook
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(184,151,90,0.08)',
                  border: '1px solid rgba(184,151,90,0.25)',
                  borderRadius: 20, padding: '5px 14px',
                  fontSize: 12, color: outlook.color, fontWeight: 600,
                  boxShadow: outlook.glow,
                }}>
                  {outlook.text}
                </div>
                {momentum && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'rgba(184,151,90,0.06)',
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
          ) : watchlist.length > 0 && watchlist.length < 5 ? (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>
                Track 5+ bills to see portfolio outlook
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ padding: '16px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ── STALE DATA WARNING (Phase 5A) ────────────────── */}
        {lastSyncAt && (Date.now() - lastSyncAt.getTime()) > 36 * 60 * 60 * 1000 && (
          <div style={{
            background: 'rgba(184,151,90,0.08)',
            border: '1px solid rgba(184,151,90,0.3)',
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
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            {nextBiennium.session?.split('-')[0] || '2027'} Session Timeline
          </div>
          <div style={{ display: 'flex', gap: 0 }}>
            {[
              { label: 'Today', sublabel: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }), active: true },
              { label: 'Pre-Filing', sublabel: `${daysToPreFiling}d`, active: false },
              { label: `${nextBiennium.session?.split('-')[0] || '2027'} Session`, sublabel: `${daysToSession}d`, active: false },
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
              {(isInterimPeriod() ? [
                { label: 'Tracked', value: watchlist.length, color: 'var(--teal)' },
                { label: 'Passed', value: highMomentum, color: highMomentum > 0 ? 'var(--teal-bright)' : 'var(--text-muted)' },
                { label: 'Dead', value: atRisk, color: atRisk > 0 ? 'var(--text-muted)' : 'var(--text-muted)' },
              ] : [
                { label: 'Tracked', value: watchlist.length, color: 'var(--teal)' },
                { label: 'High Score', value: highMomentum, color: 'var(--teal-bright)' },
                { label: 'At Risk', value: atRisk, color: atRisk > 0 ? 'var(--danger)' : 'var(--text-muted)' },
              ]).map(({ label, value, color }) => (
                <div key={label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, lineHeight: 1, textShadow: `0 0 12px ${color === 'var(--teal)' ? 'rgba(184,151,90,0.3)' : color === 'var(--danger)' ? 'rgba(196,71,48,0.3)' : 'transparent'}` }}>
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
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ position: 'relative' }}>
                  <ScoreBadge score={bill.final_score} size="md" status={bill.confidence_label}/>
                  {delta != null && delta !== 0 && (
                    <span style={{
                      position: 'absolute', top: -6, right: -10,
                      fontSize: 9, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      padding: '1px 5px', borderRadius: 8,
                      background: delta > 0 ? 'rgba(184,151,90,0.15)' : 'rgba(196,71,48,0.15)',
                      color: delta > 0 ? 'var(--teal)' : 'var(--danger)',
                      border: `1px solid ${delta > 0 ? 'rgba(184,151,90,0.3)' : 'rgba(196,71,48,0.3)'}`,
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

        {/* ── SESSION OUTCOMES (interim) / TOP TRAJECTORY (active) ─── */}
        {isInterimPeriod() ? (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Session Outcomes · {SESSION}
              </div>
              <button onClick={() => router.push('/outcomes')} style={{ fontSize: 11, color: 'var(--teal)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                All outcomes →
              </button>
            </div>

            {/* Outcome stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
              {[
                { label: 'Signed into Law', value: outcomeCounts.law, color: 'var(--teal)', glow: 'rgba(184,151,90,0.3)' },
                { label: 'Passed Chamber', value: outcomeCounts.carryOver, color: 'var(--gold)', glow: 'rgba(184,151,90,0.3)' },
                { label: 'Dead', value: outcomeCounts.dead, color: 'var(--text-muted)', glow: 'transparent' },
              ].map(({ label, value, color, glow }) => (
                <div key={label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 10px', textAlign: 'center',
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 24, fontWeight: 700, color, lineHeight: 1, textShadow: `0 0 12px ${glow}` }}>
                    {value}
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: 5, lineHeight: 1.2 }}>
                    {label}
                  </div>
                </div>
              ))}
            </div>

            {/* Watchlist outcomes */}
            {watchlist.length > 0 && (() => {
              const wlLaw = watchlist.filter(w => w.bills?.confidence_label === 'LAW').length
              const wlCarry = watchlist.filter(w => w.bills?.confidence_label === 'CARRY OVER').length
              const wlDead = watchlist.filter(w => w.bills?.confidence_label === 'DEAD').length
              return (
                <div style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 12,
                }}>
                  <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                    Your Watchlist Outcomes
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                    {wlLaw > 0 && <span style={{ color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{wlLaw} passed</span>}
                    {wlCarry > 0 && <span style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{wlCarry} passed chamber</span>}
                    {wlDead > 0 && <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{wlDead} dead</span>}
                    {wlLaw === 0 && wlCarry === 0 && wlDead === 0 && <span style={{ color: 'var(--text-faint)' }}>No outcomes yet</span>}
                  </div>
                </div>
              )
            })()}
          </div>
        ) : (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Top Trajectory · {SESSION}
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
                onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'; e.currentTarget.style.boxShadow = '0 0 20px rgba(184,151,90,0.06)' }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none' }}
              >
                <div style={{
                  fontSize: 10, fontFamily: 'var(--font-mono)',
                  color: 'var(--text-faint)', width: 16, paddingTop: 2, flexShrink: 0,
                }}>{idx + 1}</div>

                <div style={{ position: 'relative' }}>
                  <ScoreBadge score={bill.final_score} size="sm" status={bill.confidence_label}/>
                  {delta != null && delta !== 0 && (
                    <span style={{
                      position: 'absolute', top: -5, right: -10,
                      fontSize: 8, fontFamily: 'var(--font-mono)', fontWeight: 700,
                      padding: '0px 4px', borderRadius: 6,
                      background: delta > 0 ? 'rgba(184,151,90,0.15)' : 'rgba(196,71,48,0.15)',
                      color: delta > 0 ? 'var(--teal)' : 'var(--danger)',
                      border: `1px solid ${delta > 0 ? 'rgba(184,151,90,0.3)' : 'rgba(196,71,48,0.3)'}`,
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
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'rgba(184,151,90,0.1)', color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 8 }}>
                        Minority Only
                      </span>
                    )}
                    {bill.pulled_from_rules && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--teal-pale)', color: 'var(--teal-bright)', border: '1px solid rgba(184,151,90,0.2)', borderRadius: 8 }}>
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
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-mid)', fontWeight: 500 }}>{cat.category}</span>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {cat.bill_count} bills
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: barColor, fontWeight: 600, textShadow: avg >= 50 ? '0 0 8px rgba(184,151,90,0.3)' : 'none' }}>
                          avg {avg}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(avg, 100)}%`,
                        background: barColor, borderRadius: 2,
                        boxShadow: avg >= 50 ? '0 0 8px rgba(184,151,90,0.3)' : 'none',
                        transition: 'width 0.4s ease',
                      }}/>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── STAT STRIP (Phase 7V: nav stripped, Nav covers routing) ── */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 8px',
          display: 'flex',
          alignItems: 'stretch',
          justifyContent: 'space-around',
        }}>
          {[
            { label: 'Bills Scored', value: totalBills.toLocaleString(), color: 'var(--teal)' },
            { label: 'Tracked', value: watchlist.length.toLocaleString(), color: 'var(--gold)' },
            isInterimPeriod()
              ? { label: 'Signed into Law', value: outcomeCounts.law.toLocaleString(), color: 'var(--teal-bright)' }
              : { label: 'High Signal', value: topBills.filter(b => (b.final_score || 0) >= 75).length.toLocaleString(), color: 'var(--teal-bright)' },
          ].map(({ label, value, color }, i, arr) => (
            <div
              key={label}
              style={{
                flex: 1,
                textAlign: 'center',
                padding: '2px 6px',
                borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
              }}
            >
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 22,
                fontWeight: 700,
                color,
                lineHeight: 1,
                textShadow: '0 0 12px rgba(184,151,90,0.25)',
              }}>
                {value}
              </div>
              <div style={{
                fontSize: 9,
                color: 'var(--text-faint)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                marginTop: 6,
                whiteSpace: 'nowrap',
              }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </div>

      <Nav/>
    </div>
  )
}
