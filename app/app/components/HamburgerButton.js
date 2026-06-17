'use client'
/**
 * HamburgerButton — Phase 5 Thread 55 (2026-05-01)
 *
 * Trigger button for the global SideDrawer. Kept as its own component so
 * the Nav family (Nav.js for owner/client, PublicNav.js for public) can
 * adopt it independently without coupling either nav surface to drawer
 * internals.
 *
 * Communication contract:
 *   - On click, dispatches a `vec-drawer-open` window CustomEvent.
 *   - SideDrawer.js (globally mounted in app/app/layout.tsx) listens for
 *     that event and opens itself. No prop-drilling, no context provider,
 *     no extra render tree.
 *
 * Visual treatment:
 *   - Brass-tinted icon on transparent ground; matches the brass eyebrow
 *     accent across Nav.js + PublicNav.js (Brand Guide v1.2 §02 brass).
 *   - 40 × 40 tap target (Apple HIG / Material minimum) with the icon
 *     centered at 22 × 22.
 *
 * Accessibility:
 *   - aria-label "Open menu" — screen readers announce purpose.
 *   - aria-haspopup="menu" + aria-expanded mirrors the drawer state via
 *     the same event channel.
 *
 * Mobile-only by design (Vector | WA mobile column directive in CLAUDE.md).
 */
import { useEffect, useState } from 'react'

export default function HamburgerButton({ style }) {
  // Mirrors the drawer state for aria-expanded. Listens for the same
  // open/close events the drawer dispatches so the button stays correct
  // even if something else (Escape, outside-click) closes the drawer.
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onOpen() { setOpen(true) }
    function onClose() { setOpen(false) }
    window.addEventListener('vec-drawer-open', onOpen)
    window.addEventListener('vec-drawer-close', onClose)
    return () => {
      window.removeEventListener('vec-drawer-open', onOpen)
      window.removeEventListener('vec-drawer-close', onClose)
    }
  }, [])

  function handleClick() {
    if (open) {
      window.dispatchEvent(new CustomEvent('vec-drawer-close'))
    } else {
      window.dispatchEvent(new CustomEvent('vec-drawer-open'))
    }
  }

  return (
    <button
      type="button"
      aria-label="Open menu"
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={handleClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 40,
        height: 40,
        background: 'transparent',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        padding: 0,
        color: 'var(--brass, var(--teal))',
        transition: 'background 0.15s, color 0.15s',
        ...(style || {}),
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(184,151,90,0.10)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="4" y1="6" x2="20" y2="6" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="18" x2="20" y2="18" />
      </svg>
    </button>
  )
}
