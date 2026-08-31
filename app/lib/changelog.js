/**
 * Changelog data — Vector | WA.
 *
 * Filed Phase 6 Thread 60 (2026-05-02). Newest-first array consumed by
 * /changelog/page.js. Each entry shape:
 *
 *   {
 *     version:    string      // matches lib/version.js VERSION at month end
 *     date:       string      // ISO yyyy-mm-dd — last ship date that month
 *     phase:      string      // 'alpha' | 'beta' | 'release' (free-form, lowercase)
 *     highlights: string[]    // 3-5 bullets in Karla body voice
 *   }
 *
 * Conventions:
 *   - One entry per calendar month (consolidated 2026-08-31, replacing 137
 *     per-ship entries — the full granular history remains in git). Add to
 *     the current month's bullets as work ships; open a new entry when the
 *     month rolls over, versioned at that month's final VERSION.
 *   - Highlights are written in plain Karla body voice — a short soundbite
 *     per change, not a release note. This is a user-facing transparency
 *     surface, not a git log.
 *   - No internal thread numbers, phase codes, or audience jargon in copy.
 *   - Quantified before qualitative per Brand Guide v1.2 §05 voice rules.
 *   - No banned vocab (see BRAND_COMPLIANCE_AUDIT_2026-05-01.md Check 1).
 */

export const CHANGELOG = [
  {
    version: '5.78.0',
    date: '2026-08-31',
    phase: 'alpha',
    highlights: [
      'Legislator PDF briefs print the official photo again — the export had been requesting it from an address that no longer existed, so every brief fell back to a plain initials tile.',
      'The landing page is rewritten in plain language: feature names as headings, one or two sentences each, and a single call to action.',
      'Landing page figures now match the database — 3,400+ bills this session, 147 legislator profiles, 113 committees.',
      'The roadmap no longer names a public launch date. Every date on the page is quarter-grain.',
    ],
  },
  {
    version: '5.77.0',
    date: '2026-07-10',
    phase: 'alpha',
    highlights: [
      'Bill and committee pages load about a second faster, and the welcome page is 1.3 MB lighter after converting its screenshots to WebP.',
      'Accessibility pass: real heading structure across 16 screens, AA text contrast, a visible keyboard focus ring, and working pinch-zoom on Android.',
      'Security: the web framework and supporting libraries updated to patched versions, plus standard protective response headers.',
      'Every bill and committee page now carries its own title, description, and canonical address, so shared links preview correctly.',
      'Failed data loads show a retry card instead of an endless loading screen, and news sources were repaired after a live feed audit.',
    ],
  },
  {
    version: '5.57.0',
    date: '2026-06-30',
    phase: 'alpha',
    highlights: [
      'Vector | WA is now open source under an MIT license, with a public welcome page and a methodology written in plain English.',
      'Radar is complete: a term can match the full text of a bill, and alerts fire when a watched bill is amended or substituted, quoting the new language.',
      'Bill data, Radar matches, and alert emails refresh several times a day, year-round, with an automated check that flags a stalled feed within a day.',
      'Watchlists work without an account — bills save on the device and move into the account at first sign-in, keeping their tags and notes.',
      'All three PDF exports print neutral black and white with plain file names, and a statewide news feed now reads 14 Washington newsrooms.',
    ],
  },
  {
    version: '5.11.0',
    date: '2026-05-31',
    phase: 'alpha',
    highlights: [
      'Radar launched: save a term and get an email the day a new bill matches it, from the search page or its own screen.',
      'The three PDF briefs — bill, legislator, and watchlist — were rebuilt as one-page documents with a consistent layout.',
      'The search page was rewritten with working filters, live category counts, and a watch toggle on every result.',
      'Bill and member pages reorganized to lead with decision-relevant information, and the score breakdown now shows its own math.',
      'The members list loads about three times faster, the app caches itself for repeat visits, and animations respect reduce-motion settings.',
    ],
  },
]
