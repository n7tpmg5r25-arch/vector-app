/**
 * Vector | WA — Shared PDF helpers
 *
 * Thread 32 — extracted from generate-pdf.js so two PDF generators can share
 * color, tier, and layout logic without forking the engine:
 *   - generate-pdf.js          → firm brief (multi-bill watchlist / team brief)
 *   - generate-public-pdf.js   → public bill brief (single bill take-it-to-the-hearing)
 *
 * Thread 44 (2026-04-30): Brand v1.2 unified both surfaces under a single
 * Vector | WA palette + Playfair Display / Helvetica type. The previous
 * firm-side palette is gone; both PDF outputs render in the same v1.2 brand.
 *
 * jsPDF built-in fonts (Helvetica/Times/Courier) only support Windows-1252
 * characters. Do NOT introduce Unicode symbols (box-drawing, Greek, arrows)
 * into PDF text — use ASCII equivalents.
 */

// ── Palette ──────────────────────────────────────────────────────────
// Single shared palette as of Thread 44. Values match Brand Guide v1.2 §02.
// Color values are RGB tuples [r, g, b] for jsPDF set*Color() methods.

/**
 * Vector | WA palette — Brand Guide v1.2 §02. Used by both PDF generators.
 *
 * Note on print surfaces: PDFs render on white paper. The Vector | WA
 * web/UI palette is dark-on-dark (Dark Neutral background, Cream text);
 * for print the same hexes are inverted in role — Dark Neutral is now
 * the TEXT color, off-white is the SURFACE (card background) color.
 *
 * jsPDF built-in fonts can only render Helvetica/Times/Courier without a
 * runtime VFS font load. Playfair Display + Karla are the Vector | WA
 * typefaces but loading them into jsPDF would inflate the bundle and
 * require an async vfs install. The PDFs therefore render Helvetica
 * everywhere (closest sans-serif available natively).
 */
export const VECTOR_PALETTE = {
  // Thread B (2026-06-09): PDF exports are fully neutral - black/gray/white only.
  // No brass, no brand accent. Tier + outcome colors differ by gray value.
  primary:              [0, 0, 0],        // Black - primary text
  primaryMid:           [38, 38, 38],     // Near-black - secondary text
  accent:               [82, 82, 82],     // Mid-gray - section labels / rules (was brass)
  neutral:              [90, 90, 90],     // Gray - muted body analog
  neutralLt:            [201, 201, 201],  // Light gray - dividers
  surface:              [245, 245, 245],  // Off-white print surface
  white:                [255, 255, 255],
  danger:               [55, 55, 55],     // Dark gray - warning (was rust)
  muted:                [110, 110, 110],  // Gray - metadata
  // Tier colors - grayscale ramp, darkest = strongest signal.
  tierHigh:             [20, 20, 20],     // Near-black - strong
  tierMod:              [80, 80, 80],     // Mid-gray - moderate
  tierLow:              [130, 130, 130],  // Gray - low
  tierVlow:             [175, 175, 175],  // Light gray - very low
  outcomeLaw:           [20, 20, 20],     // Near-black
  outcomePassedChamber: [80, 80, 80],     // Mid-gray
  outcomeDead:          [130, 130, 130],  // Gray
  displayFont:          'helvetica',
}

// Backwards-compat alias for generate-public-pdf.js (no behavioral change).
// A future thread can collapse this once the import is updated.
export const VECTOR_PUBLIC_PALETTE = VECTOR_PALETTE

// ── Score-tier thresholds (must match ScoreBadge in the live UI) ─────
// Kept here so both PDF generators agree with the on-page chip cluster.

export const TIER_HIGH     = 75
export const TIER_MODERATE = 60
export const TIER_LOW      = 45

// ── Stage labels (index = stage number from DB) ──────────────────────
export const STAGE_LABELS = ['', 'Introduced', 'Committee', 'Passed Committee', 'Passed Floor', 'Conference', 'Signed into Law']

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the score color for a tier. Defaults to VECTOR_PALETTE.
 */
export function getScoreColor(score, palette = VECTOR_PALETTE) {
  if (score >= TIER_HIGH)     return palette.tierHigh
  if (score >= TIER_MODERATE) return palette.tierMod
  if (score >= TIER_LOW)      return palette.tierLow
  return palette.tierVlow
}

/**
 * Plain-English tier label. Palette-agnostic.
 */
export function getScoreTierLabel(score) {
  if (score >= TIER_HIGH)     return 'HIGH'
  if (score >= TIER_MODERATE) return 'MODERATE'
  if (score >= TIER_LOW)      return 'LOW'
  return 'VERY LOW'
}

/**
 * Card border / accent color based on bill outcome. Falls back to score color
 * for active bills. Defaults to VECTOR_PALETTE.
 */
export function getOutcomeColor(bill, palette = VECTOR_PALETTE) {
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')             return palette.outcomeLaw
  if (cl === 'PASSED_CHAMBER')  return palette.outcomePassedChamber
  if (cl === 'DEAD')            return palette.outcomeDead
  return getScoreColor(bill.final_score || 0, palette)
}

/**
 * Fetch an SVG, apply hex-color swaps in the source text, then rasterize to
 * a base64 PNG via canvas. Shared by both PDF generators so the Vector | WA
 * primary logo renders consistently across the watchlist brief and the public
 * single-bill brief.
 *
 * Primary use: repaint the logo wordmark from parchment (#ebeae4, designed
 * for dark backgrounds) to Dark Neutral (#0e1014) so it reads on the white
 * PDF page. Gold arc + separator (#b8975a) stay untouched.
 * Returns null on any failure — callers render a text fallback.
 */
export async function loadSvgWithFillSwap(url, swaps) {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    let svg = await resp.text()
    Object.keys(swaps).forEach(from => {
      const re = new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
      svg = svg.replace(re, swaps[from])
    })
    const dataUrl = 'data:image/svg+xml;base64,' +
      btoa(unescape(encodeURIComponent(svg)))
    return await new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width  = img.naturalWidth  || 895
        canvas.height = img.naturalHeight || 500
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      }
      img.onerror = () => resolve(null)
      img.src = dataUrl
    })
  } catch (e) {
    return null
  }
}

/**
 * Load an image (logo, etc.) from a URL as a base64 data URL. Returns null
 * on failure so callers can render a vector fallback. Palette-agnostic.
 */
export function loadImageAsBase64(url) {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
}

/**
 * If `needed` mm of vertical space don't fit on the current page, add a new
 * page and return the reset y (top margin on continuation pages). Otherwise
 * return the y unchanged.
 *
 * Reserves 30mm for the methodology + footer area on the last page so those
 * blocks can pin to the bottom without collision. Palette-agnostic.
 */
export function checkPageBreak(doc, y, needed, ph) {
  const footerReserve = 30
  if (y + needed > ph - footerReserve) {
    doc.addPage()
    return 28
  }
  return y
}
