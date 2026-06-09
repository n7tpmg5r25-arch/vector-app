/**
 * Vector | WA — export acknowledgment gate.
 *
 * A small confirm shown before any PDF export: the person exporting
 * acknowledges they are responsible for verifying the accuracy of the
 * information before relying on it or sharing it. Returns a Promise<boolean>
 * (true = proceed, false = cancelled).
 *
 * Implemented as plain DOM rather than a React component so every export
 * button gets the gate with a single guard line at the top of its handler
 * (`if (!(await confirmExport())) return`) — no per-page state, ref, or JSX.
 * Styled with the app's brand tokens (with literal fallbacks) so it matches
 * the rest of the UI. SSR-safe: resolves true when there is no document,
 * though it is only ever called from a click handler.
 */
const ACK_TITLE = 'Before you export'
const ACK_BODY =
  'This brief is generated from public legislative data and predictive modeling. ' +
  'You are responsible for verifying the accuracy of the information against the ' +
  'official record before relying on it or sharing it.'

export function confirmExport(opts = {}) {
  const title = opts.title || ACK_TITLE
  const body = opts.body || ACK_BODY
  const confirmLabel = opts.confirmLabel || 'I understand — export'
  const cancelLabel = opts.cancelLabel || 'Cancel'

  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(true); return }

    const prevActive = document.activeElement
    let done = false

    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'presentation')
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '3000',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', background: 'rgba(8,9,11,0.66)',
      backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
    })

    const card = document.createElement('div')
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-modal', 'true')
    card.setAttribute('aria-label', title)
    Object.assign(card.style, {
      width: '100%', maxWidth: '360px', boxSizing: 'border-box',
      background: 'var(--bg-card, #171921)', color: 'var(--text-primary, #e8e9ec)',
      border: '1px solid var(--border, #2a2d38)', borderRadius: '14px',
      padding: '18px 18px 16px', boxShadow: '0 18px 50px rgba(0,0,0,0.5)',
      fontFamily: 'var(--font-body, system-ui, sans-serif)',
    })

    const h = document.createElement('div')
    h.textContent = title
    Object.assign(h.style, {
      fontFamily: 'var(--font-display, Georgia, serif)', fontWeight: '700',
      fontSize: '18px', lineHeight: '1.2', marginBottom: '8px',
    })

    const p = document.createElement('div')
    p.textContent = body
    Object.assign(p.style, {
      fontSize: '13px', lineHeight: '1.5',
      color: 'var(--text-mid, #a8acb4)', marginBottom: '16px',
    })

    const row = document.createElement('div')
    Object.assign(row.style, { display: 'flex', gap: '10px', justifyContent: 'flex-end' })

    const makeBtn = (label, primary) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      Object.assign(b.style, {
        minHeight: '44px', padding: '0 16px', borderRadius: '8px',
        fontFamily: 'var(--font-body, system-ui, sans-serif)', fontSize: '13px', fontWeight: '600',
        cursor: 'pointer',
        border: primary ? '1px solid var(--brass, #b8975a)' : '1px solid var(--border, #2a2d38)',
        background: primary ? 'var(--brass, #b8975a)' : 'transparent',
        color: primary ? 'var(--bg, #0e1014)' : 'var(--text-mid, #a8acb4)',
      })
      return b
    }
    const cancelBtn = makeBtn(cancelLabel, false)
    const okBtn = makeBtn(confirmLabel, true)

    const cleanup = (result) => {
      if (done) return
      done = true
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      try { if (prevActive && prevActive.focus) prevActive.focus() } catch (e) {}
      resolve(result)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cleanup(false) }
    }

    cancelBtn.addEventListener('click', () => cleanup(false))
    okBtn.addEventListener('click', () => cleanup(true))
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) cleanup(false) })
    document.addEventListener('keydown', onKey, true)

    row.appendChild(cancelBtn)
    row.appendChild(okBtn)
    card.appendChild(h)
    card.appendChild(p)
    card.appendChild(row)
    overlay.appendChild(card)
    document.body.appendChild(overlay)
    try { okBtn.focus() } catch (e) {}
  })
}
