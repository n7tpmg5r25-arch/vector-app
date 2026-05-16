'use client'
import { useRef, useEffect } from 'react'

/**
 * SwipeableRow — Thread 102
 * Wraps a bill card with left-swipe reveal behavior.
 * Reveals a 144px action panel: "Highlight" (brass, left) + "Remove" (danger, right).
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
  const PANEL_WIDTH = 144

  const cardRef       = useRef(null)
  const touchStartX   = useRef(0)
  const touchStartY   = useRef(0)
  const currentDeltaX = useRef(0)
  const intentLocked  = useRef(null) // 'horizontal' | 'vertical' | null
  const swipingRef    = useRef(false)

  // When parent flips isOpen → false, snap card back
  useEffect(() => {
    if (!isOpen && cardRef.current) {
      cardRef.current.style.transition = 'transform 0.2s ease'
      cardRef.current.style.transform  = 'translateX(0)'
    }
  }, [isOpen])

  const handleTouchStart = (e) => {
    touchStartX.current   = e.touches[0].clientX
    touchStartY.current   = e.touches[0].clientY
    currentDeltaX.current = 0
    intentLocked.current  = null
    swipingRef.current    = false
    if (cardRef.current) cardRef.current.style.transition = 'none'
  }

  const handleTouchMove = (e) => {
    const deltaX = e.touches[0].clientX - touchStartX.current
    const deltaY = e.touches[0].clientY - touchStartY.current

    // Lock intent on first meaningful movement
    if (!intentLocked.current) {
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 5) {
        intentLocked.current = 'horizontal'
      } else if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 5) {
        intentLocked.current = 'vertical'
      }
    }

    if (intentLocked.current !== 'horizontal') return

    // Ignore right-swipe when card is already closed
    if (deltaX > 0 && !isOpen) return

    e.preventDefault() // prevent page scroll only after horizontal intent confirmed
    swipingRef.current    = true
    currentDeltaX.current = deltaX

    const base    = isOpen ? -PANEL_WIDTH : 0
    const clamped = Math.min(0, Math.max(-PANEL_WIDTH, base + deltaX))
    if (cardRef.current) cardRef.current.style.transform = `translateX(${clamped}px)`
  }

  const handleTouchEnd = () => {
    if (intentLocked.current !== 'horizontal') return

    if (cardRef.current) cardRef.current.style.transition = 'transform 0.2s ease'

    const base      = isOpen ? -PANEL_WIDTH : 0
    const effective = base + currentDeltaX.current

    if (effective < -60) {
      // Snap open
      if (cardRef.current) cardRef.current.style.transform = `translateX(-${PANEL_WIDTH}px)`
      onOpen()
    } else {
      // Snap closed
      if (cardRef.current) cardRef.current.style.transform = 'translateX(0)'
      if (isOpen) onClose()
    }
  }

  const handleCardClick = (e) => {
    // If swiped open, tapping card body closes it (no navigation)
    if (isOpen) {
      e.preventDefault()
      if (cardRef.current) {
        cardRef.current.style.transition = 'transform 0.2s ease'
        cardRef.current.style.transform  = 'translateX(0)'
      }
      onClose()
      return
    }
    // If a swipe just finished (but didn't reach open threshold), block nav
    if (swipingRef.current) {
      e.preventDefault()
    }
  }

  return (
    <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius)' }}>
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
          onClick={(e) => { e.stopPropagation(); onHighlight() }}
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
          onClick={(e) => { e.stopPropagation(); onRemove() }}
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
        onClick={handleCardClick}
        style={{ position: 'relative', zIndex: 1, willChange: 'transform' }}
      >
        {children}
      </div>
    </div>
  )
}
