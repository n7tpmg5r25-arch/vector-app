/**
 * Vector | WA — Team portal palette + type tokens
 *
 * Used by:
 *   - app/app/c/[slug]/page.js               (Team portal index)
 *   - app/app/c/[slug]/bill/[id]/page.js     (Team bill briefing)
 *   - app/app/c/[slug]/DownloadBriefingButton.js
 *
 * The portal renders inside the standard Vector | WA app shell (Dark Neutral
 * page background, Brass accents) per Brand Guide v1.2 §02. These tokens
 * exist as a thin JS module rather than CSS vars because the portal cards
 * are styled inline and want to reference exact hex values without fighting
 * the global :root variables.
 *
 * Replaces the legacy firm-side palette module in Thread 44 (2026-04-30) when
 * Brand v1.2 adopted Vector | WA as the only brand. Hex values now match the
 * v1.2 primary palette exactly — there is no separate firm-side surface.
 *
 * See: BRAND_COMPLIANCE_PLAN.md § Thread 44, Brand Guide v1.2 §02.
 */

export const PORTAL = {
  // ── v1.2 Vector | WA primary palette ─────────────────────────────────
  bg:              '#0e1014',  // Dark Neutral — page background (also globals.css --bg)
  card:            '#171921',  // Card — primary surface for the portal card (--bg-card)
  cardElevated:    '#1c1f28',  // Slightly elevated card — header band, inset bill cards (--bg-card-2)

  // ── Accents ──────────────────────────────────────────────────────────
  brass:           '#b8975a',  // Brass — primary accent (also --brass / legacy --teal)
  brassLight:      '#d4b47a',  // Brass Light — bright accent (also --brass-light / legacy --gold)

  // ── Text on dark ─────────────────────────────────────────────────────
  textPrimary:     '#e8e9ec',  // Cream — primary text (--text-primary)
  textMid:         '#a8acb4',  // Text Mid — secondary text (--text-mid)
  textMuted:       '#6c7078',  // Text Muted — tertiary / metadata (--text-muted)

  // ── Borders + dividers ───────────────────────────────────────────────
  border:          '#2a2d38',  // Border — dividers between cards (--border)
  borderLight:     '#343845',  // Subtle dividers (--border-light)

  // ── Functional accents (semantic, per v1.2 §02) ──────────────────────
  danger:          '#c44730',  // Rust — warning / divergence accent (--danger)
}

// Three-voice typography per Brand Guide v1.2 §02.
// Playfair Display + Karla + DM Mono are loaded globally in app/app/globals.css —
// this module just names them so portal inline styles stay self-documenting.
export const FONT_DISPLAY = "'Playfair Display', Georgia, serif"
export const FONT_BODY    = "'Karla', system-ui, sans-serif"
export const FONT_MONO    = "'DM Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
