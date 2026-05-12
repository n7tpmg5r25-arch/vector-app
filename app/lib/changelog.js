/**
 * Changelog data — Vector | WA.
 *
 * Filed Phase 6 Thread 60 (2026-05-02). Newest-first array consumed by
 * /changelog/page.js. Each entry shape:
 *
 *   {
 *     version:    string      // matches lib/version.js VERSION at the time of ship
 *     date:       string      // ISO yyyy-mm-dd
 *     phase:      string      // 'alpha' | 'beta' | 'release' (free-form, lowercase)
 *     highlights: string[]    // 3-5 bullets in Karla body voice
 *   }
 *
 * Conventions:
 *   - Prepend new entries on each phase ship (not on every PR — this is a
 *     user-facing transparency surface, not a git log).
 *   - Highlights are written in plain Karla body voice. Each bullet should
 *     stand on its own; cross-references like "(Phase 5 Thread 55)" are
 *     fine for traceability but copy stays neutral.
 *   - Quantified before qualitative per Brand Guide v1.2 §05 voice rules.
 *   - No banned vocab (see BRAND_COMPLIANCE_AUDIT_2026-05-01.md Check 1).
 *
 * Future structure note:
 *   When the list grows past ~12 entries this file becomes the right place
 *   to introduce a `category` field (UI / Data / Methodology / Brand) so
 *   the page can offer light filtering. Resist adding it before then —
 *   premature schema adds maintenance churn for no reader benefit.
 */

export const CHANGELOG = [
  {
    version: '1.1',
    date: '2026-05-11',
    phase: 'alpha',
    highlights: [
      'Admin "Grant access" button on the waitlist page — closed-beta applicants can now be invited directly without leaving the app (Thread 78).',
      'Historical legislator accuracy — the 2021-22 session picker on /members now correctly splits the roster into House and Senate, with party affiliation restored for returning legislators (Thread 79).',
      'PDF briefs (watchlist multi-bill and Print Brief) finalized to Brand Guide v1.2 — remaining legacy parchment-warm surface colors replaced with the canonical off-white SURFACE token, and stale Shorepine-era comments cleaned up (Thread 80).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-01',
    phase: 'alpha',
    highlights: [
      'LinkedIn-style side drawer with viewer-aware menu — public, registered, and team viewers each get a tailored navigation surface (Phase 5 Thread 55).',
      'Brand Guide v1.2 compliance — brass palette, three-voice typography (Playfair Display / Karla / DM Mono), and the Vector | WA logo system shipped end to end (Phase 4).',
      'Calibration tables on the methodology page right-aligned for sharper data-grid presentation (Phase 5 Thread 52).',
      'Service worker cache bumped to v4 to flush stale pre-Phase-4 markup on returning visitors (Phase 5 Thread 49).',
      'Public bottom navigation for anonymous viewers — Search, Committees, Members, and a session-aware Outcomes / Hearings tab (Thread 29).',
    ],
  },
  // Future entries prepend here on each phase ship.
]
