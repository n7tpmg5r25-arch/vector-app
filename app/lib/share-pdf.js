/**
 * Vector | WA — PDF share helper  (ER4 / F8, 2026-06-02)
 *
 * Lets a lobbyist hand a generated brief straight to the iOS/Android share
 * sheet — so a one-page bill or member brief can be texted/AirDropped to a
 * client or staffer from the hearing-room floor — and falls back to a normal
 * download anywhere the Web Share API can't attach files (desktop, older
 * browsers). The PDF generators are untouched: they now expose the finished
 * bytes as a Blob via an additive `output: 'blob'` option, and everything in
 * this file is pure delivery (no rendering, no layout).
 */

const PDF_TYPE = 'application/pdf'

/**
 * True when this device can share a PDF *file* through the share sheet.
 * Used to pick the button label: "Share PDF" on a capable phone, "Export PDF"
 * on desktop. SSR-safe (returns false when there's no navigator).
 */
export function canSharePdfFiles() {
  if (typeof navigator === 'undefined') return false
  if (typeof File === 'undefined' || typeof Blob === 'undefined') return false
  if (typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false
  try {
    const probe = new File([new Blob([''], { type: PDF_TYPE })], 'probe.pdf', { type: PDF_TYPE })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/**
 * Share a generated PDF blob via the share sheet, or download it as a fallback.
 *
 * @param {Blob} blob        the finished PDF bytes (from a generator's `output:'blob'`)
 * @param {string} filename  download / attachment filename
 * @param {{title?: string, text?: string}} [meta]  share-sheet title + message
 * @returns {Promise<'shared'|'cancelled'|'downloaded'>}
 */
export async function sharePdf(blob, filename, meta = {}) {
  const { title, text } = meta

  if (canSharePdfFiles()) {
    try {
      const file = new File([blob], filename, { type: PDF_TYPE })
      // Re-check with the real file — canShare can differ per payload.
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text })
        return 'shared'
      }
    } catch (err) {
      // User dismissed the sheet — respect that, don't also download.
      if (err && err.name === 'AbortError') return 'cancelled'
      // Any other failure (permission, unsupported) → fall through to download.
    }
  }

  downloadBlob(blob, filename)
  return 'downloaded'
}

function downloadBlob(blob, filename) {
  if (typeof document === 'undefined') return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
