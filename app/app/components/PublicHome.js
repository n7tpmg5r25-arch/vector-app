'use client'
/**
 * PublicHome -- Phase 12 Batch 4 + Thread 24 (2026-04-26)
 *
 * Anonymous-visitor home page. Renders only when:
 *   useViewer() returns !user && publicLayerEnabled === true
 * and the proxy gate has admitted the request.
 *
 * Thread 24 layout:
 *   - PublicNav top bar -- wordmark, How it works, About, Sign in
 *   - Hero band -- Section 10 logo lockup + Section 02 functional descriptor
 *   - "What is Vector | WA" 2-paragraph explainer
 *   - Interim-only "How did the {bienniumShortLabel} session end?" tile
 *     (gated on isInterimPeriod())
 *   - "By the numbers" datasheet panel (4 stat cells: bills tracked /
 *     calibration cohort / sessions covered / refresh cadence) -- replaces
 *     the persona-card concept after preview review found it off-brand
 *   - Bills-moving widget (interim-aware)
 *   - Top categories shortcut grid
 *   - Three generic browse tiles (Search / Committees / Members)
 *   - Global Footer (rendered by the root layout) carries Section 02 line
 *
 * G1 -- Sessions-covered count derives from getAllSessions().length so
 *       rollover years auto-roll. No hardcoded biennium literals.
 * G5 -- 8,062 calibration cohort literal preserved verbatim (frozen until
 *       2027-04 calibration refresh per scoreBill freeze). No scoreBill
 *       or extractFeatures touches.
 * G6 -- Page-scoped component; PublicNav is shared but not globally mounted.
 *       Footer changes preserve Thread 19.1 viewer-aware bottom-line.
 */
import Link from 'next/link'
import PublicNav from './PublicNav'
import BillsMovingWidget from './BillsMovingWidget'
import {
  isInterimPeriod,
  getCurrentSession,
  bienniumShortLabel,
  getAllSessions,
} from '../../lib/session-config'

// Top categories for the shortcut grid. Names sourced from the canonical
// taxonomy in app/lib/categories (15-category list). Hardcoded subset of 6
// highest-salience for anon visitors. Reorder eyeball recommended if the
// canonical list is reordered -- chips link to /search?category=X and the
// search page expects exact-match category strings.
const TOP_CATEGORIES = [
  'Health',
  'Education',
  'Housing',
  'Criminal Justice',
  'Environment',
  'Transportation',
]

const SECTION_EYEBROW = {
  fontSize: 10,
  color: 'var(--text-faint)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 600,
  marginBottom: 10,
}

