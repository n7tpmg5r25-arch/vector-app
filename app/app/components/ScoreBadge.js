// 6B.2: Added `status` prop — 'LAW', 'CARRY OVER', 'DEAD', or null (active session)
export default function ScoreBadge({ score, size = 'md', status }) {
  const s = score || 0
  const isDead = status === 'DEAD'
  const isLaw = status === 'LAW'
  const isCarryOver = status === 'CARRY OVER'
  const hasOutcome = isDead || isLaw || isCarryOver

  // Color tiers — teal for high, gold for mid, muted for low
  // 6B.2: Dim colors when dead
  const color = isDead ? 'var(--text-faint)'
    : s >= 60 ? 'var(--teal)'
    : s >= 45 ? 'var(--teal-mid)'
    : s >= 30 ? 'var(--gold)'
    : 'var(--text-muted)'

  const glowColor = isDead ? 'transparent'
    : s >= 60 ? 'rgba(0,229,204,0.4)'
    : s >= 45 ? 'rgba(0,191,170,0.3)'
    : s >= 30 ? 'rgba(212,168,75,0.3)'
    : 'transparent'

  const borderColor = isDead ? 'var(--border)'
    : isLaw ? 'rgba(0,229,204,0.6)'
    : s >= 60 ? 'rgba(0,229,204,0.6)'
    : s >= 45 ? 'rgba(0,191,170,0.4)'
    : s >= 30 ? 'rgba(212,168,75,0.4)'
    : 'var(--border)'

  const sizes = {
    sm: { width: 36, height: 36, fontSize: 13, borderWidth: 1.5, badgeFontSize: 6 },
    md: { width: 46, height: 46, fontSize: 17, borderWidth: 2, badgeFontSize: 7 },
    lg: { width: 64, height: 64, fontSize: 26, borderWidth: 2.5, badgeFontSize: 8 },
    xl: { width: 80, height: 80, fontSize: 32, borderWidth: 3, badgeFontSize: 9 },
  }
  const dim = sizes[size] || sizes.md

  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <div style={{
        width: dim.width, height: dim.height,
        borderRadius: '50%',
        background: `radial-gradient(circle at 40% 35%, ${glowColor}, transparent 70%)`,
        border: `${dim.borderWidth}px solid ${borderColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: isDead ? 0.45 : 1,
        boxShadow: (!hasOutcome && s >= 45) ? `0 0 16px ${glowColor}, inset 0 0 8px ${glowColor}` : 'none',
        animation: (!hasOutcome && s >= 60) ? 'scoreGlow 3s ease-in-out infinite' : 'none',
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: dim.fontSize,
          fontWeight: 700,
          color,
          lineHeight: 1,
          textShadow: (!isDead && s >= 45) ? `0 0 8px ${glowColor}` : 'none',
        }}>{s}</span>
      </div>
      {/* 6B.2: Outcome overlay badge */}
      {hasOutcome && (
        <span style={{
          position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)',
          fontSize: dim.badgeFontSize, fontFamily: 'var(--font-mono)', fontWeight: 700,
          padding: '1px 5px', borderRadius: 6, whiteSpace: 'nowrap',
          letterSpacing: '0.04em', textTransform: 'uppercase',
          background: isLaw ? 'rgba(0,229,204,0.15)' : isCarryOver ? 'rgba(212,168,75,0.12)' : 'rgba(255,255,255,0.06)',
          color: isLaw ? 'var(--teal)' : isCarryOver ? 'var(--gold)' : 'var(--text-faint)',
          border: `1px solid ${isLaw ? 'rgba(0,229,204,0.3)' : isCarryOver ? 'rgba(212,168,75,0.25)' : 'var(--border)'}`,
        }}>
          {isLaw ? 'LAW' : isCarryOver ? 'CARRY' : 'DEAD'}
        </span>
      )}
    </div>
  )
}
