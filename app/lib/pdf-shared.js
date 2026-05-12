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
  primary:              [14, 16, 20],     // Dark Neutral  #0e1014 — text on white
  primaryMid:           [23, 25, 33],     // Card          #171921 — secondary text / accent panel
  accent:               [184, 151, 90],   // Brass         #b8975a — primary accent
  neutral:              [70, 75, 85],     // text-muted analog
  neutralLt:            [200, 195, 185],  // Light divider analog
  surface:              [248, 246, 242],  // Off-white print surface (card background on paper)
  white:                [255, 255, 255],
  danger:               [196, 71, 48],    // Rust          #c44730 — universal warning
  muted:                [138, 128, 112],  // Stone         #8a8070 — tertiary / metadata
  // Tier colors — brass-forward, brand v1.2.
  tierHigh:             [184, 151, 90],   // Brass — strong
  tierMod:              [212, 180, 122],  // Brass-Lt — moderate
  tierLow:              [138, 128, 112],  // Stone — low
  tierVlow:             [90, 88, 82],     // Dim stone — very low
  outcomeLaw:           [184, 151, 90],   // Brass
  outcomePassedChamber: [212, 180, 122],  // Brass-Lt
  outcomeDead:          [138, 128, 112],  // Stone
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
