/**
 * Vector | WA — portfolio tier distribution (DASH-1).
 *
 * A stacked proportional bar + dot legend over the functional palette
 * (Brand Guide v1.2 §02, semantic-only): HIGH → Sage, MODERATE → Deep-Teal,
 * LOW → Amber, VERY LOW → Stone. Tier cuts (75 / 60 / 45) match ScoreBadge
 * and pdf-shared.js getScoreTier(). `counts` is { high, mod, low, vlow }.
 */
const SEGMENTS = [
  { key: 'high', label: 'High',  color: 'var(--sage)' },
  { key: 'mod',  label: 'Mod',   color: 'var(--deep-teal)' },
  { key: 'low',  label: 'Low',   color: 'var(--amber)' },
  { key: 'vlow', label: 'V.Low', color: 'var(--stone)' },
]

export default function DistributionBar({ counts = {}, style }) {
  const total = SEGMENTS.reduce((sum, s) => sum + (counts[s.key] || 0), 0)
  return (
    <div style={style}>
      {/* AUDIT-3 A9 (2026-07-03): the bar is color-only - give it a text
          equivalent. The dot legend below already carries the counts as real
          text, so the bar summarizes and the dots go decorative. */}
      <div
        role="img"
        aria-label={`Tier distribution: ${counts.high || 0} high, ${counts.mod || 0} moderate, ${counts.low || 0} low, ${counts.vlow || 0} very low`}
        style={{ display: 'flex', height: 9, borderRadius: 4, overflow: 'hidden', background: 'var(--bg-surface)' }}
      >
        {total > 0 && SEGMENTS.map((s) => {
          const n = counts[s.key] || 0
          if (n === 0) return null
          return <div key={s.key} style={{ width: `${(n / total) * 100}%`, background: s.color }} />
        })}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8, fontSize: 11, color: 'var(--text-mid)' }}>
        {SEGMENTS.map((s) => (
          <span key={s.key}>
            <span style={{ color: s.color }} aria-hidden="true">●</span> {counts[s.key] || 0} {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}
