'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import Nav from '../../components/Nav'
import ScoreBadge from '../../components/ScoreBadge'

export default function WatchlistPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [watched, setWatched]       = useState([])
  const [clients, setClients]       = useState([])
  const [activeClient, setActiveClient] = useState('All')
  const [sortBy, setSortBy]         = useState('score')
  const [atRiskOnly, setAtRiskOnly] = useState(false)
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('tracked_bills')
        .select(`
          bill_id, client_tag, notes, added_at,
          bills (
            bill_id, bill_number, title, final_score,
            stage, chamber, category, committee_name,
            has_public_hearing, committee_passed,
            hearing_date, days_to_cutoff, status, stalled,
            prime_sponsor, prime_party, bipartisan
          )
        `)
        .eq('user_id', user.id)
        .order('added_at', { ascending: false })

      const items = (data || []).filter(d => d.bills)
      setWatched(items)

      const allClients = [...new Set(items.map(d => d.client_tag).filter(Boolean))]
      setClients(allClients)
      setLoading(false)
    }
    load()
  }, [])

  const clientFiltered = activeClient === 'All'
    ? watched
    : watched.filter(d => d.client_tag === activeClient)
  const filtered = atRiskOnly
    ? clientFiltered.filter(d => (d.bills?.final_score || 0) < 25 || d.bills?.stalled)
    : clientFiltered

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'score') return (b.bills?.final_score || 0) - (a.bills?.final_score || 0)
    if (sortBy === 'added') return new Date(b.added_at) - new Date(a.added_at)
    if (sortBy === 'name') return (a.bills?.title || '').localeCompare(b.bills?.title || '')
    return 0
  })

  const scores = filtered.map(d => d.bills?.final_score ?? 0).filter(s => s != null)
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  const highCount = filtered.filter(d => (d.bills?.final_score || 0) >= 50).length
  const hearingCount = filtered.filter(d => d.bills?.has_public_hearing).length

  const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp.Ch.', 'Conf.', 'Signed']

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{
        background: 'rgba(8,12,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(0,229,204,0.2)' }}>
            Watchlist
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {filtered.length} bills
          </div>
        </div>

        {filtered.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {[
              { label: 'Avg Score', value: avgScore, color: avgScore >= 45 ? 'var(--teal)' : avgScore >= 30 ? 'var(--gold)' : 'var(--text-muted)' },
              { label: 'High Score', value: highCount, color: highCount > 0 ? 'var(--teal)' : 'var(--text-muted)' },
              { label: 'Hearings', value: hearingCount, color: hearingCount > 0 ? 'var(--teal-mid)' : 'var(--text-muted)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color, textShadow: color === 'var(--teal)' ? '0 0 8px rgba(0,229,204,0.3)' : 'none' }}>{value}</span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {clients.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
            {['All', ...clients].map(c => (
              <button key={c} onClick={() => setActiveClient(c)} style={{
                padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
                background: activeClient === c ? 'var(--teal)' : 'transparent',
                color: activeClient === c ? 'var(--bg)' : 'var(--text-muted)',
                border: `1px solid ${activeClient === c ? 'var(--teal)' : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: activeClient === c ? 'var(--teal-glow)' : 'none',
              }}>{c}</button>
            ))}
          </div>
        )}

        {filtered.length > 1 && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            {[['score', 'By Score'], ['added', 'Recently Added'], ['name', 'A–Z']].map(([val, label]) => (
              <button key={val} onClick={() => setSortBy(val)} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 10, flexShrink: 0,
                background: sortBy === val ? 'var(--bg-surface)' : 'transparent',
                color: sortBy === val ? 'var(--text-primary)' : 'var(--text-faint)',
                border: `1px solid ${sortBy === val ? 'var(--border)' : 'transparent'}`,
                cursor: 'pointer',
              }}>{label}</button>
            ))}
            <div style={{ width: 1, height: 16, background: 'var(--border)', margin: '0 2px' }}/>
            <button onClick={() => setAtRiskOnly(!atRiskOnly)} style={{
              padding: '3px 10px', borderRadius: 12, fontSize: 10, flexShrink: 0,
              background: atRiskOnly ? 'var(--danger-pale)' : 'transparent',
              color: atRiskOnly ? 'var(--danger)' : 'var(--text-faint)',
              border: `1px solid ${atRiskOnly ? 'rgba(255,82,82,0.3)' : 'transparent'}`,
              cursor: 'pointer', fontWeight: atRiskOnly ? 600 : 400,
              boxShadow: atRiskOnly ? 'var(--danger-glow)' : 'none',
            }}>⚠ At Risk</button>
          </div>
        )}
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16, filter: 'grayscale(0.5)' }}>📋</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--teal)', marginBottom: 8, fontWeight: 600 }}>
              No bills tracked yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Search bills and tap + Watch to add them here.
            </div>
            <button onClick={() => router.push('/search')} style={{
              padding: '10px 24px', background: 'var(--teal)', color: 'var(--bg)',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
              boxShadow: 'var(--teal-glow)',
            }}>Browse Bills</button>
          </div>
        ) : sorted.map(({ bill_id, client_tag, notes, bills: bill }, idx) => (
          <div
            key={bill_id}
            onClick={() => router.push(`/bill/${bill.bill_id}`)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px',
              cursor: 'pointer', transition: 'border-color 0.2s',
              borderLeft: bill.stalled ? '3px solid var(--danger)' : (bill.final_score >= 50 ? '3px solid var(--teal)' : '1px solid var(--border)'),
              animation: `fadeUp 0.3s ease ${idx * 0.03}s both`,
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(0,229,204,0.3)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <ScoreBadge score={bill.final_score} size="md"/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', fontWeight: 500 }}>
                    {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
                    {STAGE_SHORT[bill.stage] || 'Intro'}
                  </span>
                  {client_tag && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid rgba(212,168,75,0.25)', borderRadius: 10, fontWeight: 500 }}>
                      {client_tag}
                    </span>
                  )}
                  {bill.stalled && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--danger-pale)', color: 'var(--danger)', border: '1px solid rgba(255,82,82,0.25)', borderRadius: 10 }}>
                      Stalled
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 6 }}>
                  {bill.title || bill.committee_name || 'Bill ' + bill.bill_number}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {bill.has_public_hearing && (
                    <span style={{ fontSize: 9, color: 'var(--teal-mid)', fontFamily: 'var(--font-mono)' }}>● HEARING</span>
                  )}
                  {bill.committee_passed && (
                    <span style={{ fontSize: 9, color: 'var(--teal)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>✓ CMTE PASS</span>
                  )}
                  {bill.bipartisan && (
                    <span style={{ fontSize: 9, color: 'var(--teal-mid)', fontFamily: 'var(--font-mono)' }}>Bipartisan</span>
                  )}
                </div>
                {notes && (
                  <div style={{
                    fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic',
                    marginTop: 6, lineHeight: 1.4,
                    borderLeft: '2px solid var(--border)', paddingLeft: 8,
                  }}>{notes}</div>
                )}
              </div>
              <div style={{ fontSize: 14, color: 'var(--gold)', flexShrink: 0, filter: 'drop-shadow(0 0 4px rgba(212,168,75,0.3))' }}>🔖</div>
            </div>
          </div>
        ))}
      </div>
      <Nav/>
    </div>
  )
}
