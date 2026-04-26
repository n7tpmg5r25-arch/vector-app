'use client'
// Thread 9 — /how-it-works Public Explainer (2026-04-25)
// Plain-English landing page for non-expert anonymous visitors. Sits between
// PublicHome (brand-y) and /methodology (expert-deep). Three sections of
// ~200 words each: what Vector tracks, how the score works, what the score
// is NOT.
//
// Mobile-only by design (480-px column). Vector | WA palette via CSS vars
// only — no Shorepine firm Forest/Parchment here (those live in the PDF
// brief, email headers, and firm footer per CLAUDE.md).
//
// Anon-aware shell mirrors /methodology (lines 207–217 + 594) — PublicNav
// for anon visitors when the public-layer flag is on, owner Nav otherwise.
//
// Guardrails honored:
//   G1 — No hardcoded session labels, cutoff dates, or session start dates.
//        "Nightly" is OK (not session-bound). "Around 50 new bills a day"
//        is a velocity, not a count, and is broadly true of any active WA
//        session.
//   G5 — The frozen 8,062-bill calibration cohort literal (2021-22 +
//        2023-24 + 2025-26) is preserved verbatim. It's tied to the
//        scoreBill() freeze and matches /methodology and CohortCitation.
import Nav from '../components/Nav'
import PublicNav from '../components/PublicNav'
import { useViewer } from '../../lib/viewer-capabilities'

const CARD = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: 16,
  fontSize: 14,
  color: 'var(--text-muted)',
  lineHeight: 1.65,
}

const EYEBROW = {
  fontSize: 10,
  color: 'var(--text-faint)',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  marginBottom: 10,
  fontWeight: 600,
}

const HIGHLIGHT = { color: 'var(--teal)', fontWeight: 600 }

