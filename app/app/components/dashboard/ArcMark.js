/**
 * Vector | WA — arc mark (DASH-1).
 *
 * The ascending brass arc is the interface identity (Brand Guide v1.2 §02) —
 * NOT a Playfair wordmark. Used as the chrome identifier beside the wordmark
 * and, later, in the public "track your bills" prompt (DASH-6). Decorative:
 * the adjacent wordmark text carries the accessible name.
 */
export default function ArcMark({ width = 26, color = 'var(--brass)', strokeWidth = 2.6, style }) {
  const height = Math.round((width * 18) / 26)
  return (
    <svg width={width} height={height} viewBox="0 0 26 18" fill="none" aria-hidden="true" style={style}>
      <path d="M3,16 Q13,2 24,4" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}
