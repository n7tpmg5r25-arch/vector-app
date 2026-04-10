/**
 * Shared session calendar for Vector | WA
 * Central source of truth for all session dates and interim logic.
 * Update this file when a new biennium begins.
 */

// ── Biennium definitions ──────────────────────────────────
// Each entry: { session, start, end, prefilingOpens }
const BIENNIUMS = [
  {
    session: '2025-2026',
    start:   '2025-01-13',
    end:     '2026-03-12',   // Sine die March 12 2026
    prefilingOpens: null,    // Already passed
  },
  {
    session: '2027-2028',
    start:   '2027-01-13',
    end:     '2028-03-10',   // Estimated
    prefilingOpens: '2026-12-01',
  },
]

// ── Derived helpers ───────────────────────────────────────

/** Current biennium session string, e.g. '2025-2026' or '2027-2028' */
export function getCurrentSession() {
  const now = new Date()
  // Walk backwards; first biennium whose start <= today wins
  for (let i = BIENNIUMS.length - 1; i >= 0; i--) {
    if (now >= new Date(BIENNIUMS[i].start)) return BIENNIUMS[i].session
  }
  return BIENNIUMS[0].session
}

/** Next biennium entry (the one after the current session) */
export function getNextBiennium() {
  const cur = getCurrentSession()
  const idx = BIENNIUMS.findIndex(b => b.session === cur)
  return BIENNIUMS[idx + 1] || BIENNIUMS[idx]
}

/** Current biennium entry */
export function getCurrentBiennium() {
  const cur = getCurrentSession()
  return BIENNIUMS.find(b => b.session === cur) || BIENNIUMS[0]
}

/** True when the legislature is NOT in active session */
export function isInterimPeriod() {
  const now = new Date()
  const biennium = getCurrentBiennium()
  // Interim = after current session end AND before next session start
  return now > new Date(biennium.end)
}

/** Key session cutoff dates for the current biennium */
export function getSessionCutoffs() {
  const b = getCurrentBiennium()
  // Standard WA Legislature cutoff milestones (approximate)
  // These are based on typical session calendars; update when official dates are published
  if (b.session === '2025-2026') {
    return {
      session: b.session,
      sessionStart: b.start,
      sessionEnd: b.end,
      policyCutoff: '2026-02-06',      // Policy committee cutoff
      fiscalCutoff: '2026-02-17',       // Fiscal committee cutoff
      floorCutoff: '2026-03-02',        // House of origin floor cutoff
      oppositeFloorCutoff: '2026-03-10', // Opposite house floor cutoff
    }
  }
  // Default: derive from biennium dates
  return {
    session: b.session,
    sessionStart: b.start,
    sessionEnd: b.end,
    policyCutoff: null,
    fiscalCutoff: null,
    floorCutoff: null,
    oppositeFloorCutoff: null,
  }
}

/** Days until a date string; 0 if passed */
export function daysUntil(dateStr) {
  const diff = new Date(dateStr) - new Date()
  return Math.max(0, Math.ceil(diff / 86400000))
}

/** Format a date string as "January 13, 2027" (timezone-safe) */
export function formatSessionDate(dateStr) {
  // Parse as local date to avoid UTC offset shifting the day
  const [y, m, d] = dateStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  })
}

// ── Convenience constants (for the current cycle) ─────────
export const SESSION_CONFIG = {
  get current()       { return getCurrentSession() },
  get isInterim()     { return isInterimPeriod() },
  get nextBiennium()  { return getNextBiennium() },
  get currentBiennium() { return getCurrentBiennium() },
}
