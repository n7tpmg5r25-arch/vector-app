'use client'

// AUDIT-2 F1 (2026-07-03): shown when a stats-critical query fails. On a
// decision-grade surface a wrong zero is worse than a missing number, so
// callers render this card instead of stat blocks computed from a failed
// load. Retry is a full reload - simplest correct recovery, matching the
// app's OTP hard-reload convention.
export default function LoadErrorCard({ label = 'live data', style }) {
  return (
    // AUDIT-3 A8 (2026-07-03): role=alert announces the failure to screen
    // readers the moment it renders - without it the card appears silently.
    <div role="alert" style={{
      background: 'var(--bg-card)', border: '1px solid rgba(196,71,48,0.35)',
      borderRadius: 'var(--radius)', padding: '20px 16px', textAlign: 'center',
      ...style,
    }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
        Couldn&rsquo;t load {label}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        A connection problem stopped this load. The data itself is fine &mdash; retry in a moment.
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '7px 16px', borderRadius: 16, fontSize: 11, fontWeight: 600,
          background: 'rgba(184,151,90,0.1)', color: 'var(--teal)',
          border: '1px solid rgba(184,151,90,0.3)', cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  )
}
