'use client'
/**
 * MergeLocalWatchlist -- register-to-sync (PORTAL-4, 2026-06-11).
 *
 * Mounted once in the root layout (app/app/layout.tsx) -- NOT in
 * /auth/callback, because the OTP login path never visits the callback:
 * login verifies the 8-digit code in-page and hard-reloads straight to
 * `/` (login/page.js handleVerifyOtp). The root layout is the one
 * surface both auth paths (OTP reload + magic-link callback redirect)
 * are guaranteed to mount.
 *
 * What it does: when a signed-in viewer arrives with bills saved in the
 * device-local watchlist (PORTAL-2's localStorage backend), it moves
 * those rows into tracked_bills under the new identity, clears the
 * device copy, and shows a one-time "N bills moved to your account"
 * banner. Conservative and idempotent per PORTAL_DEEP_DIVE.md S3.3:
 *
 *   - Local-only bill      -> INSERT preserving local added_at / tag /
 *                             notes (alert_enabled = DB default).
 *   - Already tracked      -> server wins; never overwrite server
 *                             tag/notes. One exception: empty server
 *                             notes adopt non-empty local notes
 *                             (non-destructive enrich).
 *   - last_viewed_at       -> max(local, server).
 *   - Insert failure       -> that bill STAYS on the device and a retry
 *                             banner appears. A partial merge never
 *                             destroys local data -- only rows that made
 *                             it to the server leave the device.
 *   - Duplicate-key race   -> another tab won the insert; the row now
 *                             exists server-side, so server-wins applies
 *                             and the local copy is released.
 *
 * Full success writes the receipt `vec_local_watchlist_migrated_v1` =
 * { at, count } and clears `vec_local_watchlist_v1`. The receipt is an
 * audit record + the banner's one-time guarantee -- it does NOT block
 * future merges, so a viewer who signs out, saves more bills
 * anonymously, and signs back in gets those synced too. What makes the
 * second sign-in a no-op is the empty device list, not the receipt.
 *
 * Concurrency: a per-tab sessionStorage guard (`vec_merge_inflight`)
 * stops overlapping runs (React StrictMode double-effects, rapid auth
 * events). Cross-tab overlap is harmless by construction -- the loser
 * of an insert race hits 23505, which is treated as merged.
 *
 * Flag-off behavior: PUBLIC_LAYER_ENABLED false -> the effect bails
 * before touching anything and the component renders null. Anonymous
 * saving does not exist with the flag off, so there is never anything
 * to merge in prod until the public launch flips the flag.
 */

import { useEffect, useState } from 'react'
import { createBrowserClient } from '../../lib/supabase'
import { PUBLIC_LAYER_ENABLED, useViewer } from '../../lib/viewer-capabilities'
import {
  readLocalItems,
  writeLocalItems,
  LOCAL_WATCHLIST_KEY,
  LOCAL_WATCHLIST_EVENT,
} from '../../lib/useLocalWatchlist'

export const LOCAL_WATCHLIST_MIGRATED_KEY = 'vec_local_watchlist_migrated_v1'
const INFLIGHT_KEY = 'vec_merge_inflight'

/** Clear the device list and broadcast so mounted watchlist UI updates. */
function clearLocal() {
  try {
    window.localStorage.removeItem(LOCAL_WATCHLIST_KEY)
    window.dispatchEvent(new CustomEvent(LOCAL_WATCHLIST_EVENT, { detail: [] }))
  } catch {
    /* storage unavailable -- nothing to clear */
  }
}

function writeReceipt(count) {
  try {
    window.localStorage.setItem(
      LOCAL_WATCHLIST_MIGRATED_KEY,
      JSON.stringify({ at: new Date().toISOString(), count })
    )
  } catch {
    /* receipt is best-effort -- the merge itself already succeeded */
  }
}

/**
 * Move every device-local watchlist row into tracked_bills for `user`.
 * Returns { merged, failed }. On any per-row failure the affected rows
 * stay in localStorage so a retry can re-attempt them.
 */
