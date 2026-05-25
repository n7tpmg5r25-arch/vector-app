'use client'
import { useRef, useEffect } from 'react'

/**
 * SwipeableRow — T140 (complete rebuild)
 *
 * ROOT CAUSE of every previous failure (T102→T138):
 *   React synthetic onTouchMove handlers are ALWAYS passive. Calling
 *   e.preventDefault() inside them is silently ignored — the browser
 *   scrolls anyway, stealing the gesture before JS can act.
 *
 * THE FIX — two things working together:
 *
 *   1. CSS `touch-action: pan-y` on the sliding element.
 *      Tells the browser: "vertical movement = your scroll, horizontal = mine."
 *      The browser never competes with JS on the horizontal axis.
 *      No preventDefault() needed for scroll. No passive-listener gymnastics.
 *
 *   2. Pointer Events API (onPointerDown/Move/Up/Cancel) instead of separate
 *      touch + mouse handler pairs.
 *      `setPointerCapture` routes ALL subsequent pointer events to this element
 *      even when the finger/cursor moves off it during a fast swipe.
 *      `releasePointerCapture` on vertical intent hands control back to the
 *      browser immediately so scroll resumes with zero jank.
 *
 * Props:
 *   children       — card content (slides with the card)
 *   onRemove()     — called after Remove tapped
 *   onHighlight()  — called after Highlight tapped
 *   isHighlighted  — boolean, Highlight button active state
 *   isOpen         — boolean, parent-controlled open state
 *   onOpen()       — tell parent this row opened (parent closes others)
 *   onClose()      — tell parent this row closed
 */

const REVEAL_W = 144  // px — action panel width
const SNAP_PX  = 60   // px — drag threshold to commit open
const ANIM_MS  = 200  // ms

export default function SwipeableRow({
  children,
  onRemove,
  onHighlight,
  isHighlighted,
  isOpen,
  onOpen,
  onClose,
}) {
  const cardRef = useRef(null)

  // All drag state in refs — no re-renders mid-gesture
  const active  = useRef(false)
  const intentH = useRef(false)
  const startX  = useRef(0)
  const startY  = useRef(0)
  const baseX   = useRef(0)   // card offset at drag start: 0 or -REVEAL_W

  // Sync when parent closes this row (e.g. another row opened)
  useEffect(() => {
    if (!isOpen) snap(0)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  function snap(x, animated = true) {
    if (!cardRef.current) return
    cardRef.current.style.transition = animated ? `transform ${ANIM_MS}ms ease` : 'none'
    cardRef.current.style.transform  = `translateX(${x}px)`
  }

  // ── Pointer event handlers ──────────────────────────────────────

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    active.current  = true
    intentH.current = false
    startX.current  = e.clientX
    startY.current  = e.clientY
    baseX.current   = isOpen ? -REVEAL_W : 0
    snap(baseX.current, false)
    // Capture: all future pointer events come here, even off-element
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    if (!active.current) return
    const dx = e.clientX - startX.current
    const dy = e.clientY - startY.current

    if (!intentH.current) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return // dead zone
      if (Math.abs(dy) > Math.abs(dx)) {
        // Vertical intent — release capture, let touch-action: pan-y handle scroll
        active.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        return
      }
      intentH.current = true
    }

    const raw     = baseX.current + dx
    const clamped = Math.max(-REVEAL_W, Math.min(0, raw))
    snap(clamped, false)
  }

  function onPointerUp(e) {
    if (!active.current) return
    active.current = false
    if (!intentH.current) return

    const dx  = e.clientX - startX.current
    const eff = baseX.current + dx

    if (eff < -SNAP_PX) {
      snap(-REVEAL_W)
      onOpen()
    } else {
      snap(0)
      if (isOpen) onClose()
    }
  }

  function onPointerCancel() {
    if (!active.current) return
    active.current = false
    snap(isOpen ? -REVEAL_W : 0)
  }

  function onCardClick(e) {
    // Tap anywhere on the open card closes the panel
    if (isOpen) {
      e.preventDefault()
      snap(0)
      onClose()
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 'var(--radius)',
        // Brass ring when this card is swiped open — shows which card is active
        boxShadow: isOpen
          ? '0 0 0 1.5px rgba(184,151,90,0.6), 0 4px 24px rgba(0,0,0,0.4)'
          : 'none',
        transition: `box-shadow ${ANIM_MS}ms ease`,
      }}
    >
      {/* ── Action panel — behind card, revealed when card slides left ── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: REVEAL_W,
          display: 'flex',
          overflow: 'hidden',
          borderRadius: 'var(--radius)',
        }}
      >
        {/* Highlight — brass left half */}
        <button
          onClick={e => {
            e.stopPropagation()
            snap(0)
            onClose()
            setTimeout(onHighlight, ANIM_MS)
          }}
          style={{
            flex: 1, border: 'none', cursor: 'pointer',
            background: isHighlighted ? 'rgba(184,151,90,0.85)' : 'var(--teal)',
            color: 'var(--bg)',
            fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 700,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 5, lineHeight: 1.2,
          }}
        >
          <span style={{ fontSize: 20 }}>{isHighlighted ? '●' : '+'}</span>
          <span>{isHighlighted ? 'In Report' : 'Highlight'}</span>
        </button>

        {/* Remove — danger red right half */}
        <button
          onClick={e => {
            e.stopPropagation()
            snap(0)
            onClose()
            setTimeout(onRemove, ANIM_MS)
          }}
          style={{
            flex: 1, border: 'none', cursor: 'pointer',
            background: 'var(--danger)',
            color: '#fff',
            fontSize: 12, fontFamily: 'var(--font-body)', fontWeight: 700,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            gap: 5, lineHeight: 1.2,
          }}
        >
          <span style={{ fontSize: 20 }}>✕</span>
          <span>Remove</span>
        </button>
      </div>

      {/* ── Sliding card ── */}
      <div
        ref={cardRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onCardClick}
        style={{
          position: 'relative',
          zIndex: 1,
          willChange: 'transform',
          touchAction: 'pan-y',   // ← THE KEY: vertical scroll = browser, horizontal = JS
          userSelect: 'none',     // no text-selection flash on desktop drag
          cursor: isOpen ? 'default' : 'grab',
        }}
      >
        {children}

        {/* Swipe hint — left-edge brass sliver, only when closed */}
        {!isOpen && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              left: 0, top: '50%',
              transform: 'translateY(-50%)',
              width: 3, height: '35%',
              background: 'var(--teal)',
              borderRadius: '0 2px 2px 0',
              opacity: 0.4,
              pointerEvents: 'none',
            }}
          />
        )}
      </div>
    </div>
  )
}
