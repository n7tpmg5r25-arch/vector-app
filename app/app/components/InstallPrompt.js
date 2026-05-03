'use client'
// Thread 61 — PWA install prompt (2026-05-03).
//
// Renders one of four mutually-exclusive states inside Section 4 of
// /how-it-works:
//
//   1. ALREADY-INSTALLED → muted Sage pill ("Already installed ✓").
//      Detected via display-mode:standalone media query OR the legacy
//      iOS Safari navigator.standalone flag.
//
//   2. IOS → inline instructions block + small inline-SVG of the iOS
//      share glyph. iOS Safari and iOS Chrome do NOT fire
//      beforeinstallprompt — programmatic install is unavailable on
//      WebKit, so the only honest UX is "tap Share, then Add to Home
//      Screen."
//
//   3. PROMPT-AVAILABLE → brass .vec-cta-primary button ("Install
//      Vector | WA"). Click invokes the stashed deferredPrompt's
//      prompt() method and awaits userChoice. Button hides post-choice
//      to avoid double-prompting (browsers ignore a second call on the
//      same event anyway).
//
//   4. FALLBACK → muted "Use your browser menu (⋮ → Install)" copy for
//      Android/Desktop browsers that never fire beforeinstallprompt
//      (e.g. Firefox desktop, Brave with PWA disabled). No console
//      noise — just an honest pointer to the browser's own UX.
//
// Senior-dev calls (per Phase 6 Plan § Thread 61):
//   - Don't auto-prompt on page load. Browsers throttle unsolicited
//     prompts; only a user gesture is reliable.
//   - Don't try to detect "user dismissed before" — no reliable API.
//   - Listener is component-scoped (mount-only), NOT mounted at the
//     layout level. Keeps the surface small and avoids leaking
//     deferredPrompt state across routes.
//
// Branding: brass primary CTA matches Brand Guide v1.2 §02 (CTA token
// from Phase 5 Thread 35). Sage success semantic per §02 functional
// palette. iOS share SVG inline so we don't add an asset dependency.
//
// Three-layer impact: anon-public surface (/how-it-works is in
// proxy.js isPublicLayerRoute allowlist). Owner + client viewers also
// land on this page through the drawer's Reference section (Thread
// 58.3).

import { useEffect, useState } from 'react'

const STATE = {
  DETECTING: 'detecting',
  INSTALLED: 'installed',
  IOS: 'ios',
  READY: 'ready',
  FALLBACK: 'fallback',
}

// Sage success token — mirrors ScoreBadge HIGH tier hex per Brand Guide §02.
const SAGE = '#7aab6e'

