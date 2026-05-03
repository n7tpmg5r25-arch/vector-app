'use client'
// Vector | WA — InstallPrompt (Thread 61, 2026-05-02).
//
// Adds a real install affordance to the /how-it-works PWA explainer
// (Section 4, added in Thread 36.8). The Section 4 prose already covers
// per-platform instructions; this component layers an actionable button
// (or the closest analogue per platform) on top.
//
// Four render branches:
//   1. Already installed → muted Sage pill "Already installed ✓".
//      Detected via display-mode:standalone (Android/desktop) OR
//      navigator.standalone === true (iOS legacy).
//   2. iOS (Safari/Chrome) → instructions block + inline iOS share icon.
//      WebKit does NOT expose beforeinstallprompt, so a programmatic
//      install is impossible; the share-sheet hint is the best we can do.
//   3. Has deferredPrompt (Chrome/Edge/Samsung Internet, Android + desktop)
//      → brass .vec-cta-primary button. Click calls deferredPrompt.prompt(),
//      awaits user choice, then clears state regardless of outcome.
//   4. Fallback (Firefox desktop, etc.) → muted text pointing at the
//      browser menu. No reliable API to detect "user dismissed before."
//
// Senior-dev calls (per Phase 6 Thread 61 spec):
//   - Don't auto-prompt on page load; wait for user click.
//   - Don't try to detect prior dismissal; show menu fallback.
//   - Listener scoped to component mount, not layout.tsx, so it tears
//     down with the page and doesn't leak into the global event surface.
//
// Hydration safety: render returns null until the post-mount effect has
// run so the server-rendered tree never disagrees with the client tree
// over UA-derived branches.
import { useEffect, useState } from 'react'
import { Download, Check } from 'lucide-react'

// Inline iOS share icon — square with an up-arrow protruding from the top.
// No asset dependency; the rest of /how-it-works also avoids public/ icons.
function IosShareIcon({ size = 18 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: '-3px', flexShrink: 0 }}
    >
      {/* arrow shaft + head */}
      <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <polyline points="8,7 12,3 16,7" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* enclosing share box (open at the top) */}
      <path d="M6 11 L6 20 L18 20 L18 11" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function InstallPrompt() {
  const [mounted, setMounted] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)
  const [platform, setPlatform] = useState('other') // 'ios' | 'other'
  const [installed, setInstalled] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    setMounted(true)

    // Platform sniff. Only iOS gets a separate branch because WebKit lacks
    // beforeinstallprompt; everything else either fires the event or we
    // fall through to the menu-instructions branch.
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent || ''
      if (/iPhone|iPad|iPod/i.test(ua)) {
        setPlatform('ios')
      }
    }

    // Already-installed detection.
    try {
      const standaloneMM =
        typeof window !== 'undefined' &&
        window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches
      const iosStandalone =
        typeof navigator !== 'undefined' && navigator.standalone === true
      if (standaloneMM || iosStandalone) setInstalled(true)
    } catch {
      // matchMedia missing in some old runtimes; ignore.
    }

    const onBeforeInstall = (e) => {
      // Stop the browser's auto-mini-banner; we'll prompt on user click.
      e.preventDefault()
      setDeferredPrompt(e)
    }
    const onAppInstalled = () => {
      setInstalled(true)
      setDeferredPrompt(null)
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [])

  async function handleInstallClick() {
    if (!deferredPrompt || installing) return
    setInstalling(true)
    try {
      deferredPrompt.prompt()
      // userChoice resolves whether the user accepts or dismisses.
      // Either way the event is single-use; clear it.
      await deferredPrompt.userChoice
    } catch {
      // Some browsers throw if prompt() is called twice; safe to ignore.
    } finally {
      setDeferredPrompt(null)
      setInstalling(false)
    }
  }

  // Avoid hydration mismatch: server has no UA, no matchMedia, no event.
  if (!mounted) return null

  // ── Branch 1: already installed ───────────────────────────────────
  if (installed) {
    return (
      <div
        role="status"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          color: '#7aab6e', // Sage — functional success per Brand v1.2 §02
          background: 'rgba(122,171,110,0.10)',
          border: '1px solid rgba(122,171,110,0.35)',
          borderRadius: 999,
          fontFamily: 'var(--font-mono)',
          textTransform: 'uppercase',
        }}
      >
        <Check size={14} strokeWidth={2.5} aria-hidden="true" />
        Already installed
      </div>
    )
  }

  // ── Branch 2: iOS (no programmatic install) ───────────────────────
  if (platform === 'ios') {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          padding: '10px 12px',
          background: 'rgba(184,151,90,0.06)',
          border: '1px solid rgba(184,151,90,0.25)',
          borderRadius: 'var(--radius)',
          fontSize: 13,
          color: 'var(--text-muted)',
          lineHeight: 1.5,
        }}
      >
        <span style={{ color: 'var(--teal)', marginTop: 1 }}>
          <IosShareIcon />
        </span>
        <span>
          Tap <strong style={{ color: 'var(--text-primary)' }}>Share</strong> in Safari, then{' '}
          <strong style={{ color: 'var(--text-primary)' }}>Add to Home Screen</strong> to install
          Vector | WA.
        </span>
      </div>
    )
  }

  // ── Branch 3: deferredPrompt available (Chrome/Edge/Samsung) ─────
  if (deferredPrompt) {
    return (
      <button
        type="button"
        onClick={handleInstallClick}
        disabled={installing}
        className="vec-cta-primary"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          width: '100%',
          padding: '12px 16px',
          background: 'var(--teal)',
          color: 'var(--bg)',
          border: 'none',
          borderRadius: 'var(--radius)',
          fontSize: 14,
          fontWeight: 600,
          letterSpacing: '0.04em',
          cursor: installing ? 'wait' : 'pointer',
          fontFamily: 'var(--font-body)',
        }}
      >
        <Download size={16} strokeWidth={2.2} aria-hidden="true" />
        {installing ? 'Opening install…' : 'Install Vector | WA'}
      </button>
    )
  }

  // ── Branch 4: fallback (Firefox desktop, browsers that never fire) ─
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'rgba(168,172,180,0.05)',
        border: '1px dashed var(--border)',
        borderRadius: 'var(--radius)',
        fontSize: 13,
        color: 'var(--text-faint)',
        lineHeight: 1.5,
      }}
    >
      Use your browser menu (⋮ → <strong style={{ color: 'var(--text-muted)' }}>Install</strong>) to
      add Vector | WA to your device.
    </div>
  )
}
