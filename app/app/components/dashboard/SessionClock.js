/**
 * Vector | WA — session clock (DASH-1).
 *
 * Thin progress bar + "Day X / Y" while the Legislature is in regular session;
 * a calm "Interim" / "Pre-session · Nd" label otherwise. Brass is the progress
 * fill — one of the few sanctioned brass surfaces (Brand Guide v1.2 §02).
 * Takes the object from getSessionClock() so the chrome and the cutoff chip
 * read a single computed source.
 */
export default function SessionClock({ clock }) {
  if (!clock) return null
  const pct = clock.inSession ? Math.round((clock.pct || 0) * 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
      <div style={{ flex: 1, height: 3, background: 'var(--bg-surface)', borderRadius: 2, overflow: 'hidden' }}>
        {pct > 0 && (
          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--brass)', boxShadow: '0 0 8px rgba(184,151,90,0.5)' }} />
        )}
      </div>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {clock.label}
      </span>
    </div>
  )
}
