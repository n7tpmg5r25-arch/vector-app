export default function ScoreBadge({ score, size = 'md' }) {
  const s = score || 0

  // Color tiers — teal for high, gold for mid, muted for low
  const color = s >= 60 ? 'var(--teal)'
    : s >= 45 ? 'var(--teal-mid)'
    : s >= 30 ? 'var(--gold)'
    : 'var(--text-muted)'

  const glowColor = s >= 60 ? 'rgba(0,229,204,0.4)'
    : s >= 45 ? 'rgba(0,191,170,0.3)'
    : s >= 30 ? 'rgba(212,168,75,0.3)'
    : 'transparent'

  const borderColor = s >= 60 ? 'rgba(0,229,204,0.6)'
    : s >= 45 ? 'rgba(0,191,170,0.4)'
    : s >= 30 ? 'rgba(212,168,75,0.4)'
    : 'var(--border)'

  const sizes = {
    sm: { width: 36, height: 36, fontSize: 13, borderWidth: 1.5 },
    md: { width: 46, height: 46, fontSize: 17, borderWidth: 2 },
    lg: { width: 64, height: 64, fontSize: 26, borderWidth: 2.5 },
    xl: { width: 80, height: 80, fontSize: 32, borderWidth: 3 },
  }
  const dim = sizes[size] || sizes.md

  return (
    <div style={{
      width: dim.width, height: dim.height,
      borderRadius: '50%',
      background: `radial-gradient(circle at 40% 35%, ${glowColor}, transparent 70%)`,
      border: `${dim.borderWidth}px solid ${borderColor}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
      boxShadow: s >= 45 ? `0 0 16px ${glowColor}, inset 0 0 8px ${glowColor}` : 'none',
      animation: s >= 60 ? 'scoreGlow 3s ease-in-out infinite' : 'none',
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: dim.fontSize,
        fontWeight: 700,
        color,
        lineHeight: 1,
        textShadow: s >= 45 ? `0 0 8px ${glowColor}` : 'none',
      }}>{s}</span>
    </div>
  )
}
