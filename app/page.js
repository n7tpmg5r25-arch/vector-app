'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from './lib/supabase'
import Nav from './components/Nav'
import ScoreBadge from './components/ScoreBadge'

const SESSION_CALENDAR = [
  { label: 'Committee Cutoff', date: '2027-02-06' },
  { label: 'Floor Cutoff',     date: '2027-02-20' },
  { label: 'Opposite Cutoff',  date: '2027-03-04' },
  { label: 'Sine Die',         date: '2027-03-13' },
]

function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date()
  return Math.ceil(diff / 86400000)
}

export default function HomePage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [intel, setIntel] = useState([])
  const [topBills, setTopBills] = useState([])
  const [watchedCount, setWatchedCount] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()

      const { data: intelData } = await supabase
        .from('interim_intelligence')
        .select('*')
        .order('avg_score', { ascending: false })
      setIntel(intelData || [])

      const { data: billsData } = await supabase
        .from('bills')
        .select('bill_id,bill_number,title,final_score,stage,chamber,category,committee_name,has_public_hearing,committee_passed')
        .eq('session', '2025-2026')
        .order('final_score', { ascending: false })
        .limit(10)
      setTopBills(billsData || [])

      if (user) {
        const { count } = await supabase
          .from('tracked_bills')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', user.id)
        setWatchedCount(count || 0)
      }

      setLoading(false)
    }
    load()
  }, [])

  return (
    <div style={{ paddingBottom: 100 }}>
      {/* Header */}
      <div style={{
        background: 'var(--green-dark)',
        padding: '52px 20px 24px',
        position: 'relative', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(circle at 80% 20%, rgba(74,124,89,0.3) 0%, transparent 60%)',
          pointerEvents: 'none',
        }}/>
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <svg width="32" height="28" viewBox="0 0 56 48" fill="none">
              <path d="M4 4 L28 44 L52 4" stroke="white" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M28 44 L52 20" stroke="#4a7c59" strokeWidth="4" strokeLinecap="round" fill="none"/>
              <polygon points="52,14 58,22 44,22" fill="#b8923a"/>
            </svg>
            <div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 20, fontWeight: 700,
                color: 'white', letterSpacing: '-0.01em',
              }}>
                VECTOR <span style={{ color: '#4a7c59', fontWeight: 400, fontSize: 16 }}>| WA</span>
              </div>
              <div style={{
                fontSize: 10, color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.12em', textTransform: 'uppercase',
              }}>Legislative Trajectories</div>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{
                fontSize: 11, color: 'rgba(255,255,255,0.5)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3,
              }}>2025-26 Session</div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22, fontWeight: 600, color: 'white',
              }}>Interim Period</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{
                background: 'rgba(184,146,58,0.25)',
                border: '1px solid var(--gold)',
                borderRadius: 20, padding: '4px 12px',
                fontSize: 11, color: 'var(--gold-light)',
                letterSpacing: '0.06em', fontWeight: 500,
              }}>● Interim</div>
              {watchedCount > 0 && (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 6 }}>
                  {watchedCount} watched
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* 2027 Session Calendar */}
        <div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
            color: 'var(--text-muted)', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 12,
          }}>2027 Session Calendar</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {SESSION_CALENDAR.map(({ label, date }) => {
              const days = daysUntil(date)
              return (
                <div key={label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px',
                }}>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 600,
                    color: days < 30 ? 'var(--danger)' : 'var(--green-dark)', lineHeight: 1,
                  }}>{days}d</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.3 }}>
                    {label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* 2025-26 Intelligence */}
        <div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
            color: 'var(--text-muted)', letterSpacing: '0.08em',
            textTransform: 'uppercase', marginBottom: 4,
          }}>2025-26 Session Intelligence</div>
          <div style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 12 }}>
            Pass rates by category · calibration for 2027
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {intel.filter(d => d.category !== 'Other').map(d => (
                <div key={d.category} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px 14px',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {d.category}
                    </div>
                    <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', width: `${d.committee_pass_rate || 0}%`,
                        background: 'var(--green-mid)', borderRadius: 2,
                      }}/>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-mono)', fontSize: 15,
                      fontWeight: 600, color: 'var(--green-dark)',
                    }}>{d.committee_pass_rate || 0}%</div>
                    <div style={{ fontSize: 9, color: 'var(--text-faint)' }}>
                      {d.passed_committee}/{d.total_bills}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top Bills */}
        <div>
          <div style={{
            display: 'flex', justifyContent: 'space-between',
            alignItems: 'baseline', marginBottom: 12,
          }}>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
              color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>Top Trajectory Bills</div>
            <button onClick={() => router.push('/search')} style={{
              fontSize: 12, color: 'var(--green-mid)',
              background: 'none', border: 'none', fontWeight: 500, cursor: 'pointer',
            }}>View all →</button>
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {topBills.map(bill => (
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
                      color: 'var(--text-muted)', marginBottom: 2,
                    }}>{bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}</div>
                    <div style={{
                      fontSize: 13, fontWeight: 500, color: 'var(--text-primary)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>{bill.title || bill.committee_name || 'Bill ' + bill.bill_number}</div>
                  </div>
                  <span style={{ fontSize: 16, color: 'var(--text-faint)' }}>›</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Nav/>
    </div>
  )
}
