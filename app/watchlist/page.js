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
  const [sortBy, setSortBy]         = useState('score') // 'score' | 'added' | 'name'
  const [loading, setLoading]       = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Note: column is added_at (not created_at)
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

  const filtered = activeClient === 'All'
    ? watched
    : watched.filter(d => d.client_tag === activeClient)

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'score') return (b.bills?.final_score || 0) - (a.bills?.final_score || 0)
    if (sortBy === 'added') return new Date(b.added_at) - new Date(a.added_at)
    if (sortBy === 'name') return (a.bills?.title || '').localeCompare(b.bills?.title || '')
    return 0
  })

  // Summary stats
  const scores = filtered.map(d => d.bills?.final_score || 0).filter(Boolean)
  const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0
  const highCount = filtered.filter(d => (d.bills?.final_score || 0) >= 50).length
  const hearingCount = filtered.filter(d => d.bills?.has_public_hearing).length

  const STAGE_SHORT = ['', 'Intro', 'Cmte', 'Floor', 'Opp.Ch.', 'Conf.', 'Signed']

  return (
    <div style={{ paddingBottom: 110, fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{
        background: 'var(--bg-card)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--green-dark)' }}>
            Watchlist
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {filtered.length} bills
          </div>
        </div>

        {/* Stats row — only when bills exist */}
        {filtered.length > 0 && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
            {[
              { label: 'Avg Score', value: avgScore, color: avgScore >= 45 ? 'var(--green-dark)' : avgScore >= 30 ? 'var(--gold)' : 'var(--text-muted)' },
              { label: 'High Score', value: highCount, color: highCount > 0 ? 'var(--green-dark)' : 'var(--text-muted)' },
              { label: 'Hearings', value: hearingCount, color: hearingCount > 0 ? 'var(--green-mid)' : 'var(--text-muted)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color }}>{value}</span>
                <span style={{ fontSize: 9, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Client filter */}
        {clients.length > 0 && (
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4, marginBottom: 10 }}>
            {['All', ...clients].map(c => (
              <button key={c} onClick={() => setActiveClient(c)} style={{
                padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500, flexShrink: 0,
                background: activeClient === c ? 'var(--green-dark)' : 'var(--bg)',
                color: activeClient === c ? 'white' : 'var(--text-muted)',
                border: `1px solid ${activeClient === c ? 'var(--green-dark)' : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
              }}>{c}</button>
            ))}
          </div>
        )}

        {/* Sort */}
        {filtered.length > 1 && (
          <div style={{ display: 'flex', gap: 6 }}>
            {[['score', 'By Score'], ['added', 'Recently Added'], ['name', 'A–Z']].map(([val, label]) => (
              <button key={val} onClick={() => setSortBy(val)} style={{
                padding: '3px 10px', borderRadius: 12, fontSize: 10, flexShrink: 0,
                background: sortBy === val ? 'var(--bg-card-2)' : 'transparent',
                color: sortBy === val ? 'var(--text-primary)' : 'var(--text-faint)',
                border: `1px solid ${sortBy === val ? 'var(--border)' : 'transparent'}`,
                cursor: 'pointer',
              }}>{label}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📋</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--green-dark)', marginBottom: 8, fontWeight: 600 }}>
              No bills tracked yet
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Search bills and tap + Watch to add them here.
            </div>
            <button onClick={() => router.push('/search')} style={{
              padding: '10px 24px', background: 'var(--green-dark)', color: 'white',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 13, fontWeight: 500, cursor: 'pointer',
            }}>Browse Bills</button>
          </div>
        ) : sorted.map(({ bill_id, client_tag, notes, bills: bill }) => (
          <div
            key={bill_id}
            onClick={() => router.push(`/bill/${bill.bill_id}`)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px',
              cursor: 'pointer', transition: 'box-shadow 0.15s',
              borderLeft: bill.stalled ? '3px solid var(--danger)' : (bill.final_score >= 50 ? '3px solid var(--green-dark)' : '1px solid var(--border)'),
            }}
            onMouseEnter={e => e.currentTarget.style.boxShadow = 'var(--shadow-sm)'}
            onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
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
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--gold-pale)', color: 'var(--gold)', border: '1px solid var(--gold)', borderRadius: 10, fontWeight: 500 }}>
                      {client_tag}
                    </span>
                  )}
                  {bill.stalled && (
                    <span style={{ fontSize: 9, padding: '1px 7px', background: 'var(--danger-pale)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 10 }}>
                      Stalled
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 6 }}>
                  {bill.title || bill.committee_name || 'Bill ' + bill.bill_number}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {bill.has_public_hearing && (
                    <span style={{ fontSize: 9, color: 'var(--green-mid)', fontFamily: 'var(--font-mono)' }}>● HEARING</span>
                  )}
                  {bill.committee_passed && (
                    <span style={{ fontSize: 9, color: 'var(--green-dark)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>✓ CMTE PASS</span>
                  )}
                  {bill.bipartisan && (
                    <span style={{ fontSize: 9, color: 'var(--green-mid)', fontFamily: 'var(--font-mono)' }}>Bipartisan</span>
                  )}
                  {bill.hearing_date && (
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
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
              <div style={{ fontSize: 16, color: 'var(--gold)', flexShrink: 0 }}>🔖</div>
            </div>
          </div>
        ))}
      </div>
      <Nav/>
    </div>
  )
}