export default function InstallPrompt() {
  const [state, setState] = useState(STATE.DETECTING)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Already-installed detection. display-mode:standalone covers
    // Chrome/Edge/Samsung once installed; navigator.standalone is the
    // iOS Safari legacy property (matchMedia is unreliable on iOS for
    // PWAs added pre-iOS-16.4).
    const isStandalone =
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true

    if (isStandalone) {
      setState(STATE.INSTALLED)
      return
    }

    // Platform detection — UA sniff is acceptable here because the
    // only branch we need is "is this WebKit on an Apple mobile
    // device" (which never fires beforeinstallprompt). User-agent
    // hints API would be cleaner but doesn't yet cover Safari.
    const ua = window.navigator.userAgent || ''
    const isIOS = /iPhone|iPad|iPod/.test(ua) && !window.MSStream

    if (isIOS) {
      setState(STATE.IOS)
      return
    }

    // Default to fallback. If beforeinstallprompt fires, we promote
    // to READY. If the listener never fires (Firefox desktop, etc.)
    // the user keeps the browser-menu fallback copy.
    setState(STATE.FALLBACK)

    const handleBeforeInstallPrompt = (event) => {
      // preventDefault stops the browser's mini-infobar so we own
      // the placement (per Web Platform spec).
      event.preventDefault()
      setDeferredPrompt(event)
      setState(STATE.READY)
    }

    const handleAppInstalled = () => {
      // Fires after a successful install via any path (our button or
      // the browser's own UI). Flip to the installed pill.
      setDeferredPrompt(null)
      setState(STATE.INSTALLED)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  async function handleInstallClick() {
    if (!deferredPrompt || installing) return
    setInstalling(true)
    try {
      // prompt() shows the native install dialog. userChoice resolves
      // with { outcome: 'accepted' | 'dismissed' }.
      await deferredPrompt.prompt()
      const choice = await deferredPrompt.userChoice
      if (choice && choice.outcome === 'accepted') {
        // appinstalled listener will flip to INSTALLED. Belt-and-
        // suspenders: clear deferredPrompt immediately so a second
        // click can't re-fire a stale event.
        setDeferredPrompt(null)
      } else {
        // User dismissed. Per W3C, a single deferredPrompt can only
        // be used once — drop back to FALLBACK so we don't show a
        // dead button.
        setDeferredPrompt(null)
        setState(STATE.FALLBACK)
      }
    } catch (e) {
      // Some browsers throw if prompt is called outside a user
      // gesture or after the event has been consumed. Either way,
      // step the user back to the fallback rather than show a
      // broken button.
      setDeferredPrompt(null)
      setState(STATE.FALLBACK)
    } finally {
      setInstalling(false)
    }
  }

  // SSR / pre-detection: render nothing. Avoids hydration mismatch
  // and prevents flicker between "fallback" and the resolved branch.
  if (state === STATE.DETECTING) return null

  if (state === STATE.INSTALLED) {
    return (
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          borderRadius: 999,
          border: `1px solid ${SAGE}`,
          background: 'rgba(122,171,110,0.10)',
          color: SAGE,
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
          marginBottom: 14,
        }}
        role="status"
        aria-live="polite"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path
            d="M3 8.5 L6.5 12 L13 4"
            stroke={SAGE}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span>Already installed</span>
      </div>
    )
  }

  if (state === STATE.IOS) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 12px',
          borderRadius: 'var(--radius)',
          border: '1px solid var(--border)',
          background: 'rgba(184,151,90,0.06)',
          marginBottom: 14,
        }}
      >
        {/* iOS share glyph — square with up-arrow piercing the top edge. */}
        <svg
          viewBox="0 0 24 24"
          width="22"
          height="22"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 1 }}
        >
          <path
            d="M12 3 L12 15"
            stroke="var(--teal)"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M8 7 L12 3 L16 7"
            stroke="var(--teal)"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6 11 L6 20 L18 20 L18 11"
            stroke="var(--teal)"
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55 }}>
          <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
            On iPhone or iPad:
          </strong>{' '}
          tap the Share button (the square with the up arrow) at the bottom of Safari, then
          choose <span style={{ color: 'var(--teal)', fontWeight: 600 }}>Add to Home Screen</span>.
        </div>
      </div>
    )
  }

  if (state === STATE.READY) {
    return (
      <button
        type="button"
        onClick={handleInstallClick}
        disabled={installing}
        className="vec-cta-primary"
        style={{
          display: 'inline-block',
          marginBottom: 14,
          padding: '10px 22px',
          background: 'var(--brass)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: 'var(--radius)',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: 'var(--font-body)',
          cursor: installing ? 'wait' : 'pointer',
          letterSpacing: '0.02em',
        }}
      >
        {installing ? 'Opening installer…' : 'Install Vector | WA'}
      </button>
    )
  }

  // FALLBACK — Android Chrome that hasn't fired beforeinstallprompt yet,
  // Firefox desktop, Brave with PWA disabled, etc. Keep the copy honest:
  // we can't programmatically install for these browsers.
  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        background: 'rgba(184,151,90,0.04)',
        fontSize: 13,
        color: 'var(--text-muted)',
        lineHeight: 1.55,
        marginBottom: 14,
      }}
    >
      Use your browser menu (<span style={{ fontFamily: 'var(--font-mono)' }}>⋮</span> →{' '}
      <span style={{ color: 'var(--teal)', fontWeight: 600 }}>Install app</span>) to add
      Vector | WA to your device.
    </div>
  )
}
