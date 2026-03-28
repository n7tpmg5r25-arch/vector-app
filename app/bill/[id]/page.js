'use client'
import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import ScoreBadge from '../../components/ScoreBadge'

const STAGE_LABELS = ['','Introduced','Committee','Floor','Opp. Chamber','Conference','Signed']

export default function BillDetailPage() {
  const router = useRouter()
  const params = useParams()
  const billId = params.id
  const supabase = createBrowserClient()

  const [bill, setBill] = useState(null)
  const [snapshots, setSnapshots] = useState([])
  const [tracked, setTracked] = useState(null)
  const [tab, setTab] = useState('trajectory')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState('')
  const [clientTag, setClientTag] = useState('')
  const [user, setUser] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: { user } } = await supabase.auth.getUser()
      setUser(user)

      const { data: billData } = await supabase
        .from('bills').select('*')
        .eq('bill_id', billId).single()
      setBill(billData)

      const { data: snapData } = await supabase
        .from('trajectory_snapshots')
        .select('snapshot_date,score,stage,pass_probability')
        .eq('bill_id', billId)
        .order('snapshot_date', { ascending: true })
        .limit(30)
      setSnapshots(snapData || [])

      if (user) {
        const { data: trackData } = await supabase
          .from('tracked_bills').select('*')
          .eq('bill_id', billId).eq('user_id', user.id).single()
        if (trackData) {
          setTracked(trackData)
          setNotes(trackData.notes || '')
          setClientTag(trackData.client_tag || '')
        }
      }
      setLoading(false)
    }
    load()
  }, [billId])

  async function toggleWatch() {
    if (!user) return
    setSaving(true)
    if (tracked) {
      await supabase.from('tracked_bills')
        .delete().eq('bill_id', billId).eq('user_id', user.id)
      setTracked(null)
    } else {
      const { data } = await supabase.from('tracked_bills')
        .insert({ bill_id: billId, user_id: user.id, notes, client_tag: clientTag })
        .select().single()
      setTracked(data)
    }
    setSaving(false)
  }

  async function saveNotes() {
    if (!user || !tracked) return
    setSaving(true)
    await supabase.from('tracked_bills')
      .update({ notes, client_tag: clientTag })
      .eq('bill_id', billId).eq('user_id', user.id)
    setSaving(false)
  }

  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font-body)' }}>
      Loading...
    </div>
  )
  if (!bill) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)', fontFamily: 'var(--font-body)' }}>
      Bill not found.
    </div>
  )

  const score = bill.final_score || 0
  const passPct = Math.round((bill.pass_probability || 0) * 100)
  const scoreColor = score >= 60 ? 'var(--green-dark)'
    : score >= 45 ? 'var(--green-mid)'
    : score >= 30 ? 'var(--gold)'
    : 'var(--text-muted)'

  const sparkScores = snapshots.map(s => s.score).filter(Boolean)
  const sparkMax = Math.max(...sparkScores, score, 1)
  const sparkMin = Math.min(...sparkScores, 0)
  const xfFactors = bill.xf_factors || []

  return (
    <div style={{ paddingBottom: 80, fontFamily: 'var(--font-body)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '52px 16px 12px',
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)',
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button onClick={() => router.back()} style={{
          background: 'none', border: 'none',
          fontSize: 14, color: 'var(--green-mid)', fontWeight: 500, cursor: 'pointer',
        }}>← Back</button>
        <button onClick={toggleWatch} disabled={saving} style={{
          padding: '7px 16px',
          background: tracked ? 'var(--gold-pale)' : 'var(--green-pale)',
          border: `1px solid ${tracked ? 'var(--gold)' : 'var(--green-light)'}`,
          borderRadius: 20, fontSize: 12, fontWeight: 600,
          color: tracked ? 'var(--gold)' : 'var(--green-dark)',
          cursor: 'pointer',
        }}>{tracked ? '🔖 Watching' : '+ Watch'}</button>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Identity */}
        <div>
          <div style={{
            fontSize: 11, fontFamily: 'var(--font-mono)',
            color: 'var(--text-muted)', marginBottom: 6,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span>{bill.chamber === 'House' ? 'HB' : 'SB'} {bill.bill_number}</span>
            {bill.bipartisan && (
              <span style={{
                fontSize: 9, padding: '2px 8px',
                background: 'var(--green-pale)', color: 'var(--green-mid)',
                border: '1px solid var(--green-light)', borderRadius: 10,
              }}>Bipartisan</span>
            )}
          </div>
          <div style={{
            fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600,
            color: 'var(--text-primary)', lineHeight: 1.35, marginBottom: 12,
          }}>{bill.title || bill.committee_name || `Bill ${bill.bill_number}`}</div>

          {/* Score card */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 16,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '14px 16px',
          }}>
            <ScoreBadge score={score} size="lg"/>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 10, color: 'var(--text-faint)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
              }}>Trajectory Score</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 28,
                  fontWeight: 700, color: scoreColor,
                }}>{score}</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ 100</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {passPct}% pass probability · {bill.confidence_label || 'MODERATE'} confidence
              </div>
            </div>
          </div>
        </div>

        {/* Stage pipeline */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '14px 16px',
        }}>
          <div style={{
            fontSize: 10, color: 'var(--text-faint)',
            letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12,
          }}>Legislative Stage</div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {STAGE_LABELS.slice(1).map((lbl, i) => {
              const stageNum = i + 1
              const done = stageNum < bill.stage
              const active = stageNum === bill.stage
              const c = done ? 'var(--green-light)' : active ? 'var(--green-dark)' : 'var(--border)'
              return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < 5 ? 1 : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <div style={{
                      width: active ? 10 : 7, height: active ? 10 : 7,
                      borderRadius: '50%', background: c,
                      boxShadow: active ? '0 0 0 3px var(--green-pale)' : 'none',
                    }}/>
                    <span style={{
                      fontSize: 7, textAlign: 'center', whiteSpace: 'nowrap',
                      color: active ? 'var(--green-dark)' : done ? 'var(--green-light)' : 'var(--text-faint)',
                      fontWeight: active ? 600 : 400,
                    }}>{lbl}</span>
                  </div>
                  {i < 5 && <div style={{
                    flex: 1, height: 1, margin: '0 2px', marginBottom: 14,
                    background: done ? 'var(--green-light)' : 'var(--border)',
                  }}/>}
                </div>
              )
            })}
          </div>
        </div>

        {/* Info grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[
            { label: 'Committee', value: bill.committee_name || '—' },
            { label: 'Prime Sponsor', value: bill.prime_sponsor || '—' },
            { label: 'Hearing', value: bill.hearing_date
              ? new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : 'None scheduled' },
            { label: 'Days to Cutoff', value: bill.days_to_cutoff > 0 ? `${bill.days_to_cutoff}d` : 'Past' },
            { label: 'Fiscal Note', value: bill.fiscal_note_size
              ? bill.fiscal_note_size.charAt(0).toUpperCase() + bill.fiscal_note_size.slice(1)
              : '—' },
            { label: 'Status', value: bill.status || '—' },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '10px 12px',
            }}>
              <div style={{
                fontSize: 9, color: 'var(--text-faint)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4,
              }}>{label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, lineHeight: 1.3 }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        {/* X Factor pills */}
        {xfFactors.length > 0 && (
          <div>
            <div style={{
              fontSize: 10, color: 'var(--text-faint)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
            }}>X Factor Signals</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {xfFactors.map((f, i) => (
                <div key={i} style={{
                  padding: '5px 12px', borderRadius: 16, fontSize: 11, fontWeight: 500,
                  background: f.pos ? 'var(--green-pale)' : 'var(--danger-pale)',
                  color: f.pos ? 'var(--green-dark)' : 'var(--danger)',
                  border: `1px solid ${f.pos ? 'var(--green-light)' : 'var(--danger)'}`,
                }}>
                  {f.pos ? '▲' : '▼'} {f.l} {f.d > 0 ? '+' : ''}{Math.round(f.d * 100)}%
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div>
          <div style={{
            display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 16,
          }}>
            {['trajectory', 'signals', 'confidence'].map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                padding: '8px 16px', background: 'none', border: 'none',
                borderBottom: tab === t ? '2px solid var(--green-dark)' : '2px solid transparent',
                fontSize: 12, fontWeight: tab === t ? 600 : 400,
                color: tab === t ? 'var(--green-dark)' : 'var(--text-muted)',
                cursor: 'pointer', textTransform: 'capitalize', marginBottom: -1,
              }}>{t}</button>
            ))}
          </div>

          {tab === 'trajectory' && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '16px',
            }}>
              <div style={{
                fontSize: 10, color: 'var(--text-faint)',
                letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12,
              }}>Score History · {sparkScores.length} snapshots</div>
              {sparkScores.length > 1 ? (
                <svg width="100%" height="80" viewBox={`0 0 ${sparkScores.length} 80`} preserveAspectRatio="none">
                  <polyline
                    points={sparkScores.map((s, i) =>
                      `${i},${80 - ((s - sparkMin) / (sparkMax - sparkMin + 1)) * 70}`
                    ).join(' ')}
                    fill="none" stroke="var(--green-mid)" strokeWidth="1.5"
                    strokeLinecap="round" strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <div style={{ fontSize: 13, color: 'var(--text-faint)', padding: '20px 0', textAlign: 'center' }}>
                  More data after multiple sync cycles
                </div>
              )}
            </div>
          )}

          {tab === 'signals' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { label: 'Committee', value: bill.committee_score, max: 25, color: 'var(--green-dark)' },
                { label: 'Sponsor', value: bill.sponsor_score, max: 20, color: 'var(--green-mid)' },
                { label: 'Momentum', value: bill.momentum_score, max: 20, color: 'var(--gold)' },
                { label: 'Historical', value: bill.historical_score, max: 20, color: 'var(--green-light)' },
                { label: 'Fiscal', value: bill.fiscal_score, max: 15, color: 'var(--text-muted)' },
              ].map(({ label, value, max, color }) => (
                <div key={label} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '10px 14px',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: 'var(--text-mid)' }}>{label}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color, fontWeight: 600 }}>
                      {value || 0} / {max}
                    </span>
                  </div>
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${((value || 0) / max) * 100}%`,
                      background: color, borderRadius: 3,
                    }}/>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'confidence' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '16px',
              }}>
                <div style={{
                  fontSize: 10, color: 'var(--text-faint)',
                  letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8,
                }}>Pass Probability · 90% CI</div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 36,
                  fontWeight: 700, color: scoreColor, marginBottom: 4,
                }}>{passPct}%</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                  [{Math.round((bill.confidence_low || 0) * 100)}–{Math.round((bill.confidence_high || 0) * 100)}%] · {bill.confidence_label || 'MODERATE'} confidence
                </div>
                <div style={{ height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', width: `${passPct}%`,
                    background: scoreColor, borderRadius: 4,
                  }}/>
                </div>
              </div>
              {[
                ['0–30', '9.9%', 9.9],
                ['30–45', '21.2%', 21.2],
                ['45–60', '73.2%', 73.2],
                ['60–75', '91.6%', 91.6],
                ['75–100', '100%', 100],
              ].map(([range, rate, pct]) => (
                <div key={range} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', padding: '8px 12px',
                }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', width: 48 }}>{range}</span>
                  <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${pct}%`, background: 'var(--green-mid)', borderRadius: 2 }}/>
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green-dark)', width: 36, textAlign: 'right' }}>{rate}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Notes */}
        {tracked && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '16px',
          }}>
            <div style={{
              fontSize: 10, color: 'var(--text-faint)',
              letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12,
            }}>Your Notes</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Client</label>
              <input
                type="text" value={clientTag}
                onChange={e => setClientTag(e.target.value)}
                placeholder="e.g. JBLM, Housing Coalition..."
                style={{
                  width: '100%', padding: '8px 12px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 13, color: 'var(--text-primary)', outline: 'none',
                }}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Notes</label>
              <textarea
                value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="Add observations, contacts, strategy notes..."
                rows={4}
                style={{
                  width: '100%', padding: '8px 12px',
                  background: 'var(--bg)', border: '1px solid var(--border)',
                  borderRadius: 8, fontSize: 13, color: 'var(--text-primary)',
                  outline: 'none', resize: 'vertical', lineHeight: 1.5,
                }}
              />
            </div>
            <button onClick={saveNotes} disabled={saving} style={{
              padding: '9px 20px', background: 'var(--green-dark)', color: 'white',
              border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600,
              cursor: 'pointer', opacity: saving ? 0.6 : 1,
            }}>{saving ? 'Saving...' : 'Save Notes'}</button>
          </div>
        )}
      </div>
    </div>
  )
}
