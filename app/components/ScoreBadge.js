export default function ScoreBadge({ score, size = 'md' }) {
  const color = score >= 60 ? 'var(--green-dark)'
    : score >= 45 ? 'var(--green-mid)'
    : score >= 30 ? 'var(--gold)'
    : 'var(--text-muted)'

  const bg = score >= 60 ? 'var(--green-pale)'
    : score >= 45 ? '#eef4f0'
    : score >= 30 ? 'var(--gold-pale)'
    : 'var(--bg-card-2)'

  const sizes = {
    sm: { width: 36, height: 36, fontSize: 13 },
    md: { width: 44, height: 44, fontSize: 17 },
    lg: { width: 56, height: 56, fontSize: 22 },
  }
  const s = sizes[size] || sizes.md

  return (
    <div style={{
      width: s.width, height: s.height,
      borderRadius: '50%',
      background: bg,
      border: `1.5px solid ${color}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <span style={{
        fontFamily: 'var(--font-mono)',
        fontSize: s.fontSize,
        fontWeight: 600,
        color,
        lineHeight: 1,
      }}>{score}</span>
    </div>
  )
}
