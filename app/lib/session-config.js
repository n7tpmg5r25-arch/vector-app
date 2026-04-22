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

// Historical biennia with bill data in the warehouse (pre-BIENNIUMS
// sessions — kept in a separate array because they're read-only and
// don't need cutoff tables / prefile dates). Update when a session
// ages out of BIENNIUMS into history.
const HISTORICAL_SESSIONS = ['2023-2024', '2021-2022']

// ── Derived helpers ───────────────────────────────────────

/** Current biennium session string, e.g. '2025-2026' or '2027-2028'
 *  Switches to the next biennium when pre-filing opens (typically Dec 1),
 *  NOT when the session starts (Jan 13). Pre-filing is when lobbyists
 *  begin scanning new bills — the app should default to the new session
 *  as soon as there's something to see. */
export function getCurrentSession() {
  const now = new Date()
  // Walk backwards; first biennium whose pre-filing date (or start) <= today wins
  for (let i = BIENNIUMS.length - 1; i >= 0; i--) {
    const trigger = BIENNIUMS[i].prefilingOpens || BIENNIUMS[i].start
    if (now >= new Date(trigger)) return BIENNIUMS[i].session
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

/** All sessions with bill data (current + historical), newest first.
 *  Future biennia are filtered out until prefiling has opened, so
 *  session pickers don't advertise an empty session before Dec 1
 *  of the rollover year. Single source of truth — replaces the
 *  `const SESSIONS = ['2025-2026', '2023-2024', '2021-2022']`
 *  arrays that used to live in page files. */
export function getAllSessions() {
  const now = new Date()
  const visibleBienniums = BIENNIUMS
    .filter(b => now >= new Date(b.prefilingOpens || b.start))
    .map(b => b.session)
    .reverse() // newest first
  return [...visibleBienniums, ...HISTORICAL_SESSIONS]
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
  if (b.session === '2027-2028') {
    // 2027 = long session, 105 days starting Jan 13 2027.
    // DATES BELOW ARE ESTIMATES based on the cadence of the 2021 and 2023
    // long sessions (policy ~Day 36, fiscal ~Day 43, floor ~Day 56,
    // opposite floor ~Day 76, sine die ~Day 103-105).
    // REPLACE with the official calendar when WA Leg publishes it at
    // https://leg.wa.gov/legislature/pages/cutoffs.aspx (typically fall 2026).
    return {
      session: b.session,
      sessionStart: b.start,
      sessionEnd: b.end,
      policyCutoff: '2027-02-19',        // ESTIMATE — policy committee cutoff
      fiscalCutoff: '2027-02-26',         // ESTIMATE — fiscal committee cutoff
      floorCutoff: '2027-03-10',          // ESTIMATE — house-of-origin floor cutoff
      oppositeFloorCutoff: '2027-03-31',  // ESTIMATE — opposite-house floor cutoff
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

/** Format a date string as "January 13, 2027" (timezone-safe).
 *  Returns "session dates TBD" when dateStr is null/undefined/malformed —
 *  prevents crashes on interim pages when a future biennium hasn't yet
 *  been populated in BIENNIUMS. */
export function formatSessionDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return 'session dates TBD'
  const parts = dateStr.split('-').map(Number)
  if (parts.length !== 3 || parts.some(isNaN)) return 'session dates TBD'
  const [y, m, d] = parts
  // Parse as local date to avoid UTC offset shifting the day
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
