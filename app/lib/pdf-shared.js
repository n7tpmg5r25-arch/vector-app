/**
 * Vector | WA — Shared PDF helpers
 *
 * Thread 32 — extracted from generate-pdf.js so two PDF generators can share
 * color, tier, and layout logic without forking the engine:
 *   - generate-pdf.js          → firm brief (Shorepine palette + multi-bill watchlist)
 *   - generate-public-pdf.js   → public bill brief (Vector | WA palette, single bill)
 *
 * jsPDF built-in fonts (Helvetica/Times/Courier) only support Windows-1252
 * characters. Do NOT introduce Unicode symbols (box-drawing, Greek, arrows)
 * into PDF text — use ASCII equivalents.
 *
 * Byte-equivalence contract: when called with the default palette
 * (SHOREPINE_PALETTE), every helper exported here MUST return values
 * identical to the legacy inline constants in generate-pdf.js. Any change
 * to the Shorepine palette must be paired with a fresh baseline diff.
 */

// ── Palettes ─────────────────────────────────────────────────────────
// Each palette is the same shape so helpers can switch via a `palette` arg.
// Color values are RGB tuples [r, g, b] for jsPDF set*Color() methods.

/**
 * Internal firm palette — Shorepine Government Relations v4.6.
 * Used by the watchlist Brief PDF and the client-portal briefing.
 *
 * Values mirror the legacy module-level constants in generate-pdf.js
 * (FOREST/TEAL/GOLD/GRAY/LGRAY/RED/MUTED). Do not change without a
 * fresh byte-equivalence baseline.
 */
export const SHOREPINE_PALETTE = {
  primary:              [26, 74, 46],     // Forest        #1a4a2e
  primaryMid:           [45, 107, 69],    // Forest Mid    #2d6b45 (legacy TEAL)
  accent:               [184, 151, 90],   // Brass         #b8975a (legacy GOLD)
  neutral:              [74, 80, 96],     // Slate         #4a5060 (legacy GRAY)
  neutralLt:            [220, 212, 196],  // Parchment edge (legacy LGRAY)
  surface:              [245, 240, 230],  // Parchment surface
  white:                [255, 255, 255],
  danger:               [196, 71, 48],    // Ember         #c44730 (legacy RED)
  muted:                [138, 128, 112],  // Stone         #8a8070 (legacy MUTED)
  // Score-tier specific colors (returned by getScoreColor)
  tierHigh:             [45, 107, 69],    // Forest Mid (legacy TEAL)
  tierMod:              [58, 122, 138],   // Deep Teal (legacy inline)
  tierLow:              [184, 151, 90],   // Brass (legacy GOLD)
  tierVlow:             [138, 128, 112],  // Stone (legacy MUTED)
  // Outcome-specific colors (returned by getOutcomeColor)
  outcomeLaw:           [45, 107, 69],    // Forest Mid (legacy TEAL)
  outcomePassedChamber: [184, 151, 90],   // Brass (legacy GOLD)
  outcomeDead:          [138, 128, 112],  // Stone (legacy inline)
  displayFont:          'times',
}

/**
 * Public Vector | WA palette — directive D1 (no Shorepine on public surfaces).
 * Dark Neutral, Card, Brass, Brass-Lt only. No Forest. No Cormorant.
 *
 * jsPDF built-in fonts can only render Helvetica/Times/Courier without a
 * runtime VFS font load. Karla is the Vector | WA web typeface but loading it
 * into jsPDF would inflate the bundle and require an async vfs install. The
 * public PDF therefore renders Helvetica everywhere (closest sans-serif
 * substitute available natively) — explicit Karla parity is a non-goal.
 */
export const VECTOR_PUBLIC_PALETTE = {
  primary:              [14, 16, 20],     // Dark Neutral  #0e1014
  primaryMid:           [23, 25, 33],     // Card          #171921
  accent:               [184, 151, 90],   // Brass         #b8975a
  neutral:              [70, 75, 85],     // text-muted analog
  neutralLt:            [200, 195, 185],  // Light divider analog
  surface:              [248, 246, 242],  // Off-white print surface
  white:                [255, 255, 255],
  danger:               [196, 71, 48],    // Ember (universal warning red)
  muted:                [138, 128, 112],  // Stone
  // Tier colors — brass-forward, no green semantics.
  tierHigh:             [184, 151, 90],   // Brass — strong
  tierMod:              [212, 180, 122],  // Brass-Lt — moderate
  tierLow:              [138, 128, 112],  // Stone — low
  tierVlow:             [90, 88, 82],     // Dim stone — very low
  outcomeLaw:           [184, 151, 90],
  outcomePassedChamber: [212, 180, 122],
  outcomeDead:          [138, 128, 112],
  displayFont:          'helvetica',
}

// ── Score-tier thresholds (must match ScoreBadge in the live UI) ─────
// Kept here so both PDF generators agree with the on-page chip cluster.

export const TIER_HIGH     = 75
export const TIER_MODERATE = 60
export const TIER_LOW      = 45

// ── Stage labels (index = stage number from DB) ──────────────────────
export const STAGE_LABELS = ['', 'Introduced', 'Committee', 'Passed Committee', 'Passed Floor', 'Conference', 'Signed into Law']

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Resolve the score color for a tier. Defaults to SHOREPINE_PALETTE so
 * existing call sites in generate-pdf.js stay byte-equivalent.
 */
export function getScoreColor(score, palette = SHOREPINE_PALETTE) {
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
 * for active bills. Defaults to SHOREPINE_PALETTE for byte-equivalence.
 */
export function getOutcomeColor(bill, palette = SHOREPINE_PALETTE) {
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')             return palette.outcomeLaw
  if (cl === 'PASSED_CHAMBER')  return palette.outcomePassedChamber
  if (cl === 'DEAD')            return palette.outcomeDead
  return getScoreColor(bill.final_score || 0, palette)
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
