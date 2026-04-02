'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from './lib/supabase'
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
  if (avg >= 55) return { text: 'Very Strong', color: 'var(--green-dark)', bg: 'var(--green-pale)', border: 'var(--green-light)' }
  if (avg >= 45) return { text: 'Strong Outlook', color: 'var(--green-mid)', bg: 'var(--green-pale)', border: 'var(--green-light)' }
  if (avg >= 35) return { text: 'Building Momentum', color: 'var(--gold)', bg: 'var(--gold-pale)', border: 'var(--gold-light)' }
  if (avg >= 25) return { text: 'Watch Closely', color: 'var(--gold)', bg: 'var(--gold-pale)', border: 'var(--gold)' }
  return { text: 'High Risk', color: 'var(--danger)', bg: 'var(--danger-pale)', border: 'var(--danger)' }
}

function momentumLabel(bills) {
  const rising = bills.filter(b => (b.bills?.final_score || 0) >= 45).length
  const total = bills.length
  if (total === 0) return null
  const pct = rising / total
  if (pct >= 0.6) return 'Building Momentum'
  if (pct >= 0.4) return 'Mixed Signals'
  return 'Headwinds'
}

export default function HomePage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [user, setUser]         = useState(null)
  const [watchlist, setWatchlist] = useState([])
  const [topBills, setTopBills]  = useState([])
  const [categories, setCategories] = useState([])
  const [loading, setLoading]    = useState(true)

  const daysToPreFiling = daysUntil(NEXT_PREFILING)
  const daysToSession   = daysUntil(NEXT_SESSION)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      // Top 10 bills by score (the intelligence feed)
      const { data: bills } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, category, committee_name, prime_sponsor, prime_party, has_public_hearing, committee_passed, bipartisan, stalled, pulled_from_rules, hearing_date')
        .eq('session', '2025-2026')
        .not('final_score', 'is', null)
        .order('final_score', { ascending: false })
        .limit(12)
      setTopBills(bills || [])

      // Watchlist
      if (user) {
        const { data: wl } = await supabase
          .from('tracked_bills')
          .select(`bill_id, client_tag, added_at, bills(bill_id, bill_number, title, final_score, stage, committee_passed, has_public_hearing)`)
          .eq('user_id', user.id)
          .order('added_at', { ascending: false })
        setWatchlist(wl?.filter(w => w.bills) || [])
      }

      // Category intelligence (interim_intelligence view)
      try {
        const { data: cats } = await supabase
          .from('interim_intelligence')
          .select('*')
          .order('avg_score', { ascending: false })
          .limit(8)
        setCategories((cats || []).filter(c => c.category && c.category !== 'Other'))
      } catch (_) {
        // View may not exist yet — no-op
      }

      setLoading(false)
    }
    load()
  }, [])

  // Advocacy outlook derived from watchlist scores
  const watchedScores = watchlist.map(w => w.bills?.final_score || 0).filter(Boolean)
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
        background: 'var(--green-dark)',
        padding: '52px 20px 20px',
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Subtle radial glow */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(ellipse at 80% 20%, rgba(74,124,89,0.35) 0%, transparent 65%)',
          pointerEvents: 'none',
        }}/>

        <div style={{ position: 'relative', zIndex: 1 }}>
          {/* Logo row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="28" height="24" viewBox="0 0 56 48" fill="none">
                <path d="M4 4 L28 44 L52 4" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <path d="M28 44 L52 20" stroke="#4a7c59" strokeWidth="4" strokeLinecap="round" fill="none"/>
                <polygon points="52,14 58,22 44,22" fill="#b8923a"/>
              </svg>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'white', letterSpacing: '-0.01em', lineHeight: 1 }}>
                  VECTOR <span style={{ color: 'rgba(255,255,255,0.55)', fontWeight: 400, fontSize: 14 }}>| WA</span>
                </div>
                <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 1 }}>
                  Legislative Trajectories
                </div>
              </div>
            </div>

            {/* Settings gear */}
            <button
              onClick={() => router.push('/settings')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, opacity: 0.6 }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
          </div>

          {/* Status chips */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 20, padding: '4px 12px',
              fontSize: 11, color: 'rgba(255,255,255,0.85)',
              fontFamily: 'var(--font-mono)',
            }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#b8923a', display: 'inline-block' }}/>
              WA Interim Period
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 20, padding: '4px 12px',
              fontSize: 11, color: 'rgba(255,255,255,0.65)',
              fontFamily: 'var(--font-mono)',
            }}>
              Solo Practice
            </div>
          </div>

          {/* Advocacy outlook (only when watchlist has bills) */}
          {outlook && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>
                Advocacy Outlook
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: outlook.bg, border: `1px solid ${outlook.border}`,
                  borderRadius: 20, padding: '5px 14px',
                  fontSize: 12, color: outlook.color, fontWeight: 600,
                }}>
                  {outlook.text}
                </div>
                {momentum && (
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    background: 'rgba(255,255,255,0.1)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    borderRadius: 20, padding: '5px 12px',
                    fontSize: 11, color: 'rgba(255,255,255,0.75)',
                  }}>
                    {momentum}
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
              { label: 'Today', sublabel: 'Mar 31 \'26', days: 0, done: false, active: true },
              { label: 'Pre-Filing', sublabel: `${daysToPreFiling}d`, days: daysToPreFiling, done: false, active: false },
              { label: '2027 Session', sublabel: `${daysToSession}d`, days: daysToSession, done: false, active: false },
            ].map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < 2 ? 1 : 'none' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: item.active ? 10 : 8, height: item.active ? 10 : 8,
                    borderRadius: '50%',
                    background: item.active ? 'var(--green-dark)' : 'var(--border)',
                    boxShadow: item.active ? '0 0 0 3px var(--green-pale)' : 'none',
                    border: item.active ? 'none' : '1.5px solid var(--border)',
                  }}/>
                  <span style={{ fontSize: 9, color: item.active ? 'var(--green-dark)' : 'var(--text-faint)', fontWeight: item.active ? 600 : 400, textAlign: 'center', whiteSpace: 'nowrap' }}>
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
              <button onClick={() => router.push('/watchlist')} style={{ fontSize: 11, color: 'var(--green-mid)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
                View all →
              </button>
            </div>

            {/* Stats row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
              {[
                { label: 'Tracked', value: watchlist.length, color: 'var(--text-primary)' },
                { label: 'High Score', value: highMomentum, color: 'var(--green-dark)' },
                { label: 'At Risk', value: atRisk, color: atRisk > 0 ? 'var(--danger)' : 'var(--text-muted)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px 12px', textAlign: 'center',
                }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, lineHeight: 1 }}>
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
                }}
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
                    {bill.committee_passed && <span style={{ fontSize: 9, color: 'var(--green-dark)', fontFamily: 'var(--font-mono)' }}>✓ CMTE PASS</span>}
                    {bill.has_public_hearing && <span style={{ fontSize: 9, color: 'var(--green-mid)', fontFamily: 'var(--font-mono)' }}>● HEARING</span>}
                    <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>{STAGE_SHORT[bill.stage] || 'Intro'}</span>
                  </div>
                </div>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </div>
            ))}
          </div>
        ) : (
          /* Empty watchlist CTA */
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '20px 16px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 8 }}>
              No bills tracked yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-mid)', marginBottom: 14 }}>
              Start tracking bills to see your advocacy outlook and portfolio stats.
            </div>
            <button
              onClick={() => router.push('/search')}
              style={{
                padding: '8px 20px',
                background: 'var(--green-dark)', color: 'white',
                border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}
            >Browse 2025-26 Bills</button>
          </div>
        )}

        {/* ── TOP TRAJECTORY BILLS ──────────────────────────── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Top Trajectory · 2025-26
            </div>
            <button onClick={() => router.push('/search')} style={{ fontSize: 11, color: 'var(--green-mid)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
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
                  transition: 'box-shadow 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Rank */}
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
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--green-pale)', color: 'var(--green-mid)', border: '1px solid var(--green-light)', borderRadius: 8 }}>
                        Bipartisan
                      </span>
                    )}
                    {bill.pulled_from_rules && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--green-pale)', color: 'var(--green-dark)', border: '1px solid var(--green-light)', borderRadius: 8 }}>
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
                      <span style={{ fontSize: 9, color: 'var(--green-dark)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>✓ Pass</span>
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
                const passRate = cat.pass_rate ? Math.round(cat.pass_rate * 100) : 0
                const avg = Math.round(cat.avg_score || 0)
                const barColor = avg >= 50 ? 'var(--green-dark)' : avg >= 35 ? 'var(--gold)' : 'var(--text-muted)'
                return (
                  <div key={cat.category} style={{
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)', padding: '10px 14px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-mid)', fontWeight: 500 }}>{cat.category}</span>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                          {cat.bill_count} bills
                        </span>
                        <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: barColor, fontWeight: 600 }}>
                          avg {avg}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: `${Math.min(avg, 100)}%`,
                        background: barColor, borderRadius: 2,
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
                textAlign: 'left', cursor: 'pointer', transition: 'box-shadow 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
              onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>{desc}</div>
            </button>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '8px 0 4px', textAlign: 'center', fontSize: 10, color: 'var(--text-faint)' }}>
          Vector WA · Post &amp; Policy · 2025-26 Session
        </div>
      </div>

      <Nav/>
    </div>
  )
}
