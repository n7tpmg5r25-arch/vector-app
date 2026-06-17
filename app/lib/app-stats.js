/**
 * App-wide statistical aggregates.
 *
 * Single source of truth for cross-biennium bill counts that appear in
 * prose on the methodology page, the PDF brief, and anywhere else a
 * specific "N bills across X biennia" citation would otherwise drift.
 *
 * Queries are live — no hardcoded numbers. If a query fails the caller
 * should fall back to a baked-in constant that matches the engine
 * calibration cohort (historically N=8,062, the scoreBill() calibration
 * cohort as of the 2025-26 biennium).
 *
 * Calibration constants (G5 frozen):
 *  - CALIBRATION_LAW_FALLBACK = 2155 (total LAW outcomes across the
 *    calibration cohort; sum of HIGH/MOD/LOW/VERY-LOW law counts in
 *    methodology CALIBRATION_FALLBACK). Frozen until the post-2027
 *    session calibration refresh — see Universal guardrails §G5.
 */

import { getAllSessions } from './session-config'

/**
 * Total LAW outcomes across the engine calibration cohort
 * (Phase 7D.3 — April 12, 2026 — 8,062 bills-only across 3 bienniums).
 * Frozen literal per G5; do not modernize until the Jan 2028 recalibration.
 */
export const CALIBRATION_LAW_FALLBACK = 2155

/**
 * Count of "bills" (legislation_type = 'bill', which excludes resolutions
 * and memorials — matches the cohort used to calibrate scoreBill()) across
 * the supplied sessions. Runs one count query per session in parallel so
 * we also get a per-biennium breakdown for prose.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} sb
 * @param {string[]} [sessions] — defaults to getAllSessions() (newest first)
 * @returns {Promise<{
 *   total: number,
 *   bySession: Record<string, number>,
 *   biennia: string[],            // sessions that returned a count (oldest first)
 *   computedAt: Date,
 *   ok: boolean,                   // true if every per-session query succeeded
 * }>}
 */
export async function fetchTotalScoredBills(sb, sessions) {
  const list = sessions && sessions.length ? sessions : getAllSessions()

  const results = await Promise.all(
    list.map(async (session) => {
      const { count, error } = await sb
        .from('bills')
        .select('bill_id', { count: 'exact', head: true })
        .eq('session', session)
        .eq('legislation_type', 'bill')
      return { session, count, error }
    })
  )

  const bySession = {}
  let total = 0
  let ok = true
  for (const r of results) {
    if (r.error || r.count == null) { ok = false; continue }
    bySession[r.session] = r.count
    total += r.count
  }

  // Oldest-first list of sessions that returned data — matches the
  // "2021-22, 2023-24, 2025-26" prose ordering used in the methodology page.
  const biennia = Object.keys(bySession).sort()

  return { total, bySession, biennia, computedAt: new Date(), ok }
}

/**
 * Format a biennium string like '2021-2022' as '2021-22' for prose.
 */
export function shortBiennium(session) {
  if (typeof session !== 'string') return ''
  const parts = session.split('-')
  if (parts.length !== 2) return session
  return `${parts[0]}-${parts[1].slice(2)}`
}

/**
 * Join a biennium list as "2021-22, 2023-24, and 2025-26" (Oxford comma).
 */
export function joinBiennia(sessions) {
  if (!sessions || !sessions.length) return ''
  const shorts = sessions.map(shortBiennium)
  if (shorts.length === 1) return shorts[0]
  if (shorts.length === 2) return `${shorts[0]} and ${shorts[1]}`
  return `${shorts.slice(0, -1).join(', ')}, and ${shorts[shorts.length - 1]}`
}

/**
 * Format a Date as "3:42 PM on April 22, 2026" for the
 * "Recalculated: ..." stamp on the methodology page.
 */
export function formatRecalculatedStamp(date) {
  if (!(date instanceof Date) || isNaN(date.getTime())) return ''
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const day = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  return `${time} on ${day}`
}
