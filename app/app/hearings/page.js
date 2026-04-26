'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { isInterimPeriod, getNextBiennium, getCurrentBiennium, formatSessionDate } from '../../lib/session-config'
import { useSession } from '../../lib/useSession'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import ScoreBadge from '../components/ScoreBadge'

export default function HearingsPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [SESSION] = useSession()
  // Phase 12 Batch 3: auth state via the capabilities helper, not ad-hoc getUser().
  // Batch 6 adds `publicLayerEnabled` + `isAnonPublic` for the PublicNav swap
  // + Subscribe gating.
  const { user, capabilities, loading: viewerLoading, publicLayerEnabled } = useViewer()
  // Thread 15.2: gate isAnonPublic on !viewerLoading to stop the brief flash
  // of PublicNav (and bottom-Nav suppression) for authed viewers during the
  // useViewer() loading window.
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  const [hearings, setHearings]     = useState([])
  const [billHearings, setBillHearings] = useState([])
  const [watchedIds, setWatchedIds] = useState(new Set())
  const [loading, setLoading]       = useState(true)
  const [chamber, setChamber]       = useState('All')
  const [view, setView]             = useState('upcoming')
  const [calCopied, setCalCopied]   = useState(false)
  const isInterim = typeof window !== 'undefined' ? isInterimPeriod() : true

  useEffect(() => {
    if (viewerLoading) return
    async function load() {
      if (user) {
        const { data: wl } = await supabase
          .from('tracked_bills')
          .select('bill_id')
          .eq('user_id', user.id)
        setWatchedIds(new Set((wl || []).map(w => w.bill_id)))
      }

      const { data: hearingRows } = await supabase
        .from('hearings')
        .select(`
          id, committee_name, hearing_date, location, tvw_link, testimony_deadline, session,
          bill_id,
          bills(bill_id, bill_number, title, final_score, chamber, committee_name, stage)
        `)
        .order('hearing_date', { ascending: true })
        .limit(100)

      setHearings((hearingRows || []).filter(h => h.bills))

      const { data: billRows } = await supabase
        .from('bills')
        .select('bill_id, bill_number, title, final_score, stage, chamber, committee_name, hearing_date, has_public_hearing, committee_passed, prime_sponsor, prime_party')
        .eq('session', SESSION)
        .eq('has_public_hearing', true)
        .not('hearing_date', 'is', null)
        .order('final_score', { ascending: false })
        .limit(200)

      setBillHearings(billRows || [])
      setLoading(false)
    }
    load()
  }, [user?.id, viewerLoading])

  const filteredBillHearings = billHearings.filter(b => {
    if (chamber !== 'All' && b.chamber !== chamber) return false
    return true
  })

  const watchedHearings = filteredBillHearings.filter(b => watchedIds.has(b.bill_id))
  const allHearings = filteredBillHearings
  const displayBills = view === 'watched' ? watchedHearings : allHearings

  function formatDate(dateStr) {
    if (!dateStr) return '—'
    try {
      return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    } catch { return dateStr }
  }

  return (
    <div style={{ paddingBottom: 20, fontFamily: 'var(--font-body)' }}>
      {/* Phase 12 Batch 6 — PublicNav for anon when flag is on */}
      {isAnonPublic && <PublicNav />}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 16px 14px' : '52px 16px 14px',
        position: 'sticky', top: isAnonPublic ? 60 : 0, zIndex: 40,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--teal)', textShadow: '0 0 16px rgba(184,151,90,0.2)' }}>
            Hearings
          </div>
          {/* Phase 12 Batch 6 — Subscribe requires an auth session token to
              sign the webcal:// URL. Hidden from anon visitors entirely. */}
          {user && (
            <a
              href="#"
              onClick={async (e) => {
                e.preventDefault()
                const { data: { session: sess } } = await supabase.auth.getSession()
                if (!sess?.access_token) { alert('Please log in to subscribe.'); return }
                const base = window.location.origin
                window.location.href = `webcal://${base.replace(/^https?:\/\//, '')}/api/calendar/hearings.ics?token=${sess.access_token}`
              }}
              style={{
                padding: '4px 12px', borderRadius: 14, fontSize: 10, fontWeight: 600,
                background: 'transparent', color: 'var(--gold)',
                border: '1px solid rgba(184,151,90,0.35)',
                cursor: 'pointer', transition: 'all 0.15s',
                display: 'flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--font-mono)', textDecoration: 'none',
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
              </svg>
              Subscribe
            </a>
          )}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          Committee schedules · WA Legislature
        </div>

        {isInterim && (() => {
          const next = (typeof window !== 'undefined' ? getNextBiennium() : null) || { session: '2027-2028', start: '2027-01-11' }
          const cur  = (typeof window !== 'undefined' ? getCurrentBiennium() : null) || { session: '2025-2026' }
          const nextSession = next?.session || 'next'
          const curSession  = cur?.session  || 'current'
          return (
            <div style={{
              background: 'var(--gold-pale)', border: '1px solid rgba(184,151,90,0.25)',
              borderRadius: 8, padding: '10px 12px', marginBottom: 12,
              fontSize: 11, color: 'var(--gold)', fontWeight: 500,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ boxShadow: 'var(--gold-glow)', width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', display: 'inline-block', flexShrink: 0 }}/>
                <span>WA Legislature is in interim. Hearings resume when the {nextSession} session opens {formatSessionDate(next?.start)}.</span>
              </div>
              <div style={{ paddingLeft: 12, color: 'var(--text-muted)', fontWeight: 400, lineHeight: 1.5 }}>
                {curSession} bills that didn't pass are dead. The {nextSession} biennium begins {formatSessionDate(next?.start)}.
              </div>
            </div>
          )
        })()}

        {/* Phase 12 Batch 6 — hide the Upcoming/Watched toggle for anon
            visitors (no watchlist exists without a login). */}
        {user && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {['upcoming', 'watched'].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '5px 14px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                background: view === v ? 'var(--teal)' : 'transparent',
                color: view === v ? 'var(--bg)' : 'var(--text-muted)',
                border: `1px solid ${view === v ? 'var(--teal)' : 'var(--border)'}`,
                cursor: 'pointer', transition: 'all 0.15s',
                boxShadow: view === v ? 'var(--teal-glow)' : 'none',
              }}>
                {v === 'upcoming' ? `All (${allHearings.length})` : `Watched (${watchedHearings.length})`}
              </button>
            ))}
          </div>
        )}

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
        </div>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>

        {hearings.length > 0 && (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              Scheduled Hearings
            </div>
            {hearings.map(h => (
              <Link
                key={h.id}
                href={`/bill/${h.bill_id}`}
                prefetch={false}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 7,
                  cursor: 'pointer', transition: 'border-color 0.2s',
                  display: 'block', textDecoration: 'none', color: 'inherit',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <ScoreBadge score={h.bills?.final_score} size="sm"/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: 2 }}>
                      {h.bills?.chamber === 'House' ? 'HB' : 'SB'} {h.bills?.bill_number}
                      {watchedIds.has(h.bill_id) && <span style={{ marginLeft: 6, color: 'var(--gold)' }}>🔖</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4 }}>
                      {h.bills?.title || h.bills?.committee_name || `Bill ${h.bills?.bill_number}`}
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>
                        📅 {formatDate(h.hearing_date)}
                      </span>
                      {h.committee_name && (
                        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{h.committee_name}</span>
                      )}
                      {h.tvw_link && (
                        <button
                          type="button"
                          onClick={e => { e.preventDefault(); e.stopPropagation(); window.open(h.tvw_link, '_blank', 'noopener,noreferrer') }}
                          style={{ fontSize: 10, color: 'var(--teal-mid)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                        >
                          TVW →
                        </button>
                      )}
                    </div>
                    {h.testimony_deadline && (
                      <div style={{ fontSize: 10, color: 'var(--gold)', marginTop: 3 }}>
                        Testimony deadline: {formatDate(h.testimony_deadline)}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {loading ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>Loading...</div>
        ) : isInterim && hearings.length === 0 && displayBills.length === 0 ? (
          /* 6B.5: Full interim empty state when hearings table has no data */
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>📅</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--teal)', marginBottom: 10 }}>
              Legislature is in interim
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
              Committee hearings will resume when the {(() => { const n = (typeof window !== 'undefined' ? getNextBiennium() : null) || { session: '2027-2028', start: '2027-01-11' }; return `${n?.session || 'next'} session convenes on ${formatSessionDate(n?.start)}`; })()}.
              {(() => { const n = (typeof window !== 'undefined' ? getNextBiennium() : null) || { prefilingOpens: '2026-12-01' }; return n?.prefilingOpens ? ` Pre-filing opens ${formatSessionDate(n.prefilingOpens)}.` : ''; })()}
            </div>
            <button
              onClick={() => typeof window !== 'undefined' && (window.location.href = '/outcomes')}
              style={{
                marginTop: 16, padding: '8px 20px',
                background: 'var(--teal)', color: 'var(--bg)',
                border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                boxShadow: 'var(--teal-glow)',
              }}
            >View session outcomes</button>
          </div>
        ) : displayBills.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
          }}>
            <div style={{ fontSize: 28, marginBottom: 12, filter: 'grayscale(0.5)' }}>📅</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, color: 'var(--teal)', marginBottom: 8 }}>
              {view === 'watched' ? 'No watched bills had hearings' : 'No hearings found'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {view === 'watched'
                ? 'Add bills to your watchlist to track their hearings here.'
                : `Hearing data will populate when the ${(typeof window !== 'undefined' ? getNextBiennium()?.session : null) || '2027-2028'} session opens.`}
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
              {SESSION} · Bills with Hearings ({displayBills.length})
            </div>
            {displayBills.map((bill, idx) => (
              <Link
                key={bill.bill_id}
                href={`/bill/${bill.bill_id}`}
                prefetch={false}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 6,
                  cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 12,
                  transition: 'border-color 0.2s',
                  borderLeft: watchedIds.has(bill.bill_id) ? '3px solid var(--gold)' : '1px solid var(--border)',
                  animation: `fadeUp 0.3s ease ${idx * 0.02}s both`,
                  textDecoration: 'none', color: 'inherit',
                }}
                onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(184,151,90,0.3)'}
                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
              >
                <ScoreBadge score={bill.final_score} size="sm"/>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}
                    </span>
                    {watchedIds.has(bill.bill_id) && <span style={{ color: 'var(--gold)', fontSize: 10 }}>🔖</span>}
                    {bill.committee_passed && (
                      <span style={{ fontSize: 8, padding: '1px 6px', background: 'var(--teal-pale)', color: 'var(--teal)', border: '1px solid rgba(184,151,90,0.2)', borderRadius: 8, fontWeight: 600 }}>
                        ✓ Pass
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    {bill.hearing_date && (
                      <span style={{ fontSize: 10, color: 'var(--teal)', fontFamily: 'var(--font-mono)' }}>
                        📅 {formatDate(bill.hearing_date)}
                      </span>
                    )}
                    <span style={{ fontSize: 10, color: 'var(--text-faint)' }}>
                      {bill.committee_name || 'No committee assigned'}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {!viewerLoading && !isAnonPublic && <Nav/>}
    </div>
  )
}
