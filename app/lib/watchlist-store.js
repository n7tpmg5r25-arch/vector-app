/**
 * watchlist-store.js — the personal-watchlist seam (PORTAL-1, 2026-06-10).
 *
 * Single chokepoint for every personal-watchlist read/write that used to
 * talk to `tracked_bills` directly from page code. Pages call these verbs;
 * the verbs run the exact Supabase queries the pages ran before (moved
 * verbatim — zero behavior change). PORTAL-2 adds a second, localStorage
 * backend behind this same surface for anonymous viewers, so pages will
 * not need to change again when that lands.
 *
 * Contract:
 *   - Construct at the call site: `watchlistStore(user)` with the viewer
 *     object from useViewer(). Every caller already guards on `user`
 *     before touching the watchlist — keep doing that, same as before.
 *   - Every verb returns the live Supabase builder (a thenable), so call
 *     sites keep their existing `await` / `.then(({ data }) => ...)`
 *     destructuring untouched. Resolution shapes:
 *       list / ids / get / add        → { data, error }
 *       addMany / remove / update /
 *       touchViewed                   → { data, error } (data unused)
 *       count                         → { count, error }
 *   - Team/admin/server surfaces (/c/[slug], assign-bills, the .ics
 *     route, detect-alerts) are identity- or service-role-bound by
 *     definition and intentionally stay on direct Supabase. Do NOT route
 *     them through this store.
 *
 * Verbs follow the PORTAL_DEEP_DIVE.md §2.3 contract — list / ids / add /
 * remove / update / touchViewed / count — plus two extensions the live
 * call sites required: get(billId) (bill-detail tracked check,
 * maybeSingle) and addMany(billIds, opts) (search bulk add — one INSERT
 * of N rows, not N inserts).
 */

import { createBrowserClient } from './supabase'

export function watchlistStore(user) {
  const supabase = createBrowserClient()
  const uid = user?.id

  return {
    /**
     * Joined load of the viewer's watchlist rows. `select` passes through
     * verbatim (PostgREST embedded selects allowed) — the watchlist and
     * home pages each keep their own column sets. `ordered` keeps the
     * added_at DESC ordering those two pages use; the committees page
     * passes false to stay byte-identical to its original un-ordered
     * query.
     */
    list({ select, ordered = true } = {}) {
      let q = supabase
        .from('tracked_bills')
        .select(select)
        .eq('user_id', uid)
      if (ordered) q = q.order('added_at', { ascending: false })
      return q
    },

    /**
     * bill_id-only rows for watched-state checks (search, radar,
     * hearings). `billIds` narrows with .in() — the committee detail page
     * checks only the bills it just fetched.
     */
    ids({ billIds } = {}) {
      let q = supabase
        .from('tracked_bills')
        .select('bill_id')
        .eq('user_id', uid)
      if (billIds) q = q.in('bill_id', billIds)
      return q
    },

    /** Single-row tracked check (bill detail). Resolves { data: row|null }. */
    get(billId) {
      return supabase
        .from('tracked_bills')
        .select('*')
        .eq('bill_id', billId)
        .eq('user_id', uid)
        .maybeSingle()
    },

    /**
     * Watch one bill. Returns the inserted row ({ data }) — bill detail
     * stores it as `tracked`; search and radar ignore it.
     */
    add(billId, { tag = null, notes = '' } = {}) {
      return supabase
        .from('tracked_bills')
        .insert({ bill_id: billId, user_id: uid, notes, tag })
        .select()
        .single()
    },

    /** Bulk watch (search "Watch all"). One INSERT of N rows, as before. */
    addMany(billIds, { tag = null, notes = '' } = {}) {
      return supabase
        .from('tracked_bills')
        .insert(billIds.map(bill_id => ({ bill_id, user_id: uid, tag, notes })))
    },

    /** Unwatch one bill. */
    remove(billId) {
      return supabase
        .from('tracked_bills')
        .delete()
        .eq('bill_id', billId)
        .eq('user_id', uid)
    },

    /** Save tag/notes on an already-watched bill (bill detail). */
    update(billId, { notes, tag }) {
      return supabase
        .from('tracked_bills')
        .update({ notes, tag })
        .eq('bill_id', billId)
        .eq('user_id', uid)
    },

    /** Stamp last_viewed_at on every row (watchlist page visit). */
    touchViewed() {
      return supabase
        .from('tracked_bills')
        .update({ last_viewed_at: new Date().toISOString() })
        .eq('user_id', uid)
    },

    /** Cheap head count for the drawer badge. Resolves { count }. */
    count() {
      return supabase
        .from('tracked_bills')
        .select('bill_id', { count: 'exact', head: true })
        .eq('user_id', uid)
    },
  }
}