async function mergeLocalIntoAccount(user) {
  const supabase = createBrowserClient()
  const items = readLocalItems()
  if (items.length === 0) return { merged: 0, failed: 0 }

  // 1 -- what does the account already track among these bills?
  const { data: serverRows, error: readError } = await supabase
    .from('tracked_bills')
    .select('bill_id, tag, notes, last_viewed_at')
    .eq('user_id', user.id)
    .in('bill_id', items.map(it => it.bill_id))
  if (readError) {
    // Cannot see server state -- touch nothing, surface retry.
    return { merged: 0, failed: items.length }
  }
  const serverBy = new Map((serverRows || []).map(r => [r.bill_id, r]))

  const failedIds = new Set()
  let merged = 0

  for (const it of items) {
    const srv = serverBy.get(it.bill_id)

    if (!srv) {
      // Local-only -> INSERT preserving watch history (S3.3 row 1).
      // alert_enabled omitted on purpose: the DB default applies.
      const { error } = await supabase.from('tracked_bills').insert({
        bill_id: it.bill_id,
        user_id: user.id,
        tag: it.tag ?? null,
        notes: it.notes || '',
        added_at: it.added_at || new Date().toISOString(),
        last_viewed_at: it.last_viewed_at || null,
      })
      if (error && error.code !== '23505') {
        // RLS, network, anything unexpected -> keep the local copy.
        failedIds.add(it.bill_id)
        continue
      }
      // error.code 23505 = unique-violation race: another tab inserted
      // it first. The row exists server-side now -> server wins -> the
      // local copy is released as merged.
      merged += 1
      continue
    }

    // Server row exists -> server wins (S3.3 row 2). Build the one
    // allowed enrich patch: empty server notes adopt local notes;
    // last_viewed_at takes the max. Never touch server tag.
    const patch = {}
    if ((!srv.notes || srv.notes.trim() === '') && it.notes && it.notes.trim() !== '') {
      patch.notes = it.notes
    }
    if (it.last_viewed_at && (!srv.last_viewed_at || it.last_viewed_at > srv.last_viewed_at)) {
      patch.last_viewed_at = it.last_viewed_at
    }
    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from('tracked_bills')
        .update(patch)
        .eq('bill_id', it.bill_id)
        .eq('user_id', user.id)
      if (error) {
        // Enrich failed -- keep the local copy so retry can re-attempt.
        failedIds.add(it.bill_id)
        continue
      }
    }
    merged += 1
  }

  if (failedIds.size === 0) {
    writeReceipt(merged)
    clearLocal()
  } else {
    // Partial: only rows that reached the server leave the device.
    writeLocalItems(items.filter(it => failedIds.has(it.bill_id)))
  }
  return { merged, failed: failedIds.size }
}

export default function MergeLocalWatchlist() {
  const { user } = useViewer()
  // banner: null | { kind: 'ok' | 'retry', count: number }
  const [banner, setBanner] = useState(null)
  const [running, setRunning] = useState(false)

  async function run(u) {
    try {
      window.sessionStorage.setItem(INFLIGHT_KEY, '1')
    } catch {
      /* guard unavailable -- proceed; the merge is idempotent anyway */
    }
    setRunning(true)
    try {
      const { merged, failed } = await mergeLocalIntoAccount(u)
      if (failed > 0) {
        setBanner({ kind: 'retry', count: failed })
      } else if (merged > 0) {
        setBanner({ kind: 'ok', count: merged })
      }
    } catch {
      // Hard network failure mid-merge: rows already inserted are safe
      // server-side, local list is untouched until the success branch,
      // and a re-run is idempotent (dups resolve as 23505 -> merged).
      setBanner({ kind: 'retry', count: readLocalItems().length })
    } finally {
      setRunning(false)
      try {
        window.sessionStorage.removeItem(INFLIGHT_KEY)
      } catch {
        /* noop */
      }
    }
  }

  useEffect(() => {
    if (!PUBLIC_LAYER_ENABLED) return
    if (!user) return
    if (readLocalItems().length === 0) return
    try {
      if (window.sessionStorage.getItem(INFLIGHT_KEY)) return
    } catch {
      /* unreadable guard -- fall through; the merge is idempotent */
    }
    run(user)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  if (!PUBLIC_LAYER_ENABLED || !banner) return null

  const ok = banner.kind === 'ok'
  const n = banner.count
  const line = ok
    ? `${n} bill${n === 1 ? '' : 's'} moved to your account`
    : `${n} bill${n === 1 ? '' : 's'} did not sync`
  const sub = ok
    ? 'Tags, notes, and saved dates came along.'
    : 'Still saved on this device \u2014 nothing was lost.'

  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
        left: '50%',
        transform: 'translateX(-50%)',
        width: 'calc(100% - 32px)',
        maxWidth: 448,
        zIndex: 1000,
        background: 'var(--bg-card)',
        border: `1px solid ${ok ? 'var(--sage-glow)' : 'var(--amber-glow)'}`,
        borderLeft: `3px solid ${ok ? 'var(--sage)' : 'var(--amber)'}`,
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: ok ? 'var(--sage)' : 'var(--amber)',
            marginBottom: 4,
          }}
        >
          Watchlist sync
        </div>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 13.5,
            fontWeight: 600,
            color: 'var(--text-primary)',
            lineHeight: 1.4,
          }}
        >
          {line}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--text-muted)',
            lineHeight: 1.45,
            marginTop: 2,
          }}
        >
          {sub}
        </div>
        {!ok && (
          <button
            onClick={() => user && !running && run(user)}
            disabled={running}
            style={{
              marginTop: 8,
              padding: '7px 16px',
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid rgba(184,151,90,0.40)',
              borderRadius: 'var(--radius)',
              color: 'var(--brass-light, var(--gold))',
              fontFamily: 'var(--font-body)',
              fontSize: 12.5,
              fontWeight: 500,
              letterSpacing: '0.02em',
              cursor: running ? 'default' : 'pointer',
            }}
          >
            {running ? 'Syncing\u2026' : 'Retry sync'}
          </button>
        )}
      </div>
      <button
        onClick={() => setBanner(null)}
        aria-label="Dismiss"
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-faint)',
          fontSize: 16,
          lineHeight: 1,
          padding: '2px 4px',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        {'\u00d7'}
      </button>
    </div>
  )
}