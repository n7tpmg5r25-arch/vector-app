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
  const { user, publicLayerEnabled } = useViewer()
  const isAnonPublic = publicLayerEnabled && !user

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

      {!isAnonPublic && <Nav />}
    </div>
  )
}
