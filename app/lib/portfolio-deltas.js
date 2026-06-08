/**
 * Vector | WA — portfolio weekly delta (DASH-3).
 *
 * Computes how the watchlist's average trajectory has moved versus ~7 days ago
 * from trajectory_snapshots (bill_id, score, snapshot_date). Backfills the
 * DASH-1 hero stub — the "vs last week" line under the portfolio gauge that
 * shipped as a literal placeholder.
 *
 * Off the critical path: call it after first paint, like the per-bill score
 * chip fetch — never block the gauge on it. During the interim scores are
 * frozen, so the caller skips it entirely and the hero shows a frozen state
 * instead of a fabricated move.
 *
 * Method: for each tracked bill, take its latest snapshot as "now" and the
 * snapshot closest on-or-before (latest - 7 days) as the reference, then
 * average the per-bill (now - ref) deltas over the bills that have both
 * endpoints. A 14-day lookback window keeps the read tiny (<= ~30 bills x ~14
 * rows). snapshot_date is a 'YYYY-MM-DD' string, so lexical compare === date
 * compare.
 */

const WINDOW_DAYS = 14
const TARGET_BACK_DAYS = 7

function isoDaysAgo(days, from = new Date()) {
  const d = new Date(from)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * @param {object} supabase browser client
 * @param {string[]} billIds tracked bill_id strings
 * @param {Date} [now]
 * @returns {Promise<{ delta:number, basis:number }|null>}
 *   delta  signed integer (rounded): avg trajectory change vs ~7 days ago
 *   basis  number of bills that had both endpoints (null when too sparse)
 */
export async function getPortfolioWeeklyDelta(supabase, billIds, now = new Date()) {
  const ids = [...new Set((billIds || []).filter(Boolean))]
  if (ids.length === 0) return null

  const since = isoDaysAgo(WINDOW_DAYS, now)
  const { data, error } = await supabase
    .from('trajectory_snapshots')
    .select('bill_id, score, snapshot_date')
    .in('bill_id', ids)
    .gte('snapshot_date', since)
    .order('snapshot_date', { ascending: false })
  if (error || !data || data.length === 0) return null

  // Group snapshots per bill, newest first (query is already date-desc).
  const byBill = {}
  for (const s of data) {
    if (s.score == null || !s.snapshot_date) continue
    if (!byBill[s.bill_id]) byBill[s.bill_id] = []
    byBill[s.bill_id].push(s)
  }

  let sum = 0
  let basis = 0
  for (const snaps of Object.values(byBill)) {
    const current = snaps[0] // latest
    const cutoff = isoDaysAgo(TARGET_BACK_DAYS, new Date(current.snapshot_date))
    // closest snapshot on-or-before (latest - 7d); snaps are date-desc
    let ref = null
    for (const s of snaps) {
      if (s.snapshot_date <= cutoff) { ref = s; break }
    }
    // fall back to the oldest in-window point if nothing reaches back a week
    if (!ref && snaps.length >= 2) ref = snaps[snaps.length - 1]
    if (!ref || ref.snapshot_date === current.snapshot_date) continue
    sum += (current.score - ref.score)
    basis += 1
  }

  if (basis === 0) return null
  return { delta: Math.round(sum / basis), basis }
}
