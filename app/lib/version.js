/**
 * Version + release-phase helpers for Vector | WA.
 *
 * Filed Phase 6 Thread 59 (2026-05-02) as the foundation for the
 * /changelog system that arrives in Thread 60. This file owns the
 * single user-facing version string and the date-aware phase lookup
 * (alpha → beta → release). The drawer header pill consumes
 * getVersionLabel(); future surfaces (changelog page, future about
 * blocks) should consume the same helpers so the version stays
 * coherent across the app.
 *
 * Version is intentionally decoupled from package.json. package.json
 * is deploy-time metadata; VERSION here is what the user sees and is
 * bumped manually on phase ships rather than on every deploy.
 */

// User-facing semver-ish display version. Bump on phase ships.
// 1.0 = post-Phase-5 baseline.
export const VERSION = '5.76.1'

// Release-phase calendar. Each entry has an optional start and end
// date (ISO yyyy-mm-dd). The first entry that contains "now" wins.
// Cutoffs locked per Phase 6 plan:
//   alpha   → up to 2026-12-01 (pre-filing for 2027-2028 opens)
//   beta    → 2026-12-01 → 2027-07-01 (mid-2027 public launch window)
//   release → 2027-07-01 onward
const RELEASE_PHASES = [
  { phase: 'alpha',   end:   '2026-12-01' },
  { phase: 'beta',    start: '2026-12-01', end: '2027-07-01' },
  { phase: 'release', start: '2027-07-01' },
]

/**
 * Returns the active release phase string for "now" — one of
 * 'alpha' | 'beta' | 'release'. Defaults to 'alpha' if no entry
 * matches (defensive — should not happen given the cutoffs above).
 */
export function getCurrentPhase() {
  const now = new Date()
  for (const p of RELEASE_PHASES) {
    if (p.start && now < new Date(p.start)) continue
    if (p.end && now >= new Date(p.end)) continue
    return p.phase
  }
  return 'alpha'
}

/**
 * Returns the user-facing label combining phase + version, e.g.
 *   'alpha 1.0' (alpha + beta)
 *   '1.0'       (release — phase suppressed; "1.0" stands alone)
 */
export function getVersionLabel() {
  const phase = getCurrentPhase()
  return phase === 'release' ? VERSION : `${phase} ${VERSION}`
}
