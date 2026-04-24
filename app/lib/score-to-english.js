/**
 * score-to-english — Phase 12 Batch 5
 *
 * Single source of truth for plain-English trajectory phrasing on public
 * (anon-safe) surfaces. Two exports:
 *
 *   scoreToEnglish({ score, stage, confidenceLabel })
 *     → { headline, qualifier }
 *
 *   deltaToEnglish(delta)
 *     → string (7-day momentum copy; replaces BillsMovingWidget's
 *       temporary deltaPhrase)
 *
 * Voice per Shorepine GR v4.6 §14: actionable signal, plain English,
 * no "we predict X%", no probability language. Copy catalog frozen in
 * PHASE_12_PUBLIC_LAYER_PLAN §5A.
 *
 * Consumers should render `{headline} — {qualifier}` as one line. Tone
 * color is left to the caller so this helper stays side-effect-free and
 * framework-agnostic.
 */

// ─── Main helper ───────────────────────────────────────────────────
/**
 * Translate a score/stage/confidence triple into plain English.
 *
 * Precedence (first match wins):
 *   1. Final outcomes (LAW / CARRY OVER / DEAD) — confidence_label rules
 *   2. Unscored — no score yet
 *   3. In-session score bands
 *
 * @param {object} args
 * @param {number|null} args.score            - final_score, 0-100
 * @param {number|null} args.stage            - stage, 1-6
 * @param {string|null} args.confidenceLabel  - 'LAW' | 'PASSED_CHAMBER' | 'DEAD' | HIGH/MODERATE/LOW/VERY LOW
 * @returns {{ headline: string, qualifier: string }}
 */
export function scoreToEnglish({ score, stage, confidenceLabel } = {}) {
  const cl = (confidenceLabel || '').toUpperCase()
  const s = typeof score === 'number' ? score : null

  // ─── 1. Final outcomes ───────────────────────────────────────────
  if (cl === 'LAW' || stage === 6) {
    return {
      headline: 'Signed into law',
      qualifier: 'Final — enacted this session',
    }
  }

  if (cl === 'DEAD') {
    return {
      headline: 'Dead — no path forward',
      qualifier: 'No activity before cutoff',
    }
  }

  if (cl === 'PASSED_CHAMBER') {
    return {
      headline: 'Carried over',
      qualifier: 'Picks back up next session',
    }
  }

  // ─── 2. Unscored ─────────────────────────────────────────────────
  if (s === null) {
    return {
      headline: 'Unscored — too early in session',
      qualifier: 'Check back after bills move',
    }
  }

  // ─── 3. In-session score bands ───────────────────────────────────
  if (s >= 75) {
    return {
      headline: 'Likely to pass',
      qualifier: 'Moving on schedule',
    }
  }

  if (s >= 60) {
    return {
      headline: 'In play',
      qualifier: 'Path exists but not certain',
    }
  }

  if (s >= 45) {
    return {
      headline: 'In play',
      qualifier: 'Early momentum, needs committee support',
    }
  }

  if (s >= 30) {
    return {
      headline: 'Long shot',
      qualifier: 'Limited activity',
    }
  }

  return {
    headline: 'Stalled',
    qualifier: 'No committee movement',
  }
}

// ─── Momentum helper ───────────────────────────────────────────────
/**
 * Plain-English phrase for a 7-day score delta. Thresholds match the
 * BillsMovingWidget convention:
 *
 *   delta ≥ +8  → Surging this week
 *   delta ≥ +3  → Gaining momentum
 *   delta ≤ -8  → Losing ground
 *   delta ≤ -3  → Slipping this week
 *   otherwise   → Holding steady
 *
 * @param {number} delta
 * @returns {string}
 */
export function deltaToEnglish(delta) {
  if (delta >= 8) return 'Surging this week'
  if (delta >= 3) return 'Gaining momentum'
  if (delta <= -8) return 'Losing ground'
  if (delta <= -3) return 'Slipping this week'
  return 'Holding steady'
}
