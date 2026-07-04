'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, isInterimPeriod, getNextBiennium, formatSessionDate } from '../../lib/session-config'
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from '../components/Nav'
import CohortCitation from '../components/CohortCitation'
import DropdownMenu from '../components/DropdownMenu'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const { user, capabilities, loading: viewerLoading } = useViewer()
  const [loading, setLoading] = useState(false)
  // Phase 7U.5: split bill counts so the current-session number stays a useful
  // sync-health signal instead of being diluted by the historical archive.
  const [currentSessionBills, setCurrentSessionBills] = useState('...')
  const [historicalBills, setHistoricalBills] = useState('...')

  // Phase 9: Notification preferences
  const [notifEmail, setNotifEmail] = useState('')
  const [digestEnabled, setDigestEnabled] = useState(true)
  const [alertsEnabled, setAlertsEnabled] = useState(true)
  const [radarEnabled, setRadarEnabled] = useState(true)
  const [digestDay, setDigestDay] = useState('monday')
  const [notifSaving, setNotifSaving] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)
  const [notifLoaded, setNotifLoaded] = useState(false)
  const [testSending, setTestSending] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // Bill counts: no auth dependency — load once
  useEffect(() => {
    const current = getCurrentSession()
    supabase.from('bills').select('bill_id', { count: 'exact', head: true }).eq('session', current).eq('legislation_type', 'bill')
      .then(({ count }) => { if (count != null) setCurrentSessionBills(count.toLocaleString()) })
    supabase.from('bills').select('bill_id', { count: 'exact', head: true }).neq('session', current).eq('legislation_type', 'bill')
      .then(({ count }) => { if (count != null) setHistoricalBills(count.toLocaleString()) })
  }, [])

  // Notification preferences: wait for viewer to resolve, then load
  useEffect(() => {
    if (viewerLoading) return
    if (!user) return
    supabase
      .from('notification_preferences')
      .select('*')
      .eq('user_id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setNotifEmail(data.email || '')
          setDigestEnabled(data.digest_enabled)
          setAlertsEnabled(data.alerts_enabled)
          setRadarEnabled(data.radar_enabled !== false)
          setDigestDay(data.digest_day || 'monday')
        } else {
          // Default to user's auth email
          setNotifEmail(user.email || '')
        }
        setNotifLoaded(true)
      })
  }, [user?.id, viewerLoading])

  async function signOut() {
    setLoading(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  async function saveNotifPrefs() {
    if (!user || !notifEmail.trim()) return
    setNotifSaving(true)
    setNotifSaved(false)

    const prefs = {
      user_id: user.id,
      email: notifEmail.trim(),
      digest_enabled: digestEnabled,
      alerts_enabled: alertsEnabled,
      radar_enabled: radarEnabled,
      digest_day: digestDay,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('notification_preferences')
      .upsert(prefs, { onConflict: 'user_id' })

    setNotifSaving(false)
    if (!error) {
      setNotifSaved(true)
      setTimeout(() => setNotifSaved(false), 3000)
    }
  }

  async function sendTestEmail() {
    if (!user) return
    setTestSending(true)
    setTestResult(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/send-test-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({}),
      })
      const data = await resp.json()
      setTestResult(data.ok ? 'sent' : (data.error || 'Failed'))
    } catch (err) {
      setTestResult('Network error')
    }
    setTestSending(false)
  }

  const nextB = getNextBiennium()
  const SESSION_INFO = [
    { label: 'Current Session', value: getCurrentSession() },
    { label: 'Session State', value: isInterimPeriod() ? 'Interim' : 'In Session', accent: isInterimPeriod() },
    { label: 'Next Session Opens', value: nextB?.start ? formatSessionDate(nextB.start) : 'TBD' },
    { label: 'Pre-filing Starts', value: nextB?.prefilingOpens ? formatSessionDate(nextB.prefilingOpens) : 'TBD' },
    { label: 'Current Session Bills', value: currentSessionBills, mono: true },
    { label: 'Historical Archive', value: historicalBills, mono: true },
    { label: 'Scoring Engine', value: 'v3.1 \u00b7 Calibrated', mono: true },
  ]

  const DAYS = [
    { value: 'monday', label: 'Monday' },
    { value: 'tuesday', label: 'Tuesday' },
    { value: 'wednesday', label: 'Wednesday' },
    { value: 'thursday', label: 'Thursday' },
    { value: 'friday', label: 'Friday' },
    { value: 'saturday', label: 'Saturday' },
    { value: 'sunday', label: 'Sunday' },
  ]

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {/* Sticky page-header bar (Thread 64, 2026-05-03). Mirrors PR #81
          public-page pattern from about/methodology/install. The 52px
          top padding clears the fixed-position HamburgerButton (Nav.js
          renders it at top:8 + safe-area inset). zIndex 50 sits below the
          hamburger (zIndex 90) so the floating button stays accessible
          while the title bar pins. */}
      <div style={{
        position: 'sticky',
        top: 0, zIndex: 50,
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 20px 20px',
      }}>
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24, fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>Settings</h1>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* Account */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>Account</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px 16px' }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 2 }}>Signed in as</div>
            <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--teal)' }}>
              {user?.email || 'Loading...'}
            </div>
          </div>
        </div>

        {/* Notifications — Phase 9 */}
        {notifLoaded && (
          <div>
            <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>Notifications</div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>

              {/* Email address */}
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Notification email
                </label>
                <input
                  type="email"
                  value={notifEmail}
                  onChange={e => setNotifEmail(e.target.value)}
                  placeholder="your@email.com"
                  style={{
                    width: '100%', padding: '8px 12px',
                    background: 'rgba(14,16,20,0.6)',
                    border: '1px solid var(--border)',
                    borderRadius: 6, color: 'var(--text-primary)',
                    fontSize: 14, outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Weekly digest toggle */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px', borderBottom: '1px solid var(--border)',
              }}>
                <div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>Weekly digest</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Summary of watchlist changes</div>
                </div>
                <button
                  onClick={() => setDigestEnabled(!digestEnabled)}
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: digestEnabled ? 'var(--teal)' : 'var(--border)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: 9,
                    background: 'white',
                    position: 'absolute', top: 3,
                    left: digestEnabled ? 23 : 3,
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {/* Digest day picker (only if digest enabled) */}
              {digestEnabled && (
                <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
                  <label style={{ fontSize: 12, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                    Digest day
                  </label>
                  <DropdownMenu
                    value={digestDay}
                    onChange={v => setDigestDay(v)}
                    options={DAYS.map(d => ({ value: d.value, label: d.label }))}
                    ariaLabel="Digest day"
                    width="100%"
                    triggerStyle={{
                      width: '100%',
                      padding: '8px 32px 8px 12px',
                      background: 'rgba(14,16,20,0.6)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      color: 'var(--text-primary)',
                      fontSize: 14,
                      minHeight: 44,
                    }}
                  />
                </div>
              )}

              {/* Per-event alerts toggle */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px', borderBottom: '1px solid var(--border)',
              }}>
                <div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>Per-event alerts</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Outcome changes, hearings, Rules pulls</div>
                </div>
                <button
                  onClick={() => setAlertsEnabled(!alertsEnabled)}
                  role="switch" aria-checked={alertsEnabled} aria-label="Per-event alerts"
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: alertsEnabled ? 'var(--teal)' : 'var(--border)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: 9,
                    background: 'white',
                    position: 'absolute', top: 3,
                    left: alertsEnabled ? 23 : 3,
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {/* Radar alerts toggle (Thread R3) — independent global switch for
                  Radar term-match emails. Off keeps the Radar feed live (matches
                  still log) but stops the emails. Manage terms on the Radar tab. */}
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '14px 16px',
              }}>
                <div>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 2 }}>Radar alerts</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    New bills matching your <Link href="/radar" style={{ color: 'var(--teal)', textDecoration: 'none' }}>Radar terms</Link>
                  </div>
                </div>
                <button
                  onClick={() => setRadarEnabled(!radarEnabled)}
                  role="switch" aria-checked={radarEnabled} aria-label="Radar alerts"
                  style={{
                    width: 44, height: 24, borderRadius: 12, border: 'none', cursor: 'pointer',
                    background: radarEnabled ? 'var(--teal)' : 'var(--border)',
                    position: 'relative', transition: 'background 0.2s',
                  }}
                >
                  <div style={{
                    width: 18, height: 18, borderRadius: 9,
                    background: 'white',
                    position: 'absolute', top: 3,
                    left: radarEnabled ? 23 : 3,
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>
            </div>

            {/* Save + Test buttons */}
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button
                onClick={saveNotifPrefs}
                disabled={notifSaving || !notifEmail.trim()}
                style={{
                  flex: 1, padding: '10px',
                  background: notifSaved ? 'rgba(45,107,69,0.15)' : 'var(--teal)',
                  border: notifSaved ? '1px solid rgba(45,107,69,0.3)' : 'none',
                  borderRadius: 'var(--radius)',
                  fontSize: 13, fontWeight: 600,
                  color: notifSaved ? 'var(--teal)' : '#fff',
                  cursor: notifSaving ? 'wait' : 'pointer',
                  opacity: (!notifEmail.trim() || notifSaving) ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {notifSaving ? 'Saving...' : notifSaved ? 'Saved' : 'Save Preferences'}
              </button>
              <button
                onClick={sendTestEmail}
                disabled={testSending || !notifEmail.trim()}
                style={{
                  padding: '10px 16px',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  fontSize: 13, fontWeight: 500,
                  color: 'var(--text-muted)',
                  cursor: testSending ? 'wait' : 'pointer',
                  opacity: (!notifEmail.trim() || testSending) ? 0.5 : 1,
                  transition: 'all 0.2s',
                }}
              >
                {testSending ? 'Sending...' : 'Send Test'}
              </button>
            </div>
            {testResult && (
              <div style={{
                marginTop: 8, padding: '8px 12px', borderRadius: 6, fontSize: 12,
                background: testResult === 'sent' ? 'rgba(45,107,69,0.1)' : 'rgba(200,50,50,0.1)',
                color: testResult === 'sent' ? 'var(--teal)' : 'var(--danger)',
                border: `1px solid ${testResult === 'sent' ? 'rgba(45,107,69,0.2)' : 'rgba(200,50,50,0.2)'}`,
              }}>
                {testResult === 'sent' ? 'Test email sent — check your inbox.' : `Error: ${testResult}`}
              </div>
            )}
          </div>
        )}

        {/* Session info */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>Session Information</div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
            {SESSION_INFO.map(({ label, value, accent, mono }, i) => (
              <div key={label} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 16px',
                borderBottom: i < SESSION_INFO.length - 1 ? '1px solid var(--border)' : 'none',
              }}>
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{label}</span>
                <span style={{
                  fontSize: 13, fontWeight: 500,
                  color: accent ? 'var(--gold)' : 'var(--text-primary)',
                  fontFamily: mono ? 'var(--font-mono)' : 'inherit',
                }}>{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Reference */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>Reference</div>
          <Link href="/methodology" style={{ textDecoration: 'none', display: 'block' }}>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', padding: '14px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
              cursor: 'pointer', transition: 'border-color 0.2s',
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--teal)', marginBottom: 2 }}>Methodology</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  How Vector | WA scores bills &mdash; signals, X factors, and 3-biennium calibration
                </div>
              </div>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </div>
          </Link>
        </div>

        {/* About */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>About</div>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '16px',
            fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6,
          }}>
            <div style={{ marginBottom: 12 }}>
              <img
                src="/logos/vector-wa-primary.svg"
                alt="Vector | WA"
                width={150}
                style={{
                  height: 'auto',
                  filter: 'drop-shadow(0 0 16px rgba(184,151,90,0.2))',
                }}
              />
            </div>
            Trajectory scoring engine calibrated against <CohortCitation />. Signals include committee activity, sponsor tier, momentum, historical pass rates, and X Factor multipliers.
          </div>
        </div>

        {/* Sign out */}
        <button onClick={signOut} disabled={loading} style={{
          width: '100%', padding: '13px',
          background: 'transparent',
          border: '1px solid var(--danger)',
          borderRadius: 'var(--radius)',
          fontSize: 14, fontWeight: 600,
          color: 'var(--danger)',
          cursor: 'pointer', opacity: loading ? 0.6 : 1,
          boxShadow: 'var(--danger-glow)',
          transition: 'all 0.15s',
        }}>{loading ? 'Signing out...' : 'Sign Out'}</button>
      </div>

      <Nav/>
    </div>
  )
}
