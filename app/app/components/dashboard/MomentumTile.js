/**
 * Vector | WA — momentum tile (DASH-2).
 *
 * A Playfair count of how many tracked + top bills gained score since the prior
 * snapshot, paired with a brass sparkline. Brass is the one sanctioned data
 * stroke here (Brand Guide v1.2 §02: brass = punctuation — arc, pipe, hero
 * number, progress fill, sparkline). The count is a same-data approximation of
 * weekly velocity (yellow-tier); the true stored velocity series is deferred,
 * so the sparkline shape is illustrative (see <title>) until that series lands.
 * During the interim scores are frozen — the tile reads as flat, not empty.
 *
 * Props:
 *   count   number   bills whose score rose since the prior snapshot
 *   interim boolean  interim freeze -> calm flat state
 */
const EYEBROW = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
}

export default function MomentumTile({ count = 0, interim = false }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '11px 13px' }}>
      <div style={{ ...EYEBROW, marginBottom: 7 }}>Momentum</div>
      {interim ? (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 23, color: 'var(--text-muted)', lineHeight: 1 }}>—</span>
            <svg width="100%" height="26" viewBox="0 0 90 26" preserveAspectRatio="none" style={{ flex: 1 }} aria-hidden="true">
              <line x1="0" y1="13" x2="90" y2="13" stroke="var(--border-light)" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 5" />
            </svg>
          </div>
          <div style={{ ...EYEBROW, marginTop: 6 }}>scores frozen · interim</div>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 23, color: 'var(--text-primary)', lineHeight: 1 }}>{count}</span>
            <svg width="100%" height="26" viewBox="0 0 90 26" preserveAspectRatio="none" style={{ flex: 1 }} role="img" aria-label="Recent momentum trend (illustrative)">
              <title>Illustrative trend — a stored weekly-velocity series is coming.</title>
              <path d="M0,21 L18,19 L36,20 L54,13 L72,14 L90,5 L90,26 L0,26 Z" fill="rgba(184,151,90,0.10)" />
              <polyline points="0,21 18,19 36,20 54,13 72,14 90,5" fill="none" stroke="var(--brass)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div style={{ ...EYEBROW, marginTop: 6 }}>advanced this wk ▲</div>
        </>
      )}
    </div>
  )
}
