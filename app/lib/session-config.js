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
    start:   '2027-01-11',   // 2nd Monday of Jan 2027 per WA Const. Art II §12
    end:     '2028-03-10',   // Estimated — 2028 short session sine die, Day 60 from Jan 10
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

/** Key session cutoff milestones for the current biennium.
 *  Returns an array of `{ label, date, dateFormatted, passed, daysLeft }`
 *  — callers typically do `.filter(c => !c.passed)` to get upcoming ones.
 *  Returns `[]` when we don't have cutoff data for the current biennium
 *  (e.g., a future biennium whose calendar hasn't been filed yet).
 *
 *  Reshaped 2026-04-22 (DATA_FRESHNESS #33). Previously returned a plain
 *  object `{ policyCutoff, fiscalCutoff, ... }` that never matched the
 *  array-shape three call sites in generate-pdf.js were using. Only
 *  consumers of this function were in generate-pdf.js; the object-shape
 *  had no real readers. */
export function getSessionCutoffs() {
  const b = getCurrentBiennium()
  const now = new Date()

  // WA Legislature cutoff milestones. Dates come from
  // https://leg.wa.gov/legislature/pages/cutoffs.aspx — update when
  // the next biennium's calendar is published (typically fall before).
  let raw = []
  if (b.session === '2025-2026') {
    raw = [
      { label: 'Policy Cutoff',         date: '2026-02-06' },
      { label: 'Fiscal Cutoff',         date: '2026-02-17' },
      { label: 'Floor Cutoff',          date: '2026-03-02' },
      { label: 'Opposite Floor Cutoff', date: '2026-03-10' },
    ]
  } else if (b.session === '2027-2028') {
    // 2027 = long session (105 days) starting Jan 13 2027.
    // DATES BELOW ARE ESTIMATES based on the cadence of the 2021 and
    // 2023 long sessions (policy ~Day 36, fiscal ~Day 43, floor ~Day
    // 56, opposite floor ~Day 76). REPLACE with official dates when
    // WA Leg publishes the 2027 calendar (typically fall 2026).
    raw = [
      { label: 'Policy Cutoff',         date: '2027-02-19' }, // ESTIMATE
      { label: 'Fiscal Cutoff',         date: '2027-02-26' }, // ESTIMATE
      { label: 'Floor Cutoff',          date: '2027-03-10' }, // ESTIMATE
      { label: 'Opposite Floor Cutoff', date: '2027-03-31' }, // ESTIMATE
    ]
  }
  // Unknown biennium → empty array. .filter() on [] is safe.

  return raw.map(m => ({
    ...m,
    dateFormatted: formatSessionDate(m.date),
    passed: new Date(m.date) < now,
    daysLeft: daysUntil(m.date),
  }))
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

/** Short biennium label for display: '2025-2026' → '2025-26'.
 *  Lifted from app/app/committees/page.js per Universal Guardrail G1
 *  (Thread 11) so any new file can import it without copy-paste. Pairs
 *  with getCurrentBiennium() / getNextBiennium() to keep interim-mode
 *  copy auto-rolling without a per-cycle code edit. */
export function bienniumShortLabel(session) {
  if (!session || typeof session !== 'string') return ''
  const parts = session.split('-')
  if (parts.length !== 2) return session
  return `${parts[0]}-${parts[1].slice(-2)}`
}

/** Day-of-session counter (1-indexed) for the current biennium, or null
 *  when not in active session. Lifted from committees/page.js per G1
 *  (Thread 11) so member + bill detail pages can use it without dup. */
export function dayOfSessionOrNull() {
  const b = getCurrentBiennium()
  if (!b) return null
  const now = new Date()
  const start = new Date(b.start)
  const end = new Date(b.end)
  if (now < start || now > end) return null
  return Math.floor((now - start) / 86400000) + 1
}

// ── Convenience constants (for the current cycle) ─────────
export const SESSION_CONFIG = {
  get current()       { return getCurrentSession() },
  get isInterim()     { return isInterimPeriod() },
  get nextBiennium()  { return getNextBiennium() },
  get currentBiennium() { return getCurrentBiennium() },
}
