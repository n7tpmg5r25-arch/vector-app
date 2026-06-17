/**
 * watchlist-store.js — the personal-watchlist seam (PORTAL-1, 2026-06-10).
 *
 * Single chokepoint for every personal-watchlist read/write that used to
 * talk to `tracked_bills` directly from page code. Pages call these verbs;
 * the verbs run the exact Supabase queries the pages ran before (moved
 * verbatim — zero behavior change). PORTAL-2 (2026-06-10) adds the
 * second backend behind this same surface: when the viewer is anonymous
 * AND the public layer is on, the verbs read/write a device-local
 * watchlist (localStorage via useLocalWatchlist.js) instead — same
 * names, same result shapes, so pages do not branch.
 *
 * Contract:
 *   - Construct at the call site: `watchlistStore(user)` with the viewer
 *     object from useViewer(). PORTAL-2: callers guard on
 *     `user || capabilities.canSave` — anon viewers pass `null` and get
 *     the local backend when the public layer flag is on. With the flag
 *     off, anon callers bail before constructing a store, exactly as
 *     before.
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
import { PUBLIC_LAYER_ENABLED } from './viewer-capabilities'
import {
  readLocalItems,
  writeLocalItems,
  LOCAL_WATCHLIST_CAP,
  LOCAL_WATCHLIST_NOTES_MAX,
} from './useLocalWatchlist'

// ─── Local backend (PORTAL-2) ───────────────────────────────────────
// Device-local mirror of the db verbs for anonymous viewers. Every verb
// resolves the same shape the Supabase builder resolves — { data, error }
// (count → { count, error }) — so call-site destructuring is identical.
// Writes go through writeLocalItems(), which broadcasts to every mounted
// useLocalWatchlist() and to other tabs.

function localOk(data) {
  return Promise.resolve({ data, error: null })
}

function localFail(code, message) {
  return Promise.resolve({ data: null, error: { code, message } })
}

const CAP_MESSAGE =
  `Device watchlist is full (${LOCAL_WATCHLIST_CAP} bills). ` +
  'Create a free account to keep going.'

function clampNotes(notes) {
  const s = typeof notes === 'string' ? notes : ''
  return s.length > LOCAL_WATCHLIST_NOTES_MAX
    ? s.slice(0, LOCAL_WATCHLIST_NOTES_MAX)
    : s
}

function localWatchlistStore() {
  return {
    /**
     * Local list — returns the raw local rows ({ bill_id, tag, notes,
     * added_at, last_viewed_at }). `select` is accepted for surface
     * parity but CANNOT join: there is no embedded bills(...) relation
     * in localStorage. Callers hydrate per PORTAL_DEEP_DIVE.md §2.3:
     * ids() → supabase.from('bills').select(<same columns>)
     * .in('bill_id', ids) — bills is anon-readable and the 200-item cap
     * stays far under the 1000-row PostgREST limit.
     */
    list({ select, ordered = true } = {}) { // eslint-disable-line no-unused-vars
      const items = readLocalItems().slice()
      if (ordered) {
        items.sort((a, b) => (b.added_at || '').localeCompare(a.added_at || ''))
      }
      return localOk(items)
    },

    ids({ billIds } = {}) {
      let rows = readLocalItems().map(it => ({ bill_id: it.bill_id }))
      if (billIds) {
        const want = new Set(billIds)
        rows = rows.filter(r => want.has(r.bill_id))
      }
      return localOk(rows)
    },

    get(billId) {
      const item = readLocalItems().find(it => it.bill_id === billId)
      return localOk(item ? { ...item } : null)
    },

    add(billId, { tag = null, notes = '' } = {}) {
      const items = readLocalItems()
      const existing = items.find(it => it.bill_id === billId)
      // Idempotent: pages gate the add affordance on watched-state, so a
      // duplicate add is a race artifact — return the row that exists.
      if (existing) return localOk({ ...existing })
      if (items.length >= LOCAL_WATCHLIST_CAP) {
        return localFail('LOCAL_WATCHLIST_CAP', CAP_MESSAGE)
      }
      const item = {
        bill_id: billId,
        tag,
        notes: clampNotes(notes),
        added_at: new Date().toISOString(),
        last_viewed_at: null,
      }
      if (!writeLocalItems([...items, item])) {
        return localFail('LOCAL_WRITE_FAILED', 'Could not save on this device (storage unavailable).')
      }
      return localOk({ ...item })
    },

    /** All-or-nothing against the cap, mirroring the single db INSERT. */
    addMany(billIds, { tag = null, notes = '' } = {}) {
      const items = readLocalItems()
      const have = new Set(items.map(it => it.bill_id))
      const fresh = (billIds || []).filter(id => !have.has(id))
      if (items.length + fresh.length > LOCAL_WATCHLIST_CAP) {
        return localFail('LOCAL_WATCHLIST_CAP', CAP_MESSAGE)
      }
      if (fresh.length === 0) return localOk(null)
      const now = new Date().toISOString()
      const adds = fresh.map(bill_id => ({
        bill_id,
        tag,
        notes: clampNotes(notes),
        added_at: now,
        last_viewed_at: null,
      }))
      if (!writeLocalItems([...items, ...adds])) {
        return localFail('LOCAL_WRITE_FAILED', 'Could not save on this device (storage unavailable).')
      }
      return localOk(null)
    },

    remove(billId) {
      const items = readLocalItems()
      const next = items.filter(it => it.bill_id !== billId)
      if (next.length !== items.length && !writeLocalItems(next)) {
        return localFail('LOCAL_WRITE_FAILED', 'Could not save on this device (storage unavailable).')
      }
      return localOk(null)
    },

    update(billId, { notes, tag }) {
      const items = readLocalItems()
      let touched = false
      const next = items.map(it => {
        if (it.bill_id !== billId) return it
        touched = true
        const out = { ...it }
        if (notes !== undefined) out.notes = clampNotes(notes)
        if (tag !== undefined) out.tag = tag
        return out
      })
      if (touched && !writeLocalItems(next)) {
        return localFail('LOCAL_WRITE_FAILED', 'Could not save on this device (storage unavailable).')
      }
      return localOk(null)
    },

    touchViewed() {
      const items = readLocalItems()
      if (items.length === 0) return localOk(null)
      const now = new Date().toISOString()
      if (!writeLocalItems(items.map(it => ({ ...it, last_viewed_at: now })))) {
        return localFail('LOCAL_WRITE_FAILED', 'Could not save on this device (storage unavailable).')
      }
      return localOk(null)
    },

    /** Resolves { count } like the db head-count. */
    count() {
      return Promise.resolve({ data: null, count: readLocalItems().length, error: null })
    },
  }
}

export function watchlistStore(user) {
  // PORTAL-2: anonymous viewer + public layer on → device-local backend.
  // Flag off → this branch is unreachable in practice (pages bail before
  // constructing an anon store) and the db path below is byte-identical
  // to PORTAL-1 either way.
  if (!user && PUBLIC_LAYER_ENABLED) return localWatchlistStore()

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
