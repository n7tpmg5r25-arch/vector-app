'use client'
import { useEffect, useId, useRef, useState } from 'react'

/**
 * Vector | WA — DropdownMenu (Thread 34).
 *
 * Custom replacement for browser-native <select> across the app. The native
 * dropdown is the single most "feels AI-coded" tell on the public site —
 * one component fixes every instance.
 *
 * Behavior parity with <select>:
 *   - Controlled value + onChange (onChange receives the option's `value`).
 *   - Keyboard: ↓/↑ to navigate, Enter to select, Esc to close, Tab to dismiss.
 *   - Click outside to close.
 *   - aria-expanded + role=combobox on trigger; role=listbox on panel; role=option
 *     + aria-selected on each option.
 *
 * Style override is passthrough — most call sites have a bespoke trigger look
 * (rounded pill on home, brass-tinted on session picker, plain card on search).
 * `triggerStyle` and `menuStyle` let the caller match the existing visual
 * footprint without forcing a single design token onto every site.
 *
 * Caller contract:
 *   <DropdownMenu
 *     value={chamber}
 *     onChange={setChamber}
 *     options={[{ value: 'All', label: 'All' }, …]}
 *     ariaLabel="Chamber filter"
 *     triggerStyle={{ ... }}   // optional overrides for trigger button
 *     menuStyle={{ ... }}      // optional overrides for the panel
 *     width={…}                // optional fixed trigger width
 *   />
 *
 * Mobile-only by design (480-px column). Trigger height defaults to 32px
 * but caller padding can lift it; a global minHeight of 32 keeps it tappable
 * on dense filter rows. For full-width form fields (settings digestDay), the
 * caller should pass `triggerStyle={{ minHeight: 44, width: '100%' }}`.
 */
export default function DropdownMenu({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  width,
  triggerStyle,
  menuStyle,
  optionRender,
  disabled = false,
}) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const wrapRef = useRef(null)
  const triggerRef = useRef(null)
  const listRef = useRef(null)
  const listboxId = useId()

  const selected = options.find(o => String(o.value) === String(value))
  const displayLabel = selected ? selected.label : (placeholder || '')

  // Outside-click + Escape close.
  useEffect(() => {
    if (!open) return
    function onDown(e) {
      if (!wrapRef.current) return
      if (!wrapRef.current.contains(e.target)) {
        setOpen(false)
        setActiveIdx(-1)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Sync activeIdx to selected when opening.
  useEffect(() => {
    if (open) {
      const idx = options.findIndex(o => String(o.value) === String(value))
      setActiveIdx(idx >= 0 ? idx : 0)
    }
  }, [open, options, value])

  // Scroll active option into view.
  useEffect(() => {
    if (!open || activeIdx < 0 || !listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIdx}"]`)
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' })
    }
  }, [open, activeIdx])

  function commit(idx) {
    const opt = options[idx]
    if (!opt) return
    if (String(opt.value) !== String(value)) onChange(opt.value)
    setOpen(false)
    setActiveIdx(-1)
    // Restore focus to trigger so Tab continues naturally.
    if (triggerRef.current) triggerRef.current.focus()
  }

  function onTriggerKeyDown(e) {
    if (disabled) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
      } else if (e.key === 'Enter' || e.key === ' ') {
        commit(activeIdx)
      } else if (e.key === 'ArrowDown') {
        setActiveIdx(i => Math.min(options.length - 1, (i < 0 ? 0 : i + 1)))
      } else if (e.key === 'ArrowUp') {
        setActiveIdx(i => Math.max(0, (i < 0 ? options.length - 1 : i - 1)))
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault()
        setOpen(false)
        setActiveIdx(-1)
      }
    } else if (e.key === 'Tab') {
      // Let Tab dismiss the menu; default focus shift handles the rest.
      if (open) setOpen(false)
    } else if (e.key === 'Home') {
      if (open) { e.preventDefault(); setActiveIdx(0) }
    } else if (e.key === 'End') {
      if (open) { e.preventDefault(); setActiveIdx(options.length - 1) }
    }
  }

  // Default trigger styling — matches the /search filter selects (the most
  // common shape). Callers can override via triggerStyle.
  const baseTrigger = {
    minHeight: 32,
    padding: '6px 28px 6px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    fontSize: 12,
    color: 'var(--text-mid)',
    cursor: disabled ? 'default' : 'pointer',
    outline: 'none',
    textAlign: 'left',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
    fontFamily: 'inherit',
    position: 'relative',
    flexShrink: 0,
    width: width || 'auto',
    whiteSpace: 'nowrap',
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
  }

  const baseMenu = {
    position: 'absolute',
    top: 'calc(100% + 4px)',
    left: 0,
    minWidth: '100%',
    maxHeight: 280,
    overflowY: 'auto',
    background: 'var(--bg-card-2, var(--bg-card))',
    border: '1px solid var(--border-light, var(--border))',
    borderRadius: 8,
    padding: 4,
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
    zIndex: 100,
    listStyle: 'none',
    margin: 0,
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', display: 'inline-block', width: width || 'auto' }}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        aria-disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        onKeyDown={onTriggerKeyDown}
        style={{ ...baseTrigger, ...(triggerStyle || {}) }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayLabel}</span>
        <svg
          width="10" height="6" viewBox="0 0 10 6" fill="none"
          style={{
            position: 'absolute', right: 10, top: '50%',
            transform: open ? 'translateY(-50%) rotate(180deg)' : 'translateY(-50%)',
            transition: 'transform 0.15s ease',
            pointerEvents: 'none',
          }}
          aria-hidden="true"
        >
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          tabIndex={-1}
          style={{ ...baseMenu, ...(menuStyle || {}) }}
        >
          {options.map((opt, idx) => {
            const isSelected = String(opt.value) === String(value)
            const isActive = idx === activeIdx
            return (
              <li
                key={`${opt.value}__${idx}`}
                data-idx={idx}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={e => { e.preventDefault(); commit(idx) }}
                style={{
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: 13,
                  color: isSelected ? 'var(--teal)' : 'var(--text-primary)',
                  background: isActive ? 'rgba(184,151,90,0.10)' : 'transparent',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: isSelected ? 600 : 400,
                  minHeight: 36,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span>{optionRender ? optionRender(opt) : opt.label}</span>
                {isSelected && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
