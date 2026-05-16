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
    version: '2.1',
    date: '2026-05-15',
    phase: 'alpha',
    highlights: [
      'Watchlist header now shows three KPI cards — Tracked, High Score, and At Risk — in the same card format used on the home dashboard, so your portfolio summary is immediately readable without scanning the bill list (Thread 96).',
      'During the interim period the KPI cards shift to Tracked, Passed, and Dead — the same biennium-aware pattern the home page uses (Thread 96).',
    ],
  },
  {
    version: '2.0',
    date: '2026-05-15',
    phase: 'alpha',
    highlights: [
      'Home dashboard now has two clearly labeled zones — "YOUR WATCHLIST" for your personal tracked bills and "SESSION INTELLIGENCE · 2025-26" for legislature-wide data — so the difference between your portfolio and the whole session is immediately obvious (Thread 95).',
      'A thin rule divides the personal zone from the global zone, giving the home page a cleaner reading hierarchy without changing any of the underlying data (Thread 95).',
    ],
  },
  {
    version: '1.9',
    date: '2026-05-15',
    phase: 'alpha',
    highlights: [
      'Bill detail score formula now shows the result (e.g. "86") at 32px in brass — visually dominant over the formula prefix — so the conclusion is immediately readable without scanning the calculation (Thread 91).',
      'Momentum multiplier on the formula line (e.g. "1.29") now shows a tappable info chip explaining it is a momentum factor — how fast the bill moved relative to its stage (Thread 91).',
    ],
  },
  {
    version: '1.8',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Bottom navigation label corrected — "Committees" now displays in full during the interim period between sessions, replacing the abbreviated "Cmtes" that appeared since launch (Thread 89).',
    ],
  },
  {
    version: '1.7',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Anonymous users redirected to sign-in from /watchlist now see a clear explanation — "Sign in to access your watchlist" — instead of arriving at a blank login screen with no context (Thread 88).',
    ],
  },
  {
    version: '1.6',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Home page bill count now shows the session year — "Bills (2025-26)" instead of the generic "Bills Scored," so it is clear the number is session-specific and not the full cross-biennium archive (Thread 87).',
      'Category score averages on the home page now read "avg score 59" instead of the raw "avg 59," connecting the number to the 0–99 scoring system (Thread 87).',
      'Side drawer role chip updated from "REGISTERED" to "EARLY ACCESS" for signed-in users during the closed beta period (Thread 87).',
      'Roadmap timeline complete — the "~3,400 bills tracked" milestone now shows its date (Jan 2026) instead of "live," so every item on the timeline has a consistent date chip (Thread 87).',
    ],
  },
  {
    version: '1.5',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Switching the session in the drawer now updates Members, Committees, Hearings, and Search instantly — no hard reload needed (Thread 86).',
    ],
  },
  {
    version: '1.4',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      '10 pages now show accurate browser tab titles — Search, Members, Committees, Hearings, Roadmap, Changelog, Install, Sign In, Watchlist, and Settings all display "Page — Vector | WA" instead of the bare site name (Thread 85).',
    ],
  },
  {
    version: '1.3',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Consistent loading screens — every data page now shows the brass arrow loader instead of plain "Loading..." text, bringing members, search, and other surfaces in line with the watchlist (Thread 84).',
      'Global session picker — the session / biennium selector moved from individual pages into the side drawer, so one tap switches the whole app to 2025-26 or any historical biennium at once (Thread 84).',
      'Historical data banner — an amber strip appears automatically whenever you are viewing a past biennium, with a one-tap shortcut back to the current session (Thread 84).',
      'Career View on /members — a dedicated toggle aggregates all biennia at once for legislator-level career analysis, separate from the global biennium context (Thread 84).',
    ],
  },
  {
    version: '1.2',
    date: '2026-05-12',
    phase: 'alpha',
    highlights: [
      'Search visibility — added sitemap, robots.txt, and structured data (Organization + Legislation schema) so Google can discover and index Vector | WA before the August 2027 public launch (Thread 82).',
      'All sharing links now resolve to vectorwa.com — fixed a metadata configuration bug that caused Open Graph URLs to point at an internal Vercel preview domain instead of the canonical site (Thread 82).',
      'Per-page titles now follow the "Page — Vector | WA" format for cleaner browser tabs and search result snippets (Thread 82).',
    ],
  },
  {
    version: '1.1',
    date: '2026-05-11',
    phase: 'alpha',
    highlights: [
      'Admin "Grant access" button on the waitlist page — closed-beta applicants can now be invited directly without leaving the app (Thread 78).',
      'Historical legislator accuracy — the 2021-22 session picker on /members now correctly splits the roster into House and Senate, with party affiliation restored for returning legislators (Thread 79).',
      'PDF briefs (watchlist multi-bill and Print Brief) finalized to Brand Guide v1.2 — real Vector | WA logo replaces the hand-drawn placeholder in the watchlist brief; legacy parchment-warm surface colors standardized; wrong days-until-next-session counts removed from both briefs (Thread 80).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-10',
    phase: 'alpha',
    highlights: [
      'OTP login replaces magic-link flow — fixes iOS PWA authentication where Safari\'s WKWebView cookie split was silently breaking sign-in for installed-app users (Thread 76).',
      'Closed beta waitlist form on /login — applicants acknowledge 4 beta-stage expectations before submitting; admin UI gains a Closed Beta tab with acked/un-acked sorting (Thread 73).',
      '/roadmap page launched with 8 shipped milestones and 6 upcoming features; linked from footer, side drawer, and the login page (Thread 72).',
      'Loading spinners added to the members list and home page during initial data fetch — both were flashing an empty shell before data arrived (Thread 75).',
      'Footer freshness label color and font style corrected to match the Brand Guide v1.2 muted-text spec (Thread 77).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-07',
    phase: 'alpha',
    highlights: [
      'Members and committees page counts now accurate for all session years — server-side SQL views replace client-side reduce loops that were silently truncating at 1,000 rows; 2025-26 shows 147 legislators and all 65 committees (Threads 69–70).',
      'Methodology calibration corrected to 84% accuracy across 2,134 bills — the previous page displayed a contradictory 78.4% / 189-bill figure; denominator, tier color coding, and statistical disclosure language all updated (Thread 67).',
      '/how-it-works renamed to /install with a 308 permanent redirect from the old path; hero CTA repointed to /about as the acquisition surface (Thread 71).',
      'Post-close trajectory copy for bills that passed chamber but did not become law now reads correctly during the interim period instead of repeating active-session language (Thread 41 follow-up).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-03',
    phase: 'alpha',
    highlights: [
      'Platform-aware PWA install prompt on /install — Android and desktop Chrome get a native install button, iOS users get share-sheet instructions, and already-installed state shows a confirmation pill (Thread 61).',
      'Login page gains Methodology and About links below the sign-in card so anonymous visitors can explore the platform before committing to sign up (Thread 65).',
      'Anonymous routes for /methodology, /about, /install, and /changelog fixed — they were incorrectly gated behind the public-layer flag and silently bouncing visitors back to /login (Thread 65 follow-up).',
    ],
  },
  {
    version: '1.0',
    date: '2026-05-02',
    phase: 'alpha',
    highlights: [
      'Last-action-date sync bug corrected — 23 archived bills were being stamped with the current sync timestamp instead of NULL when no action history was available from the API; those bills no longer float to the top of Most Recent Action sort (Thread 57).',
      'Side drawer polish — Admin link fixed (was 404ing), reference links for Disclaimers, About, and Methodology added for signed-in users, Settings gear moved to drawer footer in a dedicated bottom block (Thread 58).',
      '/changelog page launched and accessible to all visitors; version label added to the drawer header in DM Mono caption; version + phase helpers added to app/lib/version.js for future phase-gate use (Threads 59–60).',
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
