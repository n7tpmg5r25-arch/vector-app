'use client'
import { useRef, useEffect } from 'react'

/**
 * SwipeableRow — Thread 102 · T136
 * Wraps a bill card with left-swipe reveal behavior.
 * Reveals a 144px action panel: "Highlight" (brass, left) + "Remove" (danger, right).
 *
 * T136 fixes:
 *   1. Snap-back: action callbacks delayed 220ms via setTimeout so the
 *      0.2s CSS transition finishes before React state fires. Previously
 *      onRemove() unmounted the card mid-animation; onHighlight() caused a
 *      re-render that raced the imperative transform.
 *   2. Mouse drag: onMouseDown/Move/Up/Leave added for desktop support.
 *   3. Swipe indicator: subtle brass «« affordance on card right edge.
 *
 * Props:
 *   children       — card content
 *   onRemove()     — called when Remove is tapped
 *   onHighlight()  — called when Highlight is tapped
 *   isHighlighted  — boolean, drives active state of Highlight button
 *   isOpen         — boolean, parent-controlled: whether this row is swiped open
 *   onOpen()       — tell parent this row is opening (parent closes others)
 *   onClose()      — tell parent to close this row (sets openSwipeId → null)
 */
export default function SwipeableRow({
  children,
  onRemove,
  onHighlight,
  isHighlighted,
  isOpen,
  onOpen,
  onClose,
}) {
  const PANEL_WIDTH   = 144
  const ANIM_DURATION = 220 // ms — matches '0.2s ease' CSS transition

  const cardRef       = useRef(null)
  const touchStartX   = useRef(0)
  const touchStartY   = useRef(0)
  const currentDeltaX = useRef(0)
  const intentLocked  = useRef(null) // 'horizontal' | 'vertical' | null
  const swipingRef    = useRef(false)
  const isDragging    = useRef(false)

  // ── Helpers ─────────────────────────────────────────────────
  function snapBack() {
    if (!cardRef.current) return
    cardRef.current.style.transition = `transform ${ANIM_DURATION}ms ease`
    cardRef.current.style.transform  = 'translateX(0)'
  }

  function snapOpen() {
    if (!cardRef.current) return
    cardRef.current.style.transition = `transform ${ANIM_DURATION}ms ease`
    cardRef.current.style.transform  = `translateX(-${PANEL_WIDTH}px)`
  }

  function disableTransition() {
    if (!cardRef.current) return
    cardRef.current.style.transition = 'none'
  }

  // When parent flips isOpen → false, snap card back
  useEffect(() => {
    if (!isOpen) snapBack()
  }, [isOpen])

  // ── Shared drag logic ────────────────────────────────────────
  function startDrag(clientX, clientY) {
    touchStartX.current   = clientX
    touchStartY.current   = clientY
    currentDeltaX.current = 0
    intentLocked.current  = null
    swipingRef.current    = false
    disableTransition()
  }

  function moveDrag(clientX, clientY, isTouch, nativeEvent) {
    const deltaX = clientX - touchStartX.current
    const deltaY = clientY - touchStartY.current

    if (!intentLocked.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) {
        intentLocked.current = 'horizontal'
      } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5) {
        intentLocked.current = 'vertical'
      }
    }

    if (intentLocked.current !== 'horizontal') return
    if (deltaX > 0 && !isOpen) return

    // Prevent page scroll on touch only after horizontal intent confirmed
    if (isTouch && nativeEvent) nativeEvent.preventDefault()
    swipingRef.current    = true
    currentDeltaX.current = deltaX

    const base    = isOpen ? -PANEL_WIDTH : 0
    const clamped = Math.min(0, Math.max(-PANEL_WIDTH, base + deltaX))
    if (cardRef.current) cardRef.current.style.transform = `translateX(${clamped}px)`
  }

  function endDrag() {
    if (intentLocked.current !== 'horizontal') return

    const base      = isOpen ? -PANEL_WIDTH : 0
    const effective = base + currentDeltaX.current

    if (effective < -60) {
      snapOpen()
      onOpen()
    } else {
      snapBack()
      if (isOpen) onClose()
    }
  }

  // ── Touch handlers ───────────────────────────────────────────
  const handleTouchStart = (e) => startDrag(e.touches[0].clientX, e.touches[0].clientY)
  const handleTouchMove  = (e) => moveDrag(e.touches[0].clientX, e.touches[0].clientY, true, e)
  const handleTouchEnd   = ()  => endDrag()

  // ── Mouse handlers (desktop) ─────────────────────────────────
  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    isDragging.current = true
    startDrag(e.clientX, e.clientY)
  }

  const handleMouseMove = (e) => {
    if (!isDragging.current) return
    moveDrag(e.clientX, e.clientY, false, null)
  }

  const handleMouseUp = () => {
    if (!isDragging.current) return
    isDragging.current = false
    endDrag()
  }

  // Also end drag if mouse leaves the wrapper
  const handleMouseLeave = () => {
    if (!isDragging.current) return
    isDragging.current = false
    endDrag()
  }

  // ── Card click (tap to close when open) ──────────────────────
  const handleCardClick = (e) => {
    if (isOpen) {
      e.preventDefault()
      snapBack()
      onClose()
      return
    }
    if (swipingRef.current) e.preventDefault()
  }

  return (
    <div
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius)' }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* ── Action panel (sits behind card, revealed on right side) ── */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: PANEL_WIDTH,
          display: 'flex',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
        }}
      >
        {/* Highlight button — brass, left 72px */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            snapBack()
            onClose()
            // Delay state callback until snap animation finishes
            setTimeout(onHighlight, ANIM_DURATION)
          }}
          style={{
            flex: 1,
            background: 'var(--brass, #b8975a)',
            color: 'var(--bg, #0e1014)',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            fontWeight: 700,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            lineHeight: 1.2,
          }}
        >
          <span style={{ fontSize: 14 }}>{isHighlighted ? '●' : '+'}</span>
          <span>{isHighlighted ? 'In Report' : 'Highlight'}</span>
        </button>

        {/* Remove button — danger, right 72px */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            snapBack()
            onClose()
            // Delay remove until snap animation finishes (prevents mid-animation unmount)
            setTimeout(onRemove, ANIM_DURATION)
          }}
          style={{
            flex: 1,
            background: 'var(--danger, #c44730)',
            color: '#ffffff',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            fontFamily: 'var(--font-body)',
            fontWeight: 700,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 3,
            lineHeight: 1.2,
          }}
        >
          <span style={{ fontSize: 14 }}>✕</span>
          <span>Remove</span>
        </button>
      </div>

      {/* ── Card (slides left to reveal panel) ── */}
      <div
        ref={cardRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onClick={handleCardClick}
        style={{
          position: 'relative', zIndex: 1, willChange: 'transform',
          cursor: isDragging.current ? 'grabbing' : 'grab',
        }}
      >
        {/* ── Swipe affordance indicator ── */}
        {!isOpen && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 10,
              top: 0,
              bottom: 0,
              display: 'flex',
              alignItems: 'center',
              pointerEvents: 'none',
              zIndex: 2,
              gap: 0,
              opacity: 0.22,
            }}
          >
            {/* Two overlapping left-chevrons in brass */}
            <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden="true">
              <polyline points="8,1 2,7 8,13" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <svg width="10" height="14" viewBox="0 0 10 14" fill="none" aria-hidden="true" style={{ marginLeft: -3 }}>
              <polyline points="8,1 2,7 8,13" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
