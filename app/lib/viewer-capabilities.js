'use client'
/**
 * Viewer Capabilities — Phase 12 Public Layer
 *
 * Single source of truth for what the current viewer can do. Pages and
 * components consult this helper instead of checking supabase.auth.getUser()
 * directly in ad-hoc ways.
 *
 * Why: forward-compat for a future client tier (2028+). Today the helper
 * returns one of two shapes (public / owner). When the client tier arrives,
 * add a third shape here — no page code changes required.
 *
 * NAMING NOTE: in this app, the existing useSession() hook is the
 * biennium selector (2025-2026 vs 2023-2024), NOT the auth session.
 * Do not confuse. Auth viewer state lives HERE.
 *
 * See: PHASE_12_PUBLIC_LAYER_PLAN.md §5 for full forward-compat design.
 */

import { useEffect, useState } from 'react'
import { createBrowserClient } from './supabase'

// ─── Feature flag ──────────────────────────────────────────────────
// When 'true', anonymous visitors can reach allowlisted public routes
// (search, committees, members, bill/[id], methodology, outcomes,
// hearings). When 'false' (default), unauthenticated visitors are
// redirected to /login exactly as today.
export const PUBLIC_LAYER_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_PUBLIC_LAYER === 'true'

// ─── Pure function: user → capabilities ────────────────────────────
/**
 * Takes a Supabase user object (or null) and returns a capabilities
 * object describing what this viewer can do.
 *
 * Safe to call anywhere. No side effects, no network, no hooks.
 *
 * @param {object|null} user - Supabase user (from supabase.auth.getUser())
 * @returns {object} capabilities
 */
export function getViewerCapabilities(user) {
  // ─── Public tier (no session) ────────────────────────────────────
  if (!user) {
    return {
      role: 'public',
      isAuthed: false,
      userId: null,

      // Action gates — all false for public viewers
      canSave: false,         // save to watchlist
      canFollow: false,       // follow a committee
      canEditNotes: false,    // add / edit bill notes
      canExport: false,       // PDF / leave-behind export
      canSeeAlerts: false,    // alert / digest UI
      canSeeAdmin: false,     // admin surfaces

      // Visibility predicates — public sees every bill/committee in
      // scope of the public layer. Returns a function for consistency
      // with the future client shape (which filters by tag).
      canSeeBill: () => true,
      canSeeCommittee: () => true,
    }
  }

  // ─── Owner tier (the only authed shape today) ────────────────────
  return {
    role: 'owner',
    isAuthed: true,
    userId: user.id,

    canSave: true,
    canFollow: true,
    canEditNotes: true,
    canExport: true,
    canSeeAlerts: true,
    canSeeAdmin: false, // admin routes still do their own UID check

    canSeeBill: () => true,
    canSeeCommittee: () => true,
  }

  // ─── Client tier (2028+) — NOT IMPLEMENTED ──────────────────────
  // When the client portal returns, add a third branch above this
  // comment. Shape should look like:
  //
  //   if (user.role === 'client') {
  //     const tags = user.assigned_tags || []
  //     return {
  //       role: 'client',
  //       isAuthed: true,
  //       userId: user.id,
  //       canSave: true,
  //       canFollow: false,
  //       canEditNotes: (note) =>
  //         note.scope === 'shared' || note.author_id === user.id,
  //       canExport: true,
  //       canSeeAlerts: true,
  //       canSeeAdmin: false,
  //       canSeeBill: (bill) => tags.includes(bill.tag),
  //       canSeeCommittee: () => true,
  //     }
  //   }
  //
  // Plus three RLS policies (bills filtered by tag, bill_notes
  // filtered by author/shared scope, watchlist filtered by user_id).
  // See: PHASE_12_PUBLIC_LAYER_PLAN.md §5.
}

// ─── React hook: subscribe to live auth state ──────────────────────
/**
 * Returns { user, capabilities, loading, publicLayerEnabled }.
 *
 * Subscribes to Supabase auth changes so login / logout / token
 * refresh updates capabilities live without a page reload.
 *
 * Usage pattern in a page that CAN be public:
 *
 *   const { capabilities, loading, publicLayerEnabled } = useViewer()
 *   if (!loading && !capabilities.isAuthed && !publicLayerEnabled) {
 *     router.push('/login')
 *     return null
 *   }
 *
 * Usage pattern in a page that is ALWAYS private (watchlist, settings):
 *
 *   const { capabilities, loading } = useViewer()
 *   if (!loading && !capabilities.isAuthed) {
 *     router.push('/login')
 *     return null
 *   }
 */
export function useViewer() {
  const supabase = createBrowserClient()
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true

    // Initial fetch
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (!mounted) return
      setUser(u || null)
      setLoading(false)
    })

    // Subscribe — covers login, logout, token refresh, cross-tab sync
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setUser(session?.user || null)
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    user,
    capabilities: getViewerCapabilities(user),
    loading,
    publicLayerEnabled: PUBLIC_LAYER_ENABLED,
  }
}
