// Vector | WA — Data Lifecycle & Retention policy (Thread DATA-LIFECYCLE, 2026-06-14)
//
// Single source of truth for HOW LONG we keep each data class and WHEN a biennium
// may be down-fidelity'd or archived. Pairs with session-config.js (which owns the
// session DATES); this module owns the RETENTION rules. Full plan:
// DATA_LIFECYCLE_PLAN.md (Vector - WA project folder).
//
// WHY: on Supabase free tier the cap is 500 MB of Postgres data (read-only beyond).
// trajectory_snapshots was recording frozen scores daily and would have hit the cap
// ~Oct 2026. Retention is now enforced as a pg_cron job; this module documents +
// parametrizes the timeline so the app, the (future) recalibration, and the (future)
// archive routine all agree.
//
// NOTE: the snapshot retention itself runs IN POSTGRES as pg_cron job
// 'snapshot-retention-prune' (nightly 09:30 UTC) — lossless change-point collapse,
// 7-day grace. This module is the policy/markers layer; it does not delete anything.

// Ordered oldest -> newest. capturedLive=false means the session ended before Vector
// captured it in real time (daily snapshots began 2026-04, after the 2025-2026 sine
// die), so there is no irreplaceable intra-session trajectory to protect. 2027-2028
// is the FIRST live-captured session — the calibration cornerstone — and must NOT be
// lossy-downsampled or archived until the post-session full recalibration consumes it.
export const BIENNIA = [
  { session: '2021-2022', capturedLive: false },
  { session: '2023-2024', capturedLive: false },
  { session: '2025-2026', capturedLive: false },
  { session: '2027-2028', capturedLive: true  }, // cornerstone — protect until recalibrated
];

// How many most-recent biennia must stay RE-FITTABLE (full enough for recalibrate.js
// to re-derive weights). Calibration currently fits on 3 biennia.
export const KEEP_REFITTABLE_BIENNIA = 3;

// Snapshot retention (enforced by the pg_cron job; mirrored here for reference).
export const SNAPSHOT_RETENTION = {
  mode: 'lossless-change-point', // keep first + last + every change-point per bill
  graceDays: 7,                  // never touch the last 7 days
  cronJob: 'snapshot-retention-prune',
  cronSchedule: '30 9 * * *',
};

export const TIERS = { HOT: 'hot', WARM: 'warm', COLD: 'cold' };

// The cornerstone session — first captured live; the post-2027 FULL recalibration
// must run on it before it is ever down-fidelity'd or archived.
export const CORNERSTONE_SESSION = '2027-2028';

// Integrity gate every collapse/archive MUST pass, IN ORDER. Documented here so it is
// never skipped (enforced by the future archive routine):
//   1. recalibrate.js  -> fresh is_current calibration_weights incl. the closing biennium
//   2. materialize calibration_buckets (so the public accuracy stat survives the trim)
//   3. re-score current session -> assert every final_score is byte-identical before vs
//      after the trim (scoreBill reads only the weights, so a correct archive moves ZERO
//      scores — if any moves, ABORT)
//   4. pg_dump the raw rows to durable storage (archived === retrievable)
//   5. only then DELETE
export const ARCHIVE_GATE = ['recalibrate', 'materialize_buckets', 'verify_scores_identical', 'dump_raw', 'trim'];

// Fidelity tier for a session given the current session string:
//   current + most-recent -> hot; within KEEP_REFITTABLE_BIENNIA -> warm; else cold.
export function tierFor(session, currentSession) {
  const idx = BIENNIA.findIndex((b) => b.session === session);
  const curIdx = BIENNIA.findIndex((b) => b.session === currentSession);
  if (idx < 0 || curIdx < 0) return TIERS.WARM;
  const age = curIdx - idx; // 0 = current, 1 = previous, ...
  if (age <= 1) return TIERS.HOT;
  if (age < KEEP_REFITTABLE_BIENNIA) return TIERS.WARM;
  return TIERS.COLD;
}

// A session may be LOSSY-downsampled / archived only if it is NOT the live cornerstone
// awaiting its first full recalibration. (Lossless change-point collapse is always
// allowed — it removes only redundant rows.)
export function isLossyArchiveAllowed(session, opts) {
  const o = opts || {};
  if (session === CORNERSTONE_SESSION && !o.cornerstoneRecalibrated) return false;
  return true;
}
