'use client'
/**
 * NavSwitcher — Vector | WA Thread 15.2 (2026-04-25)
 *
 * Loading-aware nav picker for pages that can serve both anon-public and
 * authed viewers when NEXT_PUBLIC_ENABLE_PUBLIC_LAYER='true'. Renders
 * NOTHING during the brief useViewer() loading window so the page never
 * flashes the wrong nav before auth resolves.
 *
 * After loading resolves:
 *   • anon + flag=true  → <PublicNav />  (sticky top bar)
 *   • authed             → <Nav />        (fixed bottom bar)
 *   • anon + flag=false  → render nothing (proxy.js redirected to /login)
 *
 * Use on pages that currently render an unconditional <Nav /> but are
 * reachable as public surfaces (e.g. /disclaimers when the flag is on).
 * Pages that already do their own conditional render with isAnonPublic
 * should inline the same `!viewerLoading && …` gate instead of mounting
 * this — the inline pattern lets them also gate their layout padding
 * decisions on the resolved state.
 *
 * Display-only (G5 frozen-engine).
 */
import { useViewer } from '../../lib/viewer-capabilities'
import Nav from './Nav'
import PublicNav from './PublicNav'

export default function NavSwitcher() {
  const { user, loading, publicLayerEnabled } = useViewer()
  if (loading) return null
  if (!user) {
    return publicLayerEnabled ? <PublicNav /> : null
  }
  return <Nav />
}
