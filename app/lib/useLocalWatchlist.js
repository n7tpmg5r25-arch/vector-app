'use client'
/**
 * useLocalWatchlist() — device-local watchlist for anonymous viewers
 * (PORTAL-2, 2026-06-10).
 *
 * Storage: one localStorage key, JSON envelope { v: 1, items: [...] }.
 * Each item mirrors only the tracked_bills columns the app actually
 * writes (PORTAL_DEEP_DIVE.md S2.2):
 *
 *   { bill_id, tag, notes, added_at, last_viewed_at }
 *
 * Deliberately omitted: user_id / client_id (no identity), id (DB
 * sequence), alert_enabled (registered feature — the DB default applies
 * when rows merge on register, PORTAL-4), personal_note (dead column).
 *
 * Caps: 200 items (PostgREST .in() hydration headroom + honest UI
 * scale) and 2,000 chars of notes. At the item cap the add affordance
 * flips to the register prompt — the cap itself is enforced in
 * watchlist-store.js's local backend, the only writer.
 *
 * Propagation copies app/lib/useSession.js exactly (Thread 86 pattern):
 * same-window updates broadcast a custom window event, because the
 * native `storage` event only fires in OTHER tabs; cross-tab sync rides
 * the native `storage` event. SSR-safe lazy init + a mount sync handle
 * hydration.
 *
 * Durability honesty (S2.1): in Safari-tab browsing, ITP can evict
 * script-writable storage after ~7 days away; the installed PWA is
 * exempt. Register-to-sync (PORTAL-4) is the durability story — UI
 * copy says "saved on this device — create a free account to keep it
 * everywhere."
 */
import { useState, useEffect } from 'react'

export const LOCAL_WATCHLIST_KEY = 'vec_local_watchlist_v1'
export const LOCAL_WATCHLIST_EVENT = 'vec-local-watchlist-change'
export const LOCAL_WATCHLIST_CAP = 200
export const LOCAL_WATCHLIST_NOTES_MAX = 2000

/**
 * Read the local watchlist items. SSR-safe ([] on the server) and
 * fail-soft: a missing key, malformed JSON, an unknown envelope
 * version, or blocked localStorage all read as "nothing saved".
 */
export function readLocalItems() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LOCAL_WATCHLIST_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.items)) return []
    return parsed.items
  } catch {
    return []
  }
}

/**
 * Persist items and broadcast to every mounted useLocalWatchlist() in
 * this window (other tabs hear the native `storage` event). Returns
 * false when the write failed (quota, private mode) so the store can
 * surface { error } instead of pretending it saved.
 */
export function writeLocalItems(items) {
  if (typeof window === 'undefined') return false
  try {
    window.localStorage.setItem(
      LOCAL_WATCHLIST_KEY,
      JSON.stringify({ v: 1, items })
    )
    window.dispatchEvent(
      new CustomEvent(LOCAL_WATCHLIST_EVENT, { detail: items })
    )
    return true
  } catch {
    return false
  }
}

// Cheap change detector for the mount-sync effect — avoids a pointless
// re-render when the freshly-read array is content-identical to the
// lazy-init read. Payload is tiny (<=200 small rows); stringify is fine.
function sameItems(a, b) {
  if (a === b) return true
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Live read-only view of the local watchlist. Returns the items array;
 * it updates when any code path writes through writeLocalItems() (same
 * window) or when another tab writes (native `storage` event).
 * Mutations go through watchlistStore() verbs — never write the key
 * directly.
 */
export function useLocalWatchlist() {
  const [items, setItems] = useState(() => readLocalItems())

  // Sync with localStorage on mount (handles SSR hydration mismatch)
  useEffect(() => {
    const fresh = readLocalItems()
    setItems(prev => (sameItems(prev, fresh) ? prev : fresh))
  }, [])

  // Same-window propagation: react when the store writes while this
  // page is already mounted (mirror of useSession's vec-session-change).
  useEffect(() => {
    function onChange(e) {
      setItems(Array.isArray(e.detail) ? e.detail : readLocalItems())
    }
    window.addEventListener(LOCAL_WATCHLIST_EVENT, onChange)
    return () => window.removeEventListener(LOCAL_WATCHLIST_EVENT, onChange)
  }, [])

  // Cross-tab propagation via the native `storage` event.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== LOCAL_WATCHLIST_KEY) return
      setItems(readLocalItems())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  return items
}
