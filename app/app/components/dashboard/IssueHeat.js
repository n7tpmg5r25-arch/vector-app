/**
 * Vector | WA — issue heat (DASH-2).
 *
 * The top policy categories by average trajectory, drawn as thin horizontal
 * bars. Fill width = average score; fill color is the functional tier the
 * average lands in — Sage / Deep-Teal / Amber / Stone for HIGH / MOD / LOW /
 * VERY LOW (Brand Guide v1.2 §02, semantic-only; tier cuts 75 / 60 / 45 are
 * inlined to match ScoreBadge + DistributionBar without importing the PDF
 * module). Reads the interim_intelligence rows already loaded for the home, so
 * it works in session and during the interim alike. Trend arrows are deferred
 * (no category-average history yet).
 *
 * Props:
 *   categories  Array<{ category, avg_score, total_bills }>   pre-sorted desc
 */
const EYEBROW = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
}

function tierColor(score) {
  if (score >= 75) return 'var(--sage)'
  if (score >= 60) return 'var(--deep-teal)'
  if (score >= 45) return 'var(--amber)'
  return 'var(--stone)'
}

export default function IssueHeat({ categories = [] }) {
  const rows = categories.slice(0, 3)
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '11px 13px' }}>
      <div style={{ ...EYEBROW, marginBottom: 9 }}>Issue heat</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>No category data yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map(cat => {
            const avg = Math.round(cat.avg_score || 0)
            return (
              <div key={cat.category} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span title={cat.category} style={{ fontSize: 10, color: 'var(--text-mid)', width: 52, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {cat.category}
                </span>
                <div role="img" aria-label={`${cat.category}: average trajectory ${avg} of 99`}
                  style={{ flex: 1, height: 6, background: 'var(--bg-surface)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, avg)}%`, height: '100%', background: tierColor(avg), borderRadius: 3 }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