export default function HowItWorksPage() {
  // Thread 15.2 — viewerLoading destructured + isAnonPublic gated on !viewerLoading
  // so authed users no longer flash PublicNav during auth resolve.
  const { user, loading: viewerLoading, publicLayerEnabled } = useViewer()
  const isAnonPublic = !viewerLoading && publicLayerEnabled && !user

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {/* PublicNav for anon when the public-layer flag is on */}
      {isAnonPublic && <PublicNav />}

      {/* HEADER */}
      <div style={{
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: isAnonPublic ? '16px 20px 20px' : '52px 20px 20px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>How Vector works</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          A plain-English explainer for journalists, advocates, and anyone new to the score.
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* SECTION 1 — WHAT VECTOR TRACKS */}
        <div>
          <div style={EYEBROW}>1 · What Vector tracks</div>
          <div style={CARD}>
            <p style={{ marginTop: 0 }}>
              Vector | WA watches every bill introduced in the Washington State Legislature,
              from the moment it&apos;s prefiled in December through sine die. During an active
              session that&apos;s around 50 new bills a day, plus thousands of position changes,
              hearings, executive sessions, and floor votes layered onto the bills already in flight.
            </p>
            <p>
              Each bill carries a <span style={HIGHLIGHT}>trajectory score</span> — a number from
              0 to 99 that estimates where it&apos;s headed. The score is built from five signals:
              committee activity, sponsor profile, momentum, historical category pass rates, and
              fiscal note size. On top of that base, a documented set of X Factors — companion
              bills, cutoff pressure, Rules-committee holds, floor margins, and a dozen others —
              pulls the score up or down to reflect procedural realities a seasoned lobbyist would
              weigh.
            </p>
            <p style={{ marginBottom: 0 }}>
              Scores recompute nightly. Position changes, new hearings, executive session results,
              and substitute filings flow into the model the same evening they&apos;re posted by
              the WA Legislature. The next morning, anyone watching the bill sees an updated
              trajectory, an updated tier (HIGH / MODERATE / LOW / VERY LOW), and a fresh activity
              log — not a stale cached number from the day the bill was introduced.
            </p>
          </div>
        </div>

        {/* SECTION 2 — HOW THE SCORE WORKS */}
        <div>
          <div style={EYEBROW}>2 · How the score works, in English</div>

          {/* Thread 13.2 — Visual support for the prose. Two inline SVG groups:
              (a) 5-signal icon strip — one glyph per base signal, brass stroke,
                  no external assets. Mirrors the five signals documented on
                  /methodology so the eye anchors before the prose explains.
              (b) 4-dot tier legend — circle swatches for HIGH / MODERATE /
                  LOW / VERY LOW using the SAME hex values ScoreBadge.js paints
                  on real bill cards (Sage / Deep Teal / Amber / Stone). Honest
                  legend — what the user sees here is what they see on a bill. */}
          <div style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '14px 12px 12px',
            marginBottom: 12,
          }}>
            {/* 5-signal icon strip */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 6,
              marginBottom: 14,
            }}>
              {[
                {
                  name: 'Committee',
                  // Gavel resting on a small block — committee action
                  svg: (
                    <>
                      <rect x="3" y="17" width="18" height="3" rx="0.5" stroke="var(--gold)" strokeWidth="1.5" fill="none"/>
                      <rect x="9" y="6" width="11" height="4" rx="0.5" transform="rotate(20 9 6)" stroke="var(--gold)" strokeWidth="1.5" fill="none"/>
                      <line x1="6.5" y1="10" x2="13" y2="14" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round"/>
                    </>
                  ),
                },
                {
                  name: 'Sponsor',
                  // Person silhouette — bust + shoulders
                  svg: (
                    <>
                      <circle cx="12" cy="8" r="3.5" stroke="var(--gold)" strokeWidth="1.5" fill="none"/>
                      <path d="M5 20 C 5 15, 9 13, 12 13 C 15 13, 19 15, 19 20" stroke="var(--gold)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                    </>
                  ),
                },
                {
                  name: 'Momentum',
                  // Upward zig-zag chart line
                  svg: (
                    <>
                      <polyline points="3,18 8,13 12,15 16,8 21,5" stroke="var(--gold)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                      <polyline points="17,5 21,5 21,9" stroke="var(--gold)" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </>
                  ),
                },
                {
                  name: 'Historical',
                  // Clock face — hour + minute hand
                  svg: (
                    <>
                      <circle cx="12" cy="12" r="8" stroke="var(--gold)" strokeWidth="1.5" fill="none"/>
                      <line x1="12" y1="12" x2="12" y2="7" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round"/>
                      <line x1="12" y1="12" x2="15.5" y2="13.5" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round"/>
                    </>
                  ),
                },
                {
                  name: 'Fiscal',
                  // Dollar sign in a circle — fiscal note
                  svg: (
                    <>
                      <circle cx="12" cy="12" r="8" stroke="var(--gold)" strokeWidth="1.5" fill="none"/>
                      <path d="M14.5 9 C 14 8, 13 7.5, 12 7.5 C 10.5 7.5, 9.5 8.5, 9.5 9.5 C 9.5 10.5, 10.5 11, 12 11.5 C 13.5 12, 14.5 12.5, 14.5 13.5 C 14.5 14.5, 13.5 15.5, 12 15.5 C 11 15.5, 10 15, 9.5 14" stroke="var(--gold)" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                      <line x1="12" y1="6" x2="12" y2="17" stroke="var(--gold)" strokeWidth="1.5" strokeLinecap="round"/>
                    </>
                  ),
                },
              ].map((s) => (
                <div key={s.name} style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
                  <svg
                    viewBox="0 0 24 24"
                    width="28"
                    height="28"
                    aria-hidden="true"
                    style={{ display: 'block', margin: '0 auto 4px' }}
                  >
                    {s.svg}
                  </svg>
                  <div style={{
                    fontSize: 10,
                    color: 'var(--text-muted)',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    lineHeight: 1.2,
                  }}>{s.name}</div>
                </div>
              ))}
            </div>

            {/* Hairline divider between strip + legend */}
            <div style={{
              height: 1,
              background: 'var(--border)',
              margin: '0 -12px 12px',
            }}/>

            {/* 4-dot tier-color legend — hexes mirror ScoreBadge.js exactly so
                this legend is honest about what users will see on bill cards. */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 6,
              flexWrap: 'wrap',
            }}>
              {[
                { tier: 'HIGH',     hex: '#7aab6e' },  // Sage — matches ScoreBadge ≥75
                { tier: 'MODERATE', hex: '#3a7a8a' },  // Deep Teal — matches ScoreBadge ≥60
                { tier: 'LOW',      hex: '#c47a30' },  // Amber — matches ScoreBadge ≥45
                { tier: 'VERY LOW', hex: '#8a8070' },  // Stone — matches ScoreBadge <45
              ].map((t) => (
                <div key={t.tier} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 10,
                  color: 'var(--text-muted)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.04em',
                }}>
                  <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
                    <circle cx="6" cy="6" r="5" fill={t.hex} />
                  </svg>
                  <span>{t.tier}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={CARD}>
            <p style={{ marginTop: 0 }}>
              The score is calibrated, not opinion. Vector&apos;s model was tuned against a frozen
              cohort of <span style={HIGHLIGHT}>8,062 bills across 2021-22 + 2023-24 + 2025-26</span> —
              every one of them with a known final outcome (signed, passed a chamber, or died).
              That cohort is the calibration ground truth: when we say a 75 means &ldquo;probably
              advances,&rdquo; we mean bills that scored 75 in past completed sessions advanced at
              a rate the methodology page documents bucket by bucket.
            </p>
            <p>
              The five base signals are simple counts — did the bill get a hearing, did committee
              pass it, who sponsored it, how recent is the last action, what&apos;s the fiscal note.
              The X Factors are the procedural overlay: a bill pulled from Rules behaves very
              differently from one held there, and the model knows that. Stacked together, the base
              and the overlay produce a 0–99 number with a transparent provenance — every input is
              documented on the methodology page.
            </p>
            <p style={{ marginBottom: 0 }}>
              The output is a probability statement, not a prediction. A bill scoring 80 is not
              certain to pass; it sits in a bucket where, historically, a documented share of its
              peers passed. Read the score the way you&apos;d read a weather forecast — directional
              intelligence calibrated against past outcomes, useful for planning, never a guarantee.
            </p>
          </div>
        </div>

        {/* SECTION 3 — WHAT THE SCORE IS NOT */}
        <div>
          <div style={EYEBROW}>3 · What the score is NOT</div>
          <div style={CARD}>
            <p style={{ marginTop: 0 }}>
              <span style={HIGHLIGHT}>Vector is not sentiment analysis.</span>{' '}
              The model never reads tone, body language, or a sponsor&apos;s mood. It reads
              procedural signals — votes cast, cutoffs cleared, motions filed, days since last
              action — and weights them against historical patterns. A bill with a passionate
              floor speech and no committee vote scores lower than a quietly negotiated bill
              that just cleared its second committee.
            </p>
            <p>
              <span style={HIGHLIGHT}>Vector is not a political prediction.</span>{' '}
              The model does not forecast which party will hold the gavel next session, who will
              challenge whom in a primary, or whether a particular member will switch positions.
              Trajectory scoring lives entirely inside the legislative process — bill text, sponsor
              roster, committee actions, floor results — and reads only what the WA Legislature
              itself publishes.
            </p>
            <p style={{ marginBottom: 0 }}>
              <span style={HIGHLIGHT}>Vector is not a recommendation to support or oppose a bill.</span>{' '}
              The score doesn&apos;t say a bill is good or bad, helpful or harmful. A 90 on a bill
              you find objectionable is not Vector taking a side — it&apos;s the model telling you
              the bill is on track to pass and you may want to engage sooner rather than later.
              Whether to support, oppose, or stay neutral is your call, not the tool&apos;s.
            </p>
          </div>
        </div>

        {/* TAIL — GO DEEPER */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          fontSize: 13,
          color: 'var(--text-muted)',
          lineHeight: 1.55,
        }}>
          <div style={{
            marginBottom: 8,
            fontSize: 11,
            color: 'var(--text-faint)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontWeight: 600,
          }}>
            Go deeper
          </div>
          <div>
            For the full scoring formula, the live calibration table, and signal-tier definitions,
            see the{' '}
            <a href="/methodology" style={{ color: 'var(--teal)', textDecoration: 'underline' }}>
              methodology page
            </a>.
          </div>
        </div>

      </div>

      {!viewerLoading && !isAnonPublic && <Nav />}
    </div>
  )
}
