'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createBrowserClient } from '../../lib/supabase'
import { getCurrentSession, isInterimPeriod, getNextBiennium, formatSessionDate } from '../../lib/session-config'
import Nav from '../components/Nav'

export default function SettingsPage() {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(false)
  const [billCount, setBillCount] = useState('...')

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user))
    supabase.from('bills').select('id', { count: 'exact', head: true })
      .then(({ count }) => { if (count != null) setBillCount(count.toLocaleString()) })
  }, [])

  async function signOut() {
    setLoading(true)
    await supabase.auth.signOut()
    router.push('/login')
  }

  const nextB = getNextBiennium()
  const SESSION_INFO = [
    { label: 'Current Session', value: getCurrentSession() },
    { label: 'Session State', value: isInterimPeriod() ? 'Interim' : 'In Session', accent: isInterimPeriod() },
    { label: 'Next Session Opens', value: nextB?.start ? formatSessionDate(nextB.start) : 'TBD' },
    { label: 'Pre-filing Starts', value: nextB?.prefilingOpens ? formatSessionDate(nextB.prefilingOpens) : 'TBD' },
    { label: 'Bills in Database', value: billCount, mono: true },
    { label: 'Scoring Engine', value: 'v3.1 \u00b7 Calibrated', mono: true },
  ]

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      <div style={{
        background: 'rgba(11,26,18,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 20px 20px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24, fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(45,107,69,0.2)',
        }}>Settings</div>
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

        {/* About */}
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 10, fontWeight: 600 }}>About</div>
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '16px',
            fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <svg width="24" height="20" viewBox="0 0 56 48" fill="none">
                <path d="M4 4 L28 44 L52 4" stroke="var(--teal)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                <path d="M28 44 L52 20" stroke="var(--teal-dim)" strokeWidth="4" strokeLinecap="round" fill="none"/>
                <polygon points="52,14 58,22 44,22" fill="var(--gold)"/>
              </svg>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--teal)' }}>
                  VECTOR <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>| WA</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>Legislative Trajectories</div>
              </div>
            </div>
            Trajectory scoring engine calibrated against 3,411 bills from the completed 2025-26 biennium, with historical baselines from 8,824 bills across 2021-22 and 2023-24. Signals include committee activity, sponsor tier, momentum, historical pass rates, and X Factor multipliers.
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
