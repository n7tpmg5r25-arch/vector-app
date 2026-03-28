'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../lib/supabase'
import Nav from '../components/Nav'
import ScoreBadge from '../components/ScoreBadge'

export default function WatchlistPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [watched, setWatched] = useState([])
  const [clients, setClients] = useState([])
  const [activeClient, setActiveClient] = useState('All')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('tracked_bills')
        .select(`
          bill_id, client_tag, notes, created_at,
          bills (
            bill_id, bill_number, title, final_score,
            stage, chamber, committee_name,
            has_public_hearing, committee_passed,
            hearing_date, status
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

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

  const sorted = [...filtered].sort((a, b) =>
    (b.bills?.final_score || 0) - (a.bills?.final_score || 0))

  return (
    <div style={{ paddingBottom: 100 }}>
      <div style={{
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        padding: '52px 20px 16px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700,
          color: 'var(--green-dark)', marginBottom: 4,
        }}>Watchlist</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {watched.length} bill{watched.length !== 1 ? 's' : ''} tracked
        </div>
        {clients.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 14, overflowX: 'auto', paddingBottom: 4 }}>
            {['All', ...clients].map(c => (
              <button key={c} onClick={() => setActiveClient(c)} style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 12,
                fontWeight: 500, flexShrink: 0,
                background: activeClient === c ? 'var(--green-dark)' : 'var(--bg)',
                color: activeClient === c ? 'white' : 'var(--text-muted)',
                border: `1px solid ${activeClient === c ? 'var(--green-dark)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>{c}</button>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : sorted.length === 0 ? (
          <div style={{ padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>📋</div>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 18,
              color: 'var(--green-dark)', marginBottom: 8, fontWeight: 600,
            }}>No bills watched yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
              Browse bills and tap Watch to add them here.
            </div>
            <button onClick={() => router.push('/search')} style={{
              padding: '10px 24px', background: 'var(--green-dark)', color: 'white',
              border: 'none', borderRadius: 'var(--radius)', fontSize: 14,
              fontWeight: 500, cursor: 'pointer',
            }}>Browse Bills</button>
          </div>
        ) : sorted.map(({ bill_id, client_tag, notes, bills: bill }) => (
          <div key={bill_id}
            onClick={() => router.push(`/bill/${bill.bill_id}`)}
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px', cursor: 'pointer',
            }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <ScoreBadge score={bill.final_score} size="md"/>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 11, fontFamily: 'var(--font-mono)',
                    color: 'var(--text-muted)', fontWeight: 500,
                  }}>{bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}</span>
                  {client_tag && (
                    <span style={{
                      fontSize: 10, padding: '1px 8px',
                      background: 'var(--gold-pale)', color: 'var(--gold)',
                      border: '1px solid var(--gold)', borderRadius: 10, fontWeight: 500,
                    }}>{client_tag}</span>
                  )}
                </div>
                <div style={{
                  fontSize: 14, fontWeight: 500, color: 'var(--text-primary)',
                  lineHeight: 1.3, marginBottom: 6,
                }}>{bill.title || bill.committee_name || 'Bill ' + bill.bill_number}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {bill.has_public_hearing && (
                    <span style={{ fontSize: 10, color: 'var(--green-mid)', fontFamily: 'var(--font-mono)' }}>● Hearing</span>
                  )}
                  {bill.committee_passed && (
                    <span style={{ fontSize: 10, color: 'var(--green-dark)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>✓ Comm. Pass</span>
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
              <div style={{ fontSize: 18, color: 'var(--gold)' }}>🔖</div>
            </div>
          </div>
        ))}
      </div>
      <Nav/>
    </div>
  )
}
