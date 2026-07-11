'use client'
import { useRef, useEffect } from 'react'

/**
 * SwipeableRow — T141
 *
 * WHY T140 STILL FAILED:
 *   The card div had `zIndex: 1` and `will-change: transform`, which promotes
 *   it to its own GPU compositing layer. Composited layers always render above
 *   non-composited siblings regardless of CSS z-index or DOM position. So the
 *   action panel — a regular positioned div with no compositing — was always
 *   painted under the card layer, even after the card slid away.
 *
 * THE FIX:
 *   Animate BOTH the card and the panel. Each has its own ref and its own
 *   transform. As the card slides left by X px, the panel slides left by the
 *   same X px (starting from REVEAL_W off-screen). They move in lockstep.
 *   The panel lives inside its own overflow:hidden clip container so it never
 *   bleeds outside its 144px column. No z-index needed anywhere.
 *
 *   Card:  translateX(0)        → translateX(-REVEAL_W)
 *   Panel: translateX(+REVEAL_W) → translateX(0)
 *
 *   Both driven by the same value. Zero compositing conflicts.
 *
 * Gesture engine: CSS touch-action:pan-y + Pointer Events API (T140 logic kept).
 */

const REVEAL_W = 144
const SNAP_PX  = 60
const ANIM_MS  = 200

export default function SwipeableRow({
  children,
  onRemove,
  onHighlight,
  isHighlighted,
  isOpen,
  onOpen,
  onClose,
}) {
  const cardRef  = useRef(null)
  const panelRef = useRef(null)

  const active  = useRef(false)
  const intentH = useRef(false)
  const startX  = useRef(0)
  const startY  = useRef(0)
  const baseX   = useRef(0)

  // AUDIT-7 M2 (2026-07-10): sync BOTH directions so the visible row-actions
  // button on watchlist rows can open the panel programmatically — this was
  // close-only, which made an external open a silent no-op. Gesture paths
  // land on the same values, so swipes are unaffected.
  useEffect(() => {
    setX(isOpen ? -REVEAL_W : 0, true)
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Move card and panel in lockstep.
  // card:  translateX(x)            x in [-REVEAL_W, 0]
  // panel: translateX(REVEAL_W + x) starts off-screen right, ends at 0
  function setX(x, animated) {
    const t = animated ? `transform ${ANIM_MS}ms ease` : 'none'
    if (cardRef.current) {
      cardRef.current.style.transition = t
      cardRef.current.style.transform  = `translateX(${x}px)`
    }
    if (panelRef.current) {
      panelRef.current.style.transition = t
      panelRef.current.style.transform  = `translateX(${REVEAL_W + x}px)`
    }
  }

  // ── Pointer Events (same logic as T140) ────────────────────────

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    active.current  = true
    intentH.current = false
    startX.current  = e.clientX
    startY.current  = e.clientY
    baseX.current   = isOpen ? -REVEAL_W : 0
    setX(baseX.current, false)
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e) {
    if (!active.current) return
    const dx = e.clientX - startX.current
    const dy = e.clientY - startY.current
    if (!intentH.current) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      if (Math.abs(dy) > Math.abs(dx)) {
        active.current = false
        e.currentTarget.releasePointerCapture(e.pointerId)
        return
      }
      intentH.current = true
    }
    const clamped = Math.max(-REVEAL_W, Math.min(0, baseX.current + dx))
    setX(clamped, false)
  }

  function onPointerUp(e) {
    if (!active.current) return
    active.current = false
    if (!intentH.current) return
    const dx  = e.clientX - startX.current
    const eff = baseX.current + dx
    if (eff < -SNAP_PX) {
      setX(-REVEAL_W, true)
      onOpen()
    } else {
      setX(0, true)
      if (isOpen) onClose()
    }
  }

  function onPointerCancel() {
    if (!active.current) return
    active.current = false
    setX(isOpen ? -REVEAL_W : 0, true)
  }

  function onCardClick(e) {
    if (isOpen) {
      e.preventDefault()
      setX(0, true)
      onClose()
    }
  }

  return (
    <div
      style={{
        position: 'relative',
        borderRadius: 'var(--radius)',
        // Brass ring on the open card — shows which bill is active
        boxShadow: isOpen
          ? '0 0 0 1.5px rgba(184,151,90,0.6), 0 4px 24px rgba(0,0,0,0.4)'
          : 'none',
        transition: `box-shadow ${ANIM_MS}ms ease`,
      }}
    >
      {/* ── Panel clip container ──────────────────────────────────
          Fixed at right:0, width:REVEAL_W.
          overflow:hidden keeps the panel invisible until it slides in.
          No z-index needed — the card slides away, revealing this area. */}
      <div
        style={{
          position: 'absolute',
          right: 0, top: 0, bottom: 0,
          width: REVEAL_W,
          overflow: 'hidden',
          borderRadius: 'var(--radius)',
        }}
      >
        {/* Panel content — starts translateX(+REVEAL_W), slides to 0 */}
        <div
          ref={panelRef}
          style={{
            display: 'flex',
            height: '100%',
            transform: `translateX(${REVEAL_W}px)`,
            willChange: 'transform',
          }}
        >
          {/* Highlight — brass left half */}
          <button
            onClick={e => {
              e.stopPropagation()
              setX(0, true)
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

          {/* Remove — danger right half */}
          <button
            onClick={e => {
              e.stopPropagation()
              setX(0, true)
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
      </div>

      {/* ── Sliding card ─────────────────────────────────────────
          No z-index set — DOM order and compositing are not the enemy
          because the panel moves with the card (no static panel to hide behind). */}
      <div
        ref={cardRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={onCardClick}
        style={{
          position: 'relative',
          willChange: 'transform',
          touchAction: 'pan-y',
          userSelect: 'none',
          cursor: isOpen ? 'default' : 'grab',
        }}
      >
        {children}

        {/* Swipe affordance — left-edge brass sliver */}
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
