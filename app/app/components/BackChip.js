'use client'
import { useRouter } from 'next/navigation'
import { goBackOrFallback } from '../../lib/nav-back'

/**
 * Vector | WA — BackChip (Thread 23).
 *
 * Sticky-header back affordance for detail pages. Wraps goBackOrFallback so
 * that server components (e.g. /c/[slug]/bill/[id]) can adopt the same
 * behavior without a useRouter() hook of their own. Existing client-component
 * detail pages can continue to call goBackOrFallback inline; this component
 * exists primarily to bridge the server-component case.
 *
 * Style override is passthrough — caller controls color, weight, font-size
 * to match the page's own header palette (public dark UI vs Shorepine
 * client-portal forest). Renders inside the caller's sticky-header wrapper;
 * the chip itself does not impose layout.
 */
export default function BackChip({ label = 'Back', fallbackPath = '/', style }) {
  const router = useRouter()
  return (
    <button
      type="button"
      onClick={() => goBackOrFallback(router, fallbackPath)}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        font: 'inherit',
        color: 'inherit',
        ...(style || {}),
      }}
    >
      ← {label}
    </button>
  )
}