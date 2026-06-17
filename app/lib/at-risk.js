/**
 * Vector | WA — at-risk model (DASH-3).
 *
 * The "intelligence logic" behind the home Needs-Attention card. Pure
 * functions over a bill row — no scoring-engine calls, no queries, no React. A bill is
 * "at risk" when it is still alive but losing its path to passage, combining
 * three lobbyist signals rather than a naive low score:
 *
 *   - cutoff pressure   a statutory cutoff is within a week and the bill has
 *                       not cleared its committee (days_to_cutoff + committee_passed);
 *   - held / stalled    parked in the Rules Committee (held_in_rules), or
 *                       flagged stalled / no action in 3+ weeks (stalled,
 *                       days_since_action);
 *   - stuck low traj.   a Very-Low-tier score that also has not cleared
 *                       committee (final_score + committee_passed) — never
 *                       score alone.
 *
 * Terminal bills (LAW / DEAD / VETOED, or signed at stage >= 6) and visibly
 * advancing bills (pulled OUT of Rules onto the floor calendar, or already
 * PASSED_CHAMBER) are never at risk. pulled_from_rules is a POSITIVE signal —
 * it means the bill was pulled out of Rules, not held in it.
 *
 * Schema confirmed live (project skuedssejrbrxycgdcfw, 2026-06-07): bills
 * carries stalled, held_in_rules, pulled_from_rules, days_to_cutoff,
 * days_since_action, committee_passed, confidence_label, stage, final_score.
 * During the interim every bill is terminal, so isAtRisk() returns false for
 * the whole warehouse — the card is interim-gated upstream regardless.
 *
 * Tier cut 45 matches ScoreBadge / DistributionBar (75 / 60 / 45), inlined to
 * avoid pulling the PDF module into the client bundle.
 */

const CUTOFF_PRESSURE_DAYS = 7   // a statutory cutoff within a week
const STALE_DAYS = 21            // no recorded action in 3+ weeks
const LOW_TRAJ = 45              // below the Very-Low tier cut

const TERMINAL_LABELS = new Set(['LAW', 'DEAD', 'VETOED'])

/** Resolved — already passed into law, dead, or vetoed. Never at risk. */
export function isTerminal(bill) {
  if (!bill) return true
  const label = String(bill.confidence_label || '').toUpperCase()
  if (TERMINAL_LABELS.has(label)) return true
  if (typeof bill.stage === 'number' && bill.stage >= 6) return true // signed into law
  return false
}

/** Visibly advancing — pulled onto the floor calendar or already passed a
 *  chamber. pulled_from_rules = pulled OUT of Rules (good), not held in it. */
function isAdvancing(bill) {
  if (bill.pulled_from_rules === true) return true
  if (String(bill.confidence_label || '').toUpperCase() === 'PASSED_CHAMBER') return true
  return false
}

/** A cutoff is bearing down and the bill has not cleared its committee. */
function hasCutoffPressure(bill) {
  const d = bill.days_to_cutoff
  return d != null && d >= 0 && d <= CUTOFF_PRESSURE_DAYS && bill.committee_passed !== true
}

/** No recorded action in STALE_DAYS+ — a soft stall even if the flag is unset. */
function isStale(bill) {
  return bill.days_since_action != null && bill.days_since_action >= STALE_DAYS
}

/** Very-Low score that also has not cleared committee — stuck, not just low. */
function isStuckLow(bill) {
  return bill.final_score != null && bill.final_score < LOW_TRAJ && bill.committee_passed !== true
}

/** Is this bill at risk of dying before passage? Combines the signals above. */
export function isAtRisk(bill) {
  if (!bill) return false
  if (isTerminal(bill)) return false
  if (isAdvancing(bill)) return false
  return (
    hasCutoffPressure(bill) ||
    bill.held_in_rules === true ||
    bill.stalled === true ||
    isStale(bill) ||
    isStuckLow(bill)
  )
}

/** Short reason + urgency for an at-risk bill. urgent === true only when a
 *  statutory cutoff is bearing down (the time-critical case). Returns null when
 *  the bill is not at risk. Shape: { label, urgent }. */
export function atRiskReason(bill) {
  if (!isAtRisk(bill)) return null
  const urgent = hasCutoffPressure(bill)
  let label
  if (bill.held_in_rules === true) label = 'held in Rules'
  else if (bill.stalled === true || isStale(bill)) label = 'stalled'
  else if (urgent) label = 'facing cutoff'
  else label = 'low trajectory'
  return { label, urgent }
}

/** Rust "act before Fri"-style tail for the worst-bill line. Empty string when
 *  there is no time-critical cutoff (the structural label already says enough).
 *  Weekday-aware inside a week; falls back to a day count beyond it. */
export function urgencyText(bill, now = new Date()) {
  if (!bill || !hasCutoffPressure(bill)) return ''
  const d = bill.days_to_cutoff
  if (d <= 0) return 'act today'
  if (d === 1) return 'act by tomorrow'
  if (d <= CUTOFF_PRESSURE_DAYS) {
    const when = new Date(now)
    when.setDate(when.getDate() + d)
    return 'act before ' + when.toLocaleDateString('en-US', { weekday: 'short' })
  }
  return 'cutoff in ' + d + 'd'
}

/** Rank the at-risk bills worst-first and return the single most urgent one
 *  (or null). Urgent (cutoff) bills sort ahead; ties break on sooner cutoff,
 *  then lower score. Input is an array of bill rows. */
export function worstAtRisk(bills = []) {
  const atRisk = bills.filter(isAtRisk)
  if (atRisk.length === 0) return null
  const rank = (b) => {
    const urgent = hasCutoffPressure(b) ? 0 : 1
    const cutoff = b.days_to_cutoff != null && b.days_to_cutoff >= 0 ? b.days_to_cutoff : 999
    const score = b.final_score != null ? b.final_score : 999
    return [urgent, cutoff, score]
  }
  return atRisk.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b)
    return (ra[0] - rb[0]) || (ra[1] - rb[1]) || (ra[2] - rb[2])
  })[0]
}

/** Count of at-risk bills in a list — convenience for the card + stat. */
export function countAtRisk(bills = []) {
  return bills.filter(isAtRisk).length
}
