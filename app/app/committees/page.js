'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const SESSION = typeof window !== 'undefined' && new Date() >= new Date('2027-01-13') ? '2027-2028' : '2025-2026'

const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp. Ch.', 'Conf.', 'Gov.']

export default function CommitteesPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [committees, setCommittees] = useState([])
  const [rulesQueue, setRulesQueue] = useState([])
  const [chamber, setChamber] = useState('All')
  const [sortBy, setSortBy] = useState('bills')
  const [expanded, setExpanded] = useState(null)  // committee key
  const [expandedBills, setExpandedBills] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      // Phase 6.4 perf pattern: fetch all committee-assigned bills in one call
      const { data } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, category, committee_name, committee_passed, has_public_hearing, stalled, prime_sponsor, prime_party, bipartisan')
        .eq('session', SESSION)
        .not('committee_name', 'is', null)
        .not('committee_name', 'eq', '')
        .order('final_score', { ascending: false })
        .range(0, 2999)

      if (!data) { setLoading(false); return }

      // Separate Rules queue from policy committees
      const RULES_NAMES = ['Rules 2 Review', 'Rules Committee for second reading', 'Rules']
      const isRules = (name) => RULES_NAMES.some(r => (name || '').toLowerCase().includes(r.toLowerCase()))

      // Aggregate by committee+chamber
      const map = {}
      const rulesMap = {}
      data.forEach(b => {
        const target = isRules(b.committee_name) ? rulesMap : map
        const key = b.committee_name + '|' + b.chamber
        if (!target[key]) {
          target[key] = {
            key,
            name: b.committee_name,
            chamber: b.chamber,
            bills: [],
            totalScore: 0,
            passed: 0,
            hearings: 0,
            highScore: 0,
            stalled: 0,
            isRulesQueue: isRules(b.committee_name),
          }
        }
        target[key].bills.push(b)
        target[key].totalScore += (b.final_score || 0)
        if (b.committee_passed) target[key].passed++
        if (b.has_public_hearing) target[key].hearings++
        if ((b.final_score || 0) >= 50) target[key].highScore++
        if (b.stalled) target[key].stalled++
      })

      const toList = (m) => Object.values(m).map(c => ({
        ...c,
        billCount: c.bills.length,
        avgScore: Math.round(c.totalScore / c.bills.length),
        passRate: Math.round((c.passed / c.bills.length) * 100),
      }))

      setCommittees(toList(map))
      setRulesQueue(toList(rulesMap))
      setLoading(false)
    }
    load()
  }, [])

  // Filter and sort
  const filtered = chamber === 'All' ? committees : committees.filter(c => c.chamber === chamber)
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      if (sortBy === 'bills') return b.billCount - a.billCount
      if (sortBy === 'score') return b.avgScore - a.avgScore
      if (sortBy === 'passed') return b.passRate - a.passRate
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      return 0
    })
  }, [filtered, sortBy])

  // Summary stats
  const totalBills = filtered.reduce((s, c) => s + c.billCount, 0)
  const totalPassed = filtered.reduce((s, c) => s + c.passed, 0)
  const overallAvg = totalBills > 0 ? Math.round(filtered.reduce((s, c) => s + c.totalScore, 0) / totalBills) : 0

  // Combine both lists for expand lookup
  const allCommittees = [...committees, ...rulesQueue]

  function handleExpand(key) {
    if (expanded === key) {
      setExpanded(null)
      setExpandedBills([])
    } else {
      setExpanded(key)
      const cmte = allCommittees.find(c => c.key === key)
      setExpandedBills(cmte ? cmte.bills.slice(0, 20) : [])
    }
  }

  // Filtered rules queue
  const filteredRules = chamber === 'All' ? rulesQueue : rulesQueue.filter(c => c.chamber === chamber)
  const rulesTotal = filteredRules.reduce((s, c) => s + c.billCount, 0)

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>

      {/* HEADER */}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700,
            color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)',
          }}>
            Committees
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {filtered.length} committees
          </div>
        </div>

        {/* Summary stats */}
        {!loading && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {[
              { label: 'Bills', value: totalBills, color: 'var(--teal)' },
              { label: 'Avg Score', value: overallAvg, color: overallAvg >= 45 ? 'var(--teal)' : overallAvg >= 30 ? 'var(--gold)' : 'var(--text-muted)' },
              { label: 'Cmte Pass', value: totalPassed, color: 'var(--teal-mid)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color }}>{value}</span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Chamber filter */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
          {['All', 'Senate', 'House'].map(c => (
            <button key={c} onClick={() => { setChamber(c); setExpanded(null) }} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
              background: chamber === c ? 'var(--teal)' : 'transparent',
              color: chamber === c ? 'var(--bg)' : 'var(--text-muted)',
              border: '1px solid ' + (chamber === c ? 'var(--teal)' : 'var(--border)'),
              cursor: 'pointer', transition: 'all 0.15s',
              boxShadow: chamber === c ? 'var(--teal-glow)' : 'none',
            }}>{c}</button>
          ))}
        </div>

        {/* Sort buttons */}
        <div style={{ display: 'flex', gap: 6 }}>
          {[['bills', 'By Size'], ['score', 'By Score'], ['passed', 'Pass Rate'], ['name', 'A-Z']].map(([val, label]) => (
            <button key={val} onClick={() => setSortBy(val)} style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 10,
              background: sortBy === val ? 'var(--bg-surface)' : 'transparent',
              color: sortBy === val ? 'var(--text-primary)' : 'var(--text-faint)',
              border: '1px solid ' + (sortBy === val ? 'var(--border)' : 'transparent'),
              cursor: 'pointer',
            }}>{label}</button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : sorted.map((cmte, idx) => {
          const isExpanded = expanded === cmte.key
          const scoreColor = cmte.avgScore >= 50 ? 'var(--teal)' : cmte.avgScore >= 35 ? 'var(--gold)' : 'var(--text-muted)'
          const barWidth = Math.min(cmte.passRate, 100)

          return (
            <div key={cmte.key}>
              {/* Committee card */}
              <div
                onClick={() => handleExpand(cmte.key)}
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid ' + (isExpanded ? 'rgba(184,151,90,0.3)' : 'var(--border)'),
                  borderRadius: isExpanded ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                  padding: '14px',
                  cursor: 'pointer',
                  transition: 'border-color 0.2s',
                  animation: 'fadeUp 0.3s ease ' + (idx * 0.02) + 's both',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <ScoreBadge score={cmte.avgScore} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {cmte.name}
                      </span>
                      <span style={{
                        fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 500,
                        background: cmte.chamber === 'Senate' ? 'rgba(184,151,90,0.08)' : 'rgba(184,151,90,0.08)',
                        color: cmte.chamber === 'Senate' ? 'var(--teal)' : 'var(--gold)',
                        border: '1px solid ' + (cmte.chamber === 'Senate' ? 'rgba(184,151,90,0.25)' : 'rgba(184,151,90,0.25)'),
                      }}>{cmte.chamber}</span>
                    </div>

                    {/* Stats row */}
                    <div style={{ display: 'flex', gap: 12, marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                        {cmte.billCount} bills
                      </span>
                      <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: scoreColor }}>
                        avg {cmte.avgScore}
                      </span>
                      {cmte.passed > 0 && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--teal-mid)' }}>
                          {cmte.passed} passed ({cmte.passRate}%)
                        </span>
                      )}
                      {cmte.highScore > 0 && (
                        <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>
                          {cmte.highScore} high
                        </span>
                      )}
                    </div>

                    {/* Pass rate bar */}
                    <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%',
                        width: barWidth + '%',
                        background: cmte.passRate >= 50 ? 'var(--teal)' : cmte.passRate >= 25 ? 'var(--gold)' : 'var(--text-muted)',
                        borderRadius: 2,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                  </div>

                  {/* Expand chevron */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </div>

              {/* Expanded bill list */}
              {isExpanded && (
                <div style={{
                  background: 'rgba(14,16,20,0.6)',
                  border: '1px solid rgba(184,151,90,0.3)',
                  borderTop: 'none',
                  borderRadius: '0 0 var(--radius) var(--radius)',
                  padding: '8px 10px',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  {expandedBills.map(bill => (
                    <div
                      key={bill.bill_id}
                      onClick={() => router.push('/bill/' + bill.bill_id)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '8px 10px',
                        borderRadius: 6,
                        cursor: 'pointer',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(184,151,90,0.04)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <ScoreBadge score={bill.final_score} size="sm" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500 }}>
                            {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                          </span>
                          <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                            {STAGE_SHORT[bill.stage] || 'Intro'}
                          </span>
                          {bill.stalled && (
                            <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--danger-pale)', color: 'var(--danger)', border: '1px solid rgba(196,71,48,0.25)', borderRadius: 8 }}>Stalled</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {bill.title || 'Bill ' + bill.bill_number}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                          {bill.committee_passed && (
                            <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{'✓'} CMTE PASS</span>
                          )}
                          {bill.prime_sponsor && (
                            <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                              {bill.prime_sponsor}{bill.prime_party ? ' (' + bill.prime_party.charAt(0) + ')' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {cmte.billCount > 20 && (
                    <div style={{
                      textAlign: 'center', padding: '8px',
                      fontSize: 11, color: 'var(--teal)', cursor: 'pointer',
                      fontFamily: 'var(--font-mono)',
                    }}
                    onClick={(e) => { e.stopPropagation(); setExpandedBills(cmte.bills) }}>
                      Show all {cmte.billCount} bills
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* RULES QUEUE — separated from policy committees */}
      {!loading && filteredRules.length > 0 && (
        <div style={{ padding: '4px 16px 12px' }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8,
            padding: '10px 0', borderTop: '1px solid var(--border)',
          }}>
            <span style={{
              fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600,
              color: 'var(--gold)', letterSpacing: '-0.01em',
            }}>
              Floor Queue
            </span>
            <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
              {rulesTotal} bills awaiting floor vote
            </span>
          </div>
          <div style={{
            fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 10,
            padding: '8px 12px', background: 'rgba(184,151,90,0.04)', borderRadius: 8,
            border: '1px solid rgba(184,151,90,0.12)',
          }}>
            These bills passed their policy committee and are queued in Rules for a floor vote. Being in the queue does not guarantee a floor vote — many bills die here when the session clock runs out.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {filteredRules.map((cmte, idx) => {
              const isExpanded = expanded === cmte.key
              const scoreColor = cmte.avgScore >= 50 ? 'var(--teal)' : cmte.avgScore >= 35 ? 'var(--gold)' : 'var(--text-muted)'

              return (
                <div key={cmte.key}>
                  <div
                    onClick={() => handleExpand(cmte.key)}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid ' + (isExpanded ? 'rgba(184,151,90,0.3)' : 'var(--border)'),
                      borderRadius: isExpanded ? 'var(--radius) var(--radius) 0 0' : 'var(--radius)',
                      padding: '14px',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <ScoreBadge score={cmte.avgScore} size="sm" />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {cmte.name}
                          </span>
                          <span style={{
                            fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 500,
                            background: 'rgba(184,151,90,0.08)', color: 'var(--gold)',
                            border: '1px solid rgba(184,151,90,0.25)',
                          }}>Queue</span>
                          <span style={{
                            fontSize: 9, padding: '1px 7px', borderRadius: 10, fontWeight: 500,
                            background: cmte.chamber === 'Senate' ? 'rgba(184,151,90,0.08)' : 'rgba(184,151,90,0.08)',
                            color: cmte.chamber === 'Senate' ? 'var(--teal)' : 'var(--gold)',
                            border: '1px solid ' + (cmte.chamber === 'Senate' ? 'rgba(184,151,90,0.25)' : 'rgba(184,151,90,0.25)'),
                          }}>{cmte.chamber}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 12 }}>
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                            {cmte.billCount} bills
                          </span>
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: scoreColor }}>
                            avg {cmte.avgScore}
                          </span>
                          <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--teal)' }}>
                            {cmte.highScore} high
                          </span>
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                        style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isExpanded ? 'rotate(90deg)' : 'none' }}>
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </div>
                  </div>

                  {isExpanded && (
                    <div style={{
                      background: 'rgba(14,16,20,0.6)',
                      border: '1px solid rgba(184,151,90,0.3)',
                      borderTop: 'none',
                      borderRadius: '0 0 var(--radius) var(--radius)',
                      padding: '8px 10px',
                      display: 'flex', flexDirection: 'column', gap: 4,
                    }}>
                      {expandedBills.map(bill => (
                        <div
                          key={bill.bill_id}
                          onClick={() => router.push('/bill/' + bill.bill_id)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'rgba(184,151,90,0.04)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                          <ScoreBadge score={bill.final_score} size="sm" />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <span style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500 }}>
                                {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                              </span>
                              <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                                {STAGE_SHORT[bill.stage] || 'Intro'}
                              </span>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {bill.title || 'Bill ' + bill.bill_number}
                            </div>
                            <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                              {bill.prime_sponsor && (
                                <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                                  {bill.prime_sponsor}{bill.prime_party ? ' (' + bill.prime_party.charAt(0) + ')' : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {cmte.billCount > 20 && (
                        <div style={{
                          textAlign: 'center', padding: '8px',
                          fontSize: 11, color: 'var(--gold)', cursor: 'pointer',
                          fontFamily: 'var(--font-mono)',
                        }}
                        onClick={(e) => { e.stopPropagation(); setExpandedBills(cmte.bills) }}>
                          Show all {cmte.billCount} bills
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Nav />
    </div>
  )
}
