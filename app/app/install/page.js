'use client'
// Thread 71 — /install (renamed from /how-it-works, 2026-05-07)
//
// Lean utility page: header + one framing card + <InstallPrompt /> + manual
// iOS / Android / Desktop fallback instructions + tail. The previous
// /how-it-works page bundled a 4-section explainer (what Vector tracks /
// how the score works / what the score is NOT / install) that had grown
// redundant with /about §1 and /methodology. Thread 71 stripped the
// explainer sections, keeping only the install flow Thread 61 (PR #93)
// added in Section 4 — and renamed the route to match.
//
// Old explainer prose + the 5-signal icon strip + tier legend were saved
// verbatim to:
//   C:\Users\Col\Documents\Claude\Projects\Vector - WA\
//     HOW_IT_WORKS_SNIPPETS_FOR_THREAD_62.md
// for reference when the Thread 62 /about rewrite is drafted.
//
// Mobile-only by design (480-px column). Vector | WA palette via CSS vars
// only — no Shorepine firm Forest/Parchment.
//
// Nav.js serves all viewers (anon + authed). Sticky HEADER pattern from PR #81.
//
// Three Truths anchoring (Brand v1.2):
//   #1 Human relationships > software → quiet, modest framing. No
//      "supercharge your day" pitch.
//   #2 Trajectory not certainty → "tracker," not "predictor."
//   #3 Accessible, transparent, public data → free + open framing in the
//      one-paragraph card. Links out for the deeper learning.
//
// Guardrails honored:
//   G1 — No hardcoded session labels, cutoff dates, or biennium literals.
//   G5 — No scoreBill / extractFeatures / cohort literal touches.
//   G6 — Page-scoped surface; Nav.js serves all viewers.
import Link from 'next/link'
import Nav from '../components/Nav'
import InstallPrompt from '../components/InstallPrompt'
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

const INLINE_LINK = {
  color: 'var(--teal)',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
}

export default function InstallPage() {
  const { loading: viewerLoading } = useViewer()

  return (
    <div style={{ paddingBottom: 100, fontFamily: 'var(--font-body)' }}>
      {/* Sticky HEADER — 52px top padding clears the HamburgerButton. */}
      <div style={{
        position: 'sticky',
        top: 0, zIndex: 50,
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 20px 20px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24,
          fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>Install Vector | WA</div>
        <div style={{ fontSize: 12, color: 'var(--text-faint)', marginTop: 4 }}>
          Add the app to your home screen for one-tap access and offline reading.
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* SECTION 1 — WHAT YOU'RE INSTALLING (one-paragraph framing card) */}
        <div>
          <div style={EYEBROW}>1 &middot; What you&apos;re installing</div>
          <div style={CARD}>
            <p style={{ marginTop: 0, marginBottom: 0 }}>
              Vector | WA is a <span style={HIGHLIGHT}>free, nonpartisan tracker</span> for every
              bill in the Washington State Legislature. Installing it as an app puts the site on
              your home screen &mdash; no browser bar, faster cold start, and bills you&apos;ve
              already viewed stay readable offline. New here?{' '}
              <Link href="/about" style={INLINE_LINK}>Read about the project</Link>
              {' '}or see{' '}
              <Link href="/methodology" style={INLINE_LINK}>how the trajectory score is built</Link>
              {' '}before you install.
            </p>
          </div>
        </div>

        {/* SECTION 2 — INSTALL FLOW (Thread 61 PR #93 component, unchanged) */}
        <div>
          <div style={EYEBROW}>2 &middot; Install</div>
          <div style={CARD}>
            {/* Thread 61 -- One-tap install for browsers that support
                beforeinstallprompt (Android Chrome / Edge / Samsung
                Internet, desktop Chrome / Edge). iOS gets share-sheet
                instructions. Already-installed gets a Sage pill. The
                manual three-platform reference below stays as a
                fallback for anyone who lands here mid-install or on a
                browser that never fires the event. */}
            <InstallPrompt />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  iPhone &amp; iPad &middot; Safari
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  Tap the share sheet (the square with an up arrow), scroll to{' '}
                  <span style={HIGHLIGHT}>Add to Home Screen</span>, then tap Add. The icon lands on
                  your home screen next to the rest of your apps.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Android &middot; Chrome
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  Tap the menu (three dots, top right) and choose{' '}
                  <span style={HIGHLIGHT}>Install app</span> or{' '}
                  <span style={HIGHLIGHT}>Add to Home screen</span>. Chrome may also offer an
                  install banner on its own after a few visits.
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 3, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  Desktop &middot; Chrome / Edge
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
                  Look for the small install icon in the address bar (a monitor with a down arrow,
                  right of the URL). Click it and confirm{' '}
                  <span style={HIGHLIGHT}>Install</span>. Vector | WA opens in its own window.
                </div>
              </div>
            </div>
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
            For the project background and why the site is free, see{' '}
            <Link href="/about" style={INLINE_LINK}>About Vector | WA</Link>
            . For the full scoring formula and the live calibration table, see the{' '}
            <Link href="/methodology" style={INLINE_LINK}>methodology page</Link>
            .
          </div>
        </div>

      </div>

      {!viewerLoading && <Nav />}
    </div>
  )
}
