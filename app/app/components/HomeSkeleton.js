'use client'

/**
 * Vector | WA — HomeSkeleton (T157 perf pass).
 *
 * Renders the home page's chrome (sticky brand bar + a structural set of
 * shimmer placeholders) while the dashboard data is in flight. Replaces the
 * old full-screen <VectorLoader /> return, which left the entire viewport
 * blank-but-for-a-spinner for the 7–10s initial load and read as "broken"
 * to first-time visitors (lobbyist trust audit #1, 2026-05-29).
 *
 * Pure presentational, no data, no hooks beyond render. Shimmer animation
 * lives in globals.css (.vec-skeleton / @keyframes vecShimmer) and is
 * disabled under prefers-reduced-motion.
 */
export default function HomeSkeleton() {
  return (
    <div style={{ paddingBottom: 90, fontFamily: 'var(--font-body)' }} role="status" aria-live="polite">
      <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        Loading intelligence…
      </span>

      {/* Sticky brand bar — real logo paints instantly (no data needed). */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'radial-gradient(ellipse at 70% 20%, rgba(184,151,90,0.10) 0%, transparent 60%), rgba(14,16,20,0.95)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 16px 14px',
      }}>
        <img
          src="/logos/vector-wa-primary.svg"
          alt="Vector | WA"
          style={{ height: 56, width: 'auto', display: 'block', filter: 'drop-shadow(0 0 16px rgba(184,151,90,0.22))' }}
        />
        <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 6 }}>
          Legislative Trajectories
        </div>
      </div>

      <div style={{ padding: '20px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Status chips row */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div className="vec-skeleton" style={{ width: 92, height: 26, borderRadius: 20 }} />
          <div className="vec-skeleton" style={{ width: 80, height: 26, borderRadius: 20 }} />
        </div>

        {/* Session countdown card */}
        <div className="vec-skeleton" style={{ height: 96 }} />

        {/* Section label + three list cards */}
        <div className="vec-skeleton" style={{ width: 140, height: 12, marginTop: 4 }} />
        <div className="vec-skeleton" style={{ height: 64 }} />
        <div className="vec-skeleton" style={{ height: 64 }} />
        <div className="vec-skeleton" style={{ height: 64 }} />

        {/* Stat strip */}
        <div className="vec-skeleton" style={{ height: 72, marginTop: 4 }} />
      </div>
    </div>
  )
}
