'use client'
/**
 * Viewer Capabilities — Phase 12 Public Layer + Phase 13a Client Portal
 *
 * Single source of truth for what the current viewer can do. Pages and
 * components consult this helper instead of checking supabase.auth.getUser()
 * directly in ad-hoc ways.
 *
 * Three tiers:
 *   • public — no session, sees the anon-readable slice of the app
 *   • owner  — Colin, full read/write across everything
 *   • client — portal viewer (13a: read-only, structural only; no UI consumes
 *              this branch yet — portal pages land in 13b)
 *
 * Client-tier detection is cheap: we read `user.app_metadata?.role === 'client'`
 * straight off the Supabase user object. The admin invite flow in 13b will set
 * that app_metadata flag via the service-role admin API when inserting the
 * user into `client_users`. Zero network cost per useViewer() mount.
 *
 * NAMING NOTE: in this app, the existing useSession() hook is the
 * biennium selector (2025-2026 vs 2023-2024), NOT the auth session.
 * Do not confuse. Auth viewer state lives HERE.
 *
 * See: PHASE_12_PUBLIC_LAYER_PLAN.md §5 + PHASE_13_CLIENT_PORTAL_PLAN.md §6.
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

      // Action gates — PORTAL-2: when the public layer is on, anonymous
      // viewers can save to a device-local watchlist (the localStorage
      // backend behind watchlist-store.js). canEditNotes follows canSave:
      // anon tag/notes live inside the local watchlist row, not in
      // bill_notes (a registered feature). Flag off -> every gate below
      // is false, exactly as before PORTAL-2.
      canSave: PUBLIC_LAYER_ENABLED,      // save to watchlist (device-local)
      canFollow: false,       // follow a committee
      canEditNotes: PUBLIC_LAYER_ENABLED, // tag / notes on locally-watched bills
      canEditBillSummary: false, // edit the global AI bill summary (admin-only)
      canExport: false,       // PDF / leave-behind export
      canSeeAlerts: false,    // alert / digest UI
      canSeeAdmin: false,     // admin surfaces

      // PORTAL-2: which backend watchlist-store.js serves this viewer.
      // Anon saves stay on this device until register-to-sync (PORTAL-4).
      saveMode: 'local',

      // Note-visibility seams (landed Phase 13a; used by 13b's shared-note UI)
      canSeePrivateNotes: false,
      canSeeSharedNotes: false,

      // Visibility predicates — public sees every bill/committee in the
      // anon-readable slice of the app.
      canSeeBill: () => true,
      canSeeCommittee: () => true,
    }
  }

  // ─── Client tier (Phase 13a — structural; no UI consumes this yet) ──
  // Detection: the admin invite flow in 13b sets app_metadata.role='client'
  // on the Supabase user via the service-role admin API. Read-only v1 per
  // PHASE_13_CLIENT_PORTAL_PLAN.md §4 permission matrix + §6.
  if (user.app_metadata?.role === 'client') {
    return {
      role: 'client',
      isAuthed: true,
      userId: user.id,

      canSave: false,         // read-only v1
      canFollow: false,       // alerts deferred to 13b.x
      canEditNotes: false,    // no write surfaces for clients in v1
      canEditBillSummary: false, // edit the global AI bill summary (admin-only)
      canExport: false,       // PDF briefing deferred to 13b.x
      canSeeAlerts: false,    // email alerts deferred to 13b.x
      canSeeAdmin: false,

      // PORTAL-2: authed viewers always use the db watchlist backend.
      saveMode: 'db',

      // 13a opens the door for 13b shared-note surfacing. The RLS policy
      // that actually serves `scope='shared'` rows to clients lands in 13b.x
      // (see PHASE_13_CLIENT_PORTAL_PLAN.md §5.2) — this capability gate
      // pre-wires the UI side of the same decision.
      canSeePrivateNotes: false,
      canSeeSharedNotes: true,

      // Bill and committee data are anon-readable (Batch 2 RLS relax); any
      // client-scoping happens at the app layer by filtering to bill_ids
      // inside the client's tracked_bills. The helper is not the right
      // place to do that — portal pages query with client_id directly.
      canSeeBill: () => true,
      canSeeCommittee: () => true,
    }
  }

  // ─── Owner tier (default authed shape — Colin) ───────────────────
  return {
    role: 'owner',
    isAuthed: true,
    userId: user.id,

    canSave: true,
    canFollow: true,
    canEditNotes: true,
    // T156: bill summary edits update the global bills.custom_summary column —
    // visible to all users. Gate separately from canEditNotes (private notes).
    // PORTAL-5: register-to-sync (PORTAL-4) opens multi-user registered
    // accounts, so this is now the explicit admin check that comment
    // promised. app_metadata is server-controlled (users cannot edit
    // their own), and the admin_update_bills RLS policy on public.bills
    // enforces the same claim at the database, so UI and DB agree even
    // when the REST API is called directly.
    canEditBillSummary: user.app_metadata?.role === 'admin',
    canExport: true,
    canSeeAlerts: true,
    canSeeAdmin: false, // admin routes still do their own UID check

    // PORTAL-2: authed viewers always use the db watchlist backend.
    saveMode: 'db',

    canSeePrivateNotes: true,
    canSeeSharedNotes: true,

    canSeeBill: () => true,
    canSeeCommittee: () => true,
  }
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

    // Initial gate (T157 perf): use getSession() — it reads the JWT straight
    // from local storage with NO network round-trip, so the page can start
    // loading data immediately. getUser() (the previous call) validated the
    // token against the Supabase Auth server on every mount, putting a network
    // hop on the critical path before any data query could fire. The
    // onAuthStateChange subscription below still keeps the viewer live on
    // login / logout / token refresh, so correctness is unchanged.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      setUser(session?.user || null)
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