export default function PublicHome() {
  const interim = isInterimPeriod()
  const sessionShort = bienniumShortLabel(getCurrentSession())
  // Thread 36.4 — datasheet labels "years covered" not "sessions covered".
  // WA Legislature uses 2-year bienniums; getAllSessions().length returns the
  // number of bienniums (3 = 2021-22 + 2023-24 + 2025-26). A casual reader
  // hears "session" and thinks of an annual session, so 3 reads as wrong.
  // Multiplying by 2 gives the unambiguous span: 6 years of data.
  const yearsCovered = getAllSessions().length * 2

  return (
    <div style={{ fontFamily: 'var(--font-body)', minHeight: '100vh', paddingBottom: 40 }}>
      <PublicNav />

      {/* ---- HERO ---- */}
      <header
        style={{
          padding: '56px 20px 36px',
          background: 'linear-gradient(180deg, #0e1014 0%, var(--bg) 100%)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'radial-gradient(ellipse at 70% 20%, rgba(184,151,90,0.08) 0%, transparent 60%)',
            pointerEvents: 'none',
          }}
        />

        <div style={{ position: 'relative', zIndex: 1, maxWidth: 720, margin: '0 auto' }}>
          <img
            src="/logos/vector-wa-primary.svg"
            alt="Vector | WA"
            style={{
              height: 88,
              width: 'auto',
              display: 'block',
              marginBottom: 18,
              filter: 'drop-shadow(0 0 24px rgba(184,151,90,0.28))',
            }}
          />

          <p
            style={{
              fontSize: 18,
              lineHeight: 1.5,
              color: 'var(--text-primary)',
              maxWidth: 540,
              margin: '0 0 12px',
              fontWeight: 500,
            }}
          >
            Free, nonpartisan legislative intelligence for Washington State.
          </p>

          <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--text-mid)', maxWidth: 560, margin: 0 }}>
            Trajectory scores, momentum, and committee activity for every bill in Olympia. Built
            for advocates, staff, journalists, and anyone who wants to read the building.
          </p>

          {/* Thread 71 (2026-05-07) \u2014 hero CTA repointed from /how-it-works
              to /about. After the /install rename, /how-it-works no longer
              exists as a destination, and /install is a retention CTA, not
              the right top-of-funnel pitch for a curious visitor. /about
              is the natural "learn what this is" landing for the hero. */}
          <Link
            href="/about"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 14,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.01em',
              color: 'var(--teal)',
              textDecoration: 'none',
              borderBottom: '1px solid rgba(184,151,90,0.4)',
              paddingBottom: 1,
            }}
          >
            About Vector | WA <span aria-hidden="true">{'\u2192'}</span>
          </Link>
        </div>
      </header>

      {/* ---- EXPLAINER ---- */}
      <section style={{ padding: '24px 20px 8px', maxWidth: 720, margin: '0 auto' }}>
        <div style={SECTION_EYEBROW}>What is Vector | WA</div>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-mid)', margin: '0 0 12px' }}>
          {'Vector | WA is a Washington State legislative intelligence tool. It watches every bill in Olympia, scores its trajectory from 0 to 99, and refreshes nightly. The score blends five procedural signals \u2014 committee placement, sponsor profile, momentum, historical category pass rates, and fiscal note size \u2014 calibrated against thousands of past bills with known outcomes.'}
        </p>
        <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--text-mid)', margin: 0 }}>
          {'The site is free, nonpartisan, and built for anyone who needs to read the docket without paying for an enterprise tracker. The public site launches mid 2027 \u2014 for now, every bill, every committee, and every legislator is here at no cost.'}
        </p>
      </section>

      {/* ---- INTERIM-ONLY OUTCOMES TILE ---- */}
      {interim && (
        <section style={{ padding: '14px 20px 0', maxWidth: 720, margin: '0 auto' }}>
          <Link
            href="/outcomes"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '14px 16px',
              background: 'rgba(184,151,90,0.06)',
              border: '1px solid rgba(184,151,90,0.25)',
              borderRadius: 10,
              textDecoration: 'none',
              color: 'inherit',
              transition: 'border-color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--teal)'
              e.currentTarget.style.background = 'rgba(184,151,90,0.1)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'rgba(184,151,90,0.25)'
              e.currentTarget.style.background = 'rgba(184,151,90,0.06)'
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 10,
                  color: 'var(--gold)',
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                Interim
              </div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.35 }}>
                How did the {sessionShort} session end?
              </div>
              {/* Thread 41.5: copy now matches the destination /outcomes
                  page exact labels (Signed / Passed Chamber / Dead). The
                  prior "what carried over" framing was misleading post-
                  biennium-close (nothing actually carries over to the
                  next biennium) and inconsistent with the destination
                  page's "Passed Chamber - did not become law this
                  session" tooltip. */}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.4 }}>
                {'Final tally \u2014 what was signed, what passed one chamber, what died.'}
              </div>
            </div>
            <span aria-hidden="true" style={{ fontSize: 18, color: 'var(--teal)', flexShrink: 0 }}>{'\u2192'}</span>
          </Link>
        </section>
      )}

      {/* ---- BY THE NUMBERS (Thread 24 datasheet, refined Thread 36.4) ----
           Three cells: calibration cohort + years covered + refresh cadence.
           Bills Tracked tile dropped per Colin 2026-04-28: redundant given
           the BillsMovingWidget below shows live activity.
           "Years covered" replaces "Sessions covered" because WA bienniums
           read as ambiguous to non-WA-native journalists ("3 sessions" reads
           as 3 annual sessions, not 3 bienniums).
           All three values now use mono so the visual rhythm is consistent. */}
      <section style={{ padding: '24px 20px 12px', maxWidth: 720, margin: '0 auto' }}>
        <div style={SECTION_EYEBROW}>By the numbers</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 8,
          }}
        >
          <StatCell value="8,062" label="calibration cohort" />
          <StatCell value={String(yearsCovered)} label="years covered" />
          <StatCell value="Daily" label="refresh" />
        </div>
      </section>

      {/* ---- BILLS-MOVING WIDGET ---- */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '12px 0 8px' }}>
        <BillsMovingWidget />
      </section>

      {/* ---- TOP CATEGORIES SHORTCUT ---- */}
      <section style={{ maxWidth: 720, margin: '0 auto', padding: '20px 20px 8px' }}>
        <div style={SECTION_EYEBROW}>Browse by category</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {TOP_CATEGORIES.map((cat) => (
            <Link
              key={cat}
              href={`/search?category=${encodeURIComponent(cat)}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 500,
                color: 'var(--text-mid)',
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 16,
                textDecoration: 'none',
                transition: 'border-color 0.15s, color 0.15s, background 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--teal)'
                e.currentTarget.style.color = 'var(--teal)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--text-mid)'
              }}
            >
              {cat}
            </Link>
          ))}
          <Link
            href="/search"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--teal)',
              background: 'transparent',
              border: '1px dashed rgba(184,151,90,0.3)',
              borderRadius: 16,
              textDecoration: 'none',
            }}
          >
            {'All categories \u2192'}
          </Link>
        </div>
      </section>

      {/* ---- ENTRY TILES (existing -- generic browse) ---- */}
      <section style={{ padding: '20px 16px 28px', maxWidth: 720, margin: '0 auto' }}>
        <div style={{ ...SECTION_EYEBROW, paddingLeft: 4 }}>Or just browse</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <EntryTile
            href="/search"
            title="Search bills"
            body="Filter by category, sponsor, committee, or status."
          />
          <EntryTile
            href="/committees"
            title="Browse committees"
            body="See where each bill is sitting and what's queued for hearings."
          />
          <EntryTile
            href="/members"
            title="Browse legislators"
            body="Senators, representatives, sponsorship and committee assignments."
          />
        </div>
      </section>
    </div>
  )
}

function StatCell({ value, label }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '14px 12px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 22,
          fontWeight: 700,
          color: 'var(--teal)',
          lineHeight: 1.1,
          textShadow: '0 0 12px rgba(184,151,90,0.25)',
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-faint)',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          marginTop: 6,
          lineHeight: 1.3,
        }}
      >
        {label}
      </div>
    </div>
  )
}

function EntryTile({ href, title, body }) {
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        padding: '16px 16px 18px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        textDecoration: 'none',
        transition: 'border-color 0.15s, background 0.15s, transform 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--teal)'
        e.currentTarget.style.background = 'var(--bg-card-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.background = 'var(--bg-card)'
      }}
    >
      <div
        style={{
          fontSize: 15,
          color: 'var(--text-primary)',
          fontWeight: 600,
          letterSpacing: '0.01em',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{body}</div>
    </Link>
  )
}