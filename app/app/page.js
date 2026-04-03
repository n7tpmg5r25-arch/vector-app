'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from './lib/supabase'
import Nav from './components/Nav'
import ScoreBadge from './components/ScoreBadge'

// Dynamic session switching
const SESSION = typeof window !== 'undefined' && new Date() >= new Date('2027-01-13') ? '2027-2028' : '2025-2026'

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

  const [user, setUser]         = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [topBills, setTopBills]  = useState([])
  const [categories, setCategories] = useState([])
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

        {/* ── SESSION COUNTDOWN ─────────────────────────────── */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
        }}>
          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            2027 Session Timeline
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
            {watchlist.slice(0, 3).map(({ bill_id, client_tag, bills: bill }) => (
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
                <ScoreBadge score={bill.final_score} size="md"/>
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
            ))}
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

        {/* ── TOP TRAJECTORY BILLS ──────────────────────────── */}
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
            ) : topBills.map((bill, idx) => (
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

                <ScoreBadge score={bill.final_score} size="sm"/>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    </span>
                    {bill.bipartisan && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--teal-pale)', color: 'var(--teal)', border: '1px solid rgba(0,229,204,0.2)', borderRadius: 8 }}>
                        Bipartisan
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
              </div>
            ))}
          </div>
        </div>

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
