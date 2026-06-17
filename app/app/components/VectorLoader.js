'use client'

/**
 * Vector | WA — VectorLoader (Thread 35).
 *
 * Replaces the dozen-or-so generic `<div>Loading...</div>` text loaders
 * scattered across the public + owner pages. A small brass arrow that pulses
 * (subtle CSS keyframes) paired with context-specific copy.
 *
 * Why: a generic "Loading..." text loader is one of the strongest
 * "feels AI-coded" tells per PUBLIC_SITE_REVIEW_2026-04-27.md Meta Tell #2.
 * One component, one consistent visual, branded copy per surface.
 *
 * Props:
 *   label: string  — context-specific copy (e.g. "Pulling roll calls").
 *                    Default: "Loading". Trailing ellipsis is rendered by the
 *                    component, so callers should NOT include "..." or "…".
 *   size: 'sm' | 'md'  — sm = inline (component-level), md = page-level.
 *                        Default: 'md'.
 *
 * Usage:
 *   <VectorLoader />                                 // page-level "Loading…"
 *   <VectorLoader label="Pulling roll calls" />      // page-level w/ context
 *   <VectorLoader label="Loading bill" size="sm" />  // inline / card-level
 *
 * Animation: keyframes `vectorLoaderPulse` are defined in globals.css; this
 * file only references them. Reduced-motion users see a static arrow because
 * globals.css disables the animation under prefers-reduced-motion.
 */

export default function VectorLoader({ label = 'Loading', size = 'md' } = {}) {
  const isSmall = size === 'sm'
  const arrowSize = isSmall ? 14 : 18
  const fontSize = isSmall ? 12 : 13
  const padding = isSmall ? '12px 0' : '40px 0'
  const gap = isSmall ? 8 : 10

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap,
        padding,
        color: 'var(--text-faint)',
        fontSize,
        letterSpacing: '0.02em',
      }}
    >
      <BrassArrow size={arrowSize} />
      <span>{label}…</span>
    </div>
  )
}

function BrassArrow({ size }) {
  // The wordmark "vector" arrow shape — minimal SVG, animation lives in globals.css.
  return (
    <svg
      className="vec-loader-arrow"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--gold)"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        filter: 'drop-shadow(0 0 6px rgba(212,180,122,0.4))',
      }}
    >
      <path d="M5 12h13" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}
