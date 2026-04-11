'use client'
import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession } from '../../lib/session-config'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

const SESSION = typeof window !== 'undefined' ? getCurrentSession() : '2025-2026'

export default function MembersPage() {
  const router = useRouter()
  const supabase = createBrowserClient()

  const [members, setMembers]         = useState([])
  const [selectedMember, setSelected] = useState(null)
  const [memberBills, setMemberBills] = useState([])
  const [loading, setLoading]         = useState(true)
  const [billsLoading, setBillsLoading] = useState(false)
  const [chamber, setChamber]         = useState('All')
  const [party, setParty]             = useState('All')
  const [query, setQuery]             = useState('')

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('bills')
        .select('prime_sponsor, prime_party, chamber, is_committee_chair, sponsor_tier, final_score, committee_passed, has_public_hearing, committee_name')
        .eq('session', SESSION)
        .not('prime_sponsor', 'is', null)

      if (!data) { setLoading(false); return }

      const map = {}
      for (const bill of data) {
        const name = bill.prime_sponsor
        if (!name) continue
        if (!map[name]) {
          map[name] = {
            name, party: bill.prime_party || '?', chamber: bill.chamber || '?',
            is_chair: bill.is_committee_chair || false, tier: bill.sponsor_tier || 3,
            bill_count: 0, committee_passes: 0, hearing_count: 0, scores: [], top_score: 0,
            committees: new Set(),
          }
        }
        map[name].bill_count++
        map[name].scores.push(bill.final_score || 0)
        if (bill.committee_passed) map[name].committee_passes++
        if (bill.has_public_hearing) map[name].hearing_count++
        if ((bill.final_score || 0) > map[name].top_score) map[name].top_score = bill.final_score || 0
        if (bill.prime_party) map[name].party = bill.prime_party
        if (bill.chamber) map[name].chamber = bill.chamber
        if (bill.committee_name) map[name].committees.add(bill.committee_name)
      }

      const list = Object.values(map).map(m => ({
        ...m,
        committees: [...m.committees],
        avg_score: m.scores.length > 0
          ? Math.round(m.scores.reduce((a, b) => a + b, 0) / m.scores.length) : 0,
      })).sort((a, b) => b.bill_count - a.bill_count)

      setMembers(list)
      setLoading(false)
    }
    load()
  }, [])

  const loadMemberBills = useCallback(async (name) => {
    setBillsLoading(true)
    const { data } = await supabase
      .from('bills')
      .select('bill_id, bill_number, title, final_score, stage, chamber, committee_name, committee_passed, has_public_hearing, bipartisan, hearing_date, status, confidence_label')
      .eq('session', SESSION)
      .eq('prime_sponsor', name)
      .order('final_score', { ascending: false })
    setMemberBills(data || [])
    setBillsLoading(false)
  }, [supabase])

  function selectMember(m) {
    setSelected(m)
    loadMemberBills(m.name)
  }

  const STAGE_LABELS = ['', 'Intro', 'Cmte', 'Floor', 'Opp.Ch.', 'Conf.', 'Signed']

  const filtered = members.filter(m => {
    if (chamber !== 'All' && m.chamber !== chamber) return false
    if (party !== 'All' && m.party !== party) return false
    if (query.trim() && !m.name.toLowerCase().includes(query.toLowerCase())) return false
    return true
  })

  const tierLabel = (tier) => {
    if (tier === 1) return { text: 'Majority Leadership', color: 'var(--teal)', bg: 'var(--teal-pale)', border: 'rgba(184,151,90,0.2)' }
    if (tier === 2) return { text: 'Senior Member', color: 'var(--teal-mid)', bg: 'var(--teal-pale)', border: 'rgba(184,151,90,0.15)' }
    if (tier === 3) return { text: 'Member', color: 'var(--text-mid)', bg: 'var(--bg-surface)', border: 'var(--border)' }
    return { text: 'Minority', color: 'var(--text-muted)', bg: 'var(--bg-surface)', border: 'var(--border)' }
  }

  // ── MEMBER DETAIL VIEW ──────────────────────────────
  if (selectedMember) {
    const tier = tierLabel(selectedMember.tier)
    return (
      <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>
        <div style={{
          background: 'linear-gradient(180deg, #0e1014 0%, var(--bg) 100%)',
          padding: '52px 20px 20px',
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0,
            backgroundImage: 'radial-gradient(ellipse at 70% 30%, rgba(184,151,90,0.06) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}/>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <button
              onClick={() => { setSelected(null); setMemberBills([]) }}
              style={{ background: 'none', border: 'none', fontSize: 13, color: 'var(--teal)', cursor: 'pointer', marginBottom: 12, padding: 0 }}
            >← Members</button>

            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(184,151,90,0.1)',
                border: '2px solid rgba(184,151,90,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 16, fontWeight: 700, color: 'var(--teal)', flexShrink: 0,
                boxShadow: '0 0 16px rgba(184,151,90,0.15)',
              }}>
                {selectedMember.name.split(' ').map(n => n[0]).slice(-2).join('')}
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>
                  {selectedMember.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {selectedMember.chamber === 'House' ? 'State House' : 'State Senate'} ·{' '}
                  {selectedMember.party === 'D' ? 'Democrat' : selectedMember.party === 'R' ? 'Republican' : selectedMember.party}
                  {selectedMember.is_chair && ' · Committee Chair'}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <span style={{ fontSize: 9, padding: '3px 10px', borderRadius: 10, background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}>
                    {tier.text}
                  </span>
                  <span style={{ fontSize: 9, padding: '3px 10px', borderRadius: 10, background: 'var(--bg-surface)', color: 'var(--text-mid)', border: '1px solid var(--border)' }}>
                    {selectedMember.bill_count} bills sponsored
                  </span>
                  <a
                    href={`https://leg.wa.gov/${selectedMember.chamber === 'House' ? 'House/Representatives' : 'Senate/Senators'}/Pages/${selectedMember.name.split(' ').pop()}.aspx`}
                    target="_blank" rel="noopener noreferrer"
                    onClick={e => e.stopPropagation()}
                    style={{
                      fontSize: 9, padding: '3px 10px', borderRadius: 10,
                      background: 'rgba(184,151,90,0.08)', color: 'var(--teal)',
                      border: '1px solid rgba(184,151,90,0.2)',
                      textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    leg.wa.gov ↗
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            {[
              { label: 'Bills', value: selectedMember.bill_count, color: 'var(--teal)' },
              { label: 'Cmte Passes', value: selectedMember.committee_passes, color: 'var(--teal-mid)' },
              { label: 'Avg Score', value: selectedMember.avg_score, color: selectedMember.avg_score >= 45 ? 'var(--teal)' : selectedMember.avg_score >= 30 ? 'var(--gold)' : 'var(--text-muted)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '10px 12px', textAlign: 'center',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color, lineHeight: 1, textShadow: color === 'var(--teal)' ? '0 0 8px rgba(184,151,90,0.3)' : 'none' }}>{value}</div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 4 }}>{label}</div>
              </div>
            ))}
          </div>

          {selectedMember.committees && selectedMember.committees.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
              <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
                Committee Affiliations
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selectedMember.committees.sort().map(c => (
                  <span key={c} style={{
                    fontSize: 11, padding: '4px 10px', borderRadius: 8,
                    background: 'var(--bg-surface)', color: 'var(--text-mid)',
                    border: '1px solid var(--border)', lineHeight: 1.3,
                  }}>{c}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
            Sponsored Bills · {SESSION}
          </div>

          {billsLoading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
          ) : memberBills.map((bill, idx) => (
            <div
              key={bill.bill_id}
              onClick={() => router.push(`/bill/${bill.bill_id}`)}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '12px 14px',
                cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                marginBottom: 6, transition: 'border-color 0.2s',
                animation: `fadeUp 0.3s ease ${idx * 0.03}s both`,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <ScoreBadge score={bill.final_score} size="sm" status={bill.confidence_label}/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                  {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                  <span style={{ marginLeft: 8, color: 'var(--text-faint)' }}>{STAGE_LABELS[bill.stage] || 'Intro'}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                  {bill.committee_name || 'No committee assigned'}
                  {bill.committee_passed && <span style={{ marginLeft: 8, color: 'var(--teal)', fontWeight: 600 }}>✓ Pass</span>}
                  {bill.has_public_hearing && <span style={{ marginLeft: 8, color: 'var(--teal-mid)' }}>● Hearing</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
        <Nav/>
      </div>
    )
  }

  // ── MEMBERS LIST VIEW ────────────────────────────────
  return (
    <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', marginBottom: 4, textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>
          Members
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          {filtered.length} legislators · {SESSION}
        </div>

        <div style={{ position: 'relative', marginBottom: 10 }}>
          <svg style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name..."
            style={{
              width: '100%', padding: '9px 12px 9px 32px',
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 8, fontSize: 13,
              color: 'var(--text-primary)', outline: 'none',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}>
          {['All', 'House', 'Senate'].map(c => (
            <button key={c} onClick={() => setChamber(c)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: chamber === c ? 'var(--bg-surface)' : 'transparent',
              color: chamber === c ? 'var(--text-primary)' : 'var(--text-muted)',
              border: `1px solid ${chamber === c ? 'var(--border-light)' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{c}</button>
          ))}
          <div style={{ width: 1, background: 'var(--border)', margin: '0 2px' }}/>
          {['All', 'D', 'R'].map(p => (
            <button key={p} onClick={() => setParty(p)} style={{
              padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
              background: party === p ? (p === 'D' ? 'rgba(30,100,200,0.2)' : p === 'R' ? 'rgba(200,50,50,0.2)' : 'var(--bg-surface)') : 'transparent',
              color: party === p ? (p === 'D' ? '#4d9aff' : p === 'R' ? '#ff6b6b' : 'var(--text-primary)') : 'var(--text-muted)',
              border: `1px solid ${party === p ? 'transparent' : 'var(--border)'}`,
              cursor: 'pointer', transition: 'all 0.15s',
            }}>{p === 'D' ? 'Dem' : p === 'R' ? 'Rep' : 'All'}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading members...</div>
        ) : filtered.map((member, idx) => {
          const scoreColor = member.avg_score >= 50 ? 'var(--teal)' : member.avg_score >= 35 ? 'var(--gold)' : 'var(--text-muted)'
          return (
            <div
              key={member.name}
              onClick={() => selectMember(member)}
              style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '12px 14px',
                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12,
                transition: 'border-color 0.2s',
                animation: `fadeUp 0.25s ease ${Math.min(idx * 0.02, 0.5)}s both`,
              }}
              onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
              onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
            >
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: member.party === 'D' ? 'rgba(30,100,200,0.12)' : member.party === 'R' ? 'rgba(200,50,50,0.12)' : 'var(--bg-surface)',
                border: `1.5px solid ${member.party === 'D' ? 'rgba(77,154,255,0.3)' : member.party === 'R' ? 'rgba(255,107,107,0.3)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 12, fontWeight: 700,
                color: member.party === 'D' ? '#4d9aff' : member.party === 'R' ? '#ff6b6b' : 'var(--text-muted)',
              }}>
                {member.name.split(' ').map(n => n[0]).slice(-2).join('')}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{member.name}</span>
                  {member.is_chair && (
                    <span style={{ fontSize: 8, padding: '1px 5px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(184,151,90,0.25)', borderRadius: 6 }}>
                      Chair
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                  {member.chamber === 'House' ? 'House' : 'Senate'} ·{' '}
                  {member.party === 'D' ? 'Democrat' : member.party === 'R' ? 'Republican' : member.party}
                </div>
              </div>

              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: scoreColor, textShadow: scoreColor === 'var(--teal)' ? '0 0 6px rgba(184,151,90,0.3)' : 'none' }}>
                  {member.avg_score}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                  avg · {member.bill_count} bills
                </div>
              </div>

              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          )
        })}
      </div>
      <Nav/>
    </div>
  )
}
