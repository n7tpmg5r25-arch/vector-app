/**
 * roadmap.js — Vector | WA public roadmap data
 *
 * Single source of truth for the /roadmap page milestone list.
 * No dates are hardcoded on the page itself — all copy + dates derive
 * from this file so future refreshes happen in one place.
 *
 * Fields per item:
 *   id          Stable key for React lists (never shown to users).
 *   title       Short milestone label. Playfair Display on the page.
 *   status      'shipped' | 'coming'
 *   date        Display string: month + year ("Apr 2026"), quarter + year
 *               ("Q3 2026"), or a plain descriptor ("live", "Late 2027 / 2028").
 *               Exception: Aug 1, 2027 is the publicly committed launch date
 *               and may carry a specific day.
 *   description 1-2 sentence summary. Quantified before qualitative.
 *               No emoji. No exclamation. No internal phase numbers.
 *   category    'infrastructure' | 'engine' | 'data' | 'public-release' |
 *               'collaboration' — reserved for future filter/grouping.
 *   source      Planning doc that anchors the date (code archaeology aid;
 *               never displayed to users).
 *
 * Thread 72 — initial seed (2026-05-09).
 */

export const ROADMAP = [

  // ─── SHIPPED ────────────────────────────────────────────────────────
  {
    id: 'framework',
    title: 'Framework + app structure',
    status: 'shipped',
    date: 'Q1 2026',
    description:
      'Next.js on Vercel, Supabase PostgreSQL + Auth, and GitHub Actions CI. ' +
      'The structural foundation that all data and UI layers build on.',
    category: 'infrastructure',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
  {
    id: 'brand-guide',
    title: 'Brand Guide v1.2',
    status: 'shipped',
    date: 'Apr 2026',
    description:
      'Design system codifying the Vector | WA palette, three-voice typography ' +
      '(Playfair Display / Karla / DM Mono), and public-to-team tier distinctions.',
    category: 'infrastructure',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
  {
    id: 'trajectory-engine',
    title: 'Trajectory engine',
    status: 'shipped',
    date: 'Apr 2026',
    description:
      'Calibrated scoring model trained on 8,062 bills across three biennia. ' +
      'Locked for the full 2027 session — no mid-session adjustments.',
    category: 'engine',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
  {
    id: 'watchlist',
    title: 'Watchlist + tags + alerts',
    status: 'shipped',
    date: 'Q1 2026',
    description:
      'Personal bill queue with custom tags and email alert subscriptions. ' +
      'The registered-user core.',
    category: 'infrastructure',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
  {
    id: 'data-pipeline',
    title: 'Daily data pipeline',
    status: 'shipped',
    date: 'Q1 2026',
    description:
      'Nightly GitHub Actions sync pulling bill status, roll-call votes, and ' +
      'committee assignments from the WA Legislature WSL API.',
    category: 'data',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
  {
    id: 'email-notifications',
    title: 'Email notifications + weekly digest',
    status: 'shipped',
    date: 'Apr 2026',
    description:
      'Watchlist alert emails and a weekly digest summarizing movement on ' +
      'tracked bills, delivered via Resend.',
    category: 'infrastructure',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
  {
    id: 'pdf-brief',
    title: 'PDF Brief (single + multi-bill)',
    status: 'shipped',
    date: 'Apr 2026',
    description:
      'Briefing documents for registered and team users. Legislative context ' +
      'in a shareable, printable format — one bill or an entire watchlist.',
    category: 'infrastructure',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
  {
    id: 'bill-coverage',
    title: '~3,400 bills tracked across 3 biennia',
    status: 'shipped',
    date: 'Jan 2026',
    description:
      'All bills from the 2021-22, 2023-24, and 2025-26 Washington State ' +
      'legislative sessions — searchable and scored.',
    category: 'data',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },

  // ─── COMING ─────────────────────────────────────────────────────────
  {
    id: 'session-autoswap',
    title: 'Interim → session auto-swap verification',
    status: 'coming',
    date: 'Dec 2026 – Jan 2027',
    description:
      'Validation pass confirming the biennium-aware session switch fires ' +
      'correctly when the 2027 long session opens on January 13.',
    category: 'infrastructure',
    source: 'SESSION_CUTOVER_2027.md',
  },
  {
    id: 'calibration-lock',
    title: 'Calibration locked for full 2027 session',
    status: 'coming',
    date: 'by Jan 11, 2027',
    description:
      'Trajectory scoring cohort frozen before the first floor votes of the ' +
      '2027 session. The model runs the full session without mid-session tuning.',
    category: 'engine',
    source: 'SESSION_CUTOVER_2027.md',
  },
  {
    id: 'session-2027',
    title: '2027 long session (soft launch with current access list)',
    status: 'coming',
    date: 'Jan 11 – Apr 25, 2027',
    description:
      'Live tracking through the full 2027 session. The scoring model runs ' +
      'against a new cohort for the first time since the 2023-24 calibration.',
    category: 'data',
    source: 'SESSION_CUTOVER_2027.md',
  },
  {
    id: 'calibration-revalidation',
    title: 'Calibration revalidated against 2027 cohort',
    status: 'coming',
    date: 'Q2 2027',
    description:
      'Post-session accuracy review. The 2027 cohort provides an out-of-sample ' +
      'validation of the trajectory model before the public launch.',
    category: 'engine',
    source: 'SESSION_CUTOVER_2027.md',
  },
  {
    id: 'public-launch',
    title: 'Public app launch — anonymous browse, free for everyone',
    status: 'coming',
    date: 'Aug 1, 2027',
    description:
      'Anonymous browse opens to everyone. No account required. All bill data, ' +
      'search, and trajectory scores become free and public.',
    category: 'public-release',
    source: 'PUBLIC_RELEASE_DECISION_MEMO.md',
  },
  {
    id: 'collaborative-teams',
    title: 'Collaborative teams (multi-user notes + shared briefs)',
    status: 'coming',
    date: 'Late 2027 / 2028',
    description:
      'Groups tracking the same bill portfolio can annotate and collaborate ' +
      'in a shared workspace with multi-user notes and team briefing documents.',
    category: 'collaboration',
    source: 'PHASE_6_PLAN.md Thread 72 seed',
  },
]

// Convenience slices used by the page.
export const SHIPPED = ROADMAP.filter(m => m.status === 'shipped')
export const COMING  = ROADMAP.filter(m => m.status === 'coming')
