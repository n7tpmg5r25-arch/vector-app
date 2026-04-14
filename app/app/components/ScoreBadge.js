// 6B.2: Added `status` prop — 'LAW', 'CARRY OVER', 'DEAD', or null (active session)
export default function ScoreBadge({ score, size = 'md', status }) {
  const s = score || 0
  const isDead = status === 'DEAD'
  const isLaw = status === 'LAW'
  const isCarryOver = status === 'CARRY OVER'
  const hasOutcome = isDead || isLaw || isCarryOver

  // Color tiers — Shorepine data viz palette (Sage / Deep Teal / Amber / Stone)
  // 7R.1.4: Remapped from teal/gold to Shorepine palette
  const color = isDead ? 'var(--text-faint)'
    : s >= 75 ? '#7aab6e'   /* Sage — strong/passed */
    : s >= 60 ? '#3a7a8a'   /* Deep Teal — active */
    : s >= 45 ? '#c47a30'   /* Amber — watch/pending */
    : '#8a8070'              /* Stone — inactive */

  const glowColor = isDead ? 'transparent'
    : s >= 75 ? 'rgba(122,171,110,0.4)'   /* Sage glow */
    : s >= 60 ? 'rgba(58,122,138,0.3)'    /* Deep Teal glow */
    : s >= 45 ? 'rgba(196,122,48,0.3)'    /* Amber glow */
    : 'transparent'

  const borderColor = isDead ? 'var(--border)'
    : isLaw ? 'rgba(122,171,110,0.6)'     /* Sage for LAW */
    : s >= 75 ? 'rgba(122,171,110,0.6)'
    : s >= 60 ? 'rgba(58,122,138,0.4)'
    : s >= 45 ? 'rgba(196,122,48,0.4)'
    : 'var(--border)'

  // 7Z.9: labelSize for outcome text inside circle (replaces score number)
  const sizes = {
    sm: { width: 36, height: 36, fontSize: 13, borderWidth: 1.5, labelSize: 9 },
    md: { width: 46, height: 46, fontSize: 17, borderWidth: 2, labelSize: 11 },
    lg: { width: 64, height: 64, fontSize: 26, borderWidth: 2.5, labelSize: 14 },
    xl: { width: 80, height: 80, fontSize: 32, borderWidth: 3, labelSize: 17 },
  }
  const dim = sizes[size] || sizes.md

  // 7Z.9: When bill has outcome, show label inside circle instead of score
  const outcomeLabel = isLaw ? 'LAW' : isCarryOver ? 'PASS' : isDead ? 'DEAD' : null
  const outcomeColor = isLaw ? '#7aab6e' : isCarryOver ? 'var(--gold)' : 'var(--text-faint)'

  return (
    <div style={{ position: 'relative', flexShrink: 0 }} title="Nightly composite of 5 signals plus documented X factors, calibrated to the 2025 WA session. Probabilistic signal, not a prediction. See /disclaimers for full methodology.">
      <div style={{
        width: dim.width, height: dim.height,
        borderRadius: '50%',
        background: hasOutcome
          ? (isLaw ? 'rgba(122,171,110,0.12)' : isCarryOver ? 'rgba(184,151,90,0.08)' : 'rgba(255,255,255,0.03)')
          : `radial-gradient(circle at 40% 35%, ${glowColor}, transparent 70%)`,
        border: `${dim.borderWidth}px solid ${borderColor}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: isDead ? 0.45 : 1,
        boxShadow: (!hasOutcome && s >= 45) ? `0 0 16px ${glowColor}, inset 0 0 8px ${glowColor}` : 'none',
        animation: (!hasOutcome && s >= 75) ? 'scoreGlow 3s ease-in-out infinite' : 'none',
      }}>
        {hasOutcome ? (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: dim.labelSize,
            fontWeight: 700,
            color: outcomeColor,
            lineHeight: 1,
            letterSpacing: '0.06em',
          }}>{outcomeLabel}</span>
        ) : (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: dim.fontSize,
            fontWeight: 700,
            color,
            lineHeight: 1,
            textShadow: (s >= 45) ? `0 0 8px ${glowColor}` : 'none',
          }}>{s}</span>
        )}
      </div>
    </div>
  )
}
