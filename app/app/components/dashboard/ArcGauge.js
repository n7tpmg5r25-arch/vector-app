/**
 * Vector | WA — 270° trajectory gauge (DASH-1).
 *
 * Brass value arc on a surface track; Playfair value + DM Mono sub-label
 * centered (Brand Guide v1.2: numbers = Playfair, labels = DM Mono, brass is
 * reserved punctuation — here the hero number + its arc). The rotate(135) +
 * dasharray recipe opens a 90° gap centered at the bottom: r=44 gives a
 * circumference of 276.46, and the visible 270° sweep is 207.30. value/max
 * scales the brass arc within that sweep.
 */
const R = 44
const CIRC = 2 * Math.PI * R       // 276.46
const SWEEP = (CIRC * 270) / 360   // 207.30 — the visible 270° arc

export default function ArcGauge({
  value = 0,
  max = 99,
  displayValue,
  subLabel = '/ 99',
  size = 104,
  color = 'var(--brass)',
  trackColor = 'var(--bg-surface)',
  glow = 'rgba(184,151,90,0.4)',
  ariaLabel,
}) {
  const frac = Math.max(0, Math.min(1, (Number(value) || 0) / max))
  const valLen = SWEEP * frac
  const shown = displayValue != null ? displayValue : String(Math.round(Number(value) || 0))
  const numSize = Math.round(size * 0.345)

  return (
    <div
      style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}
      {...(ariaLabel ? { role: 'img', 'aria-label': ariaLabel } : {})}
    >
      <svg width={size} height={size} viewBox="0 0 110 110" aria-hidden="true">
        <circle
          cx="55" cy="55" r={R} fill="none" stroke={trackColor} strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${SWEEP.toFixed(2)} ${CIRC.toFixed(2)}`}
          transform="rotate(135 55 55)"
        />
        {valLen > 0.5 && (
          <circle
            cx="55" cy="55" r={R} fill="none" stroke={color} strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${valLen.toFixed(2)} ${CIRC.toFixed(2)}`}
            transform="rotate(135 55 55)"
          />
        )}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: numSize, color, lineHeight: 1, textShadow: `0 0 14px ${glow}` }}>
          {shown}
        </span>
        {subLabel != null && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 7, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', marginTop: 1 }}>
            {subLabel}
          </span>
        )}
      </div>
    </div>
  )
}
