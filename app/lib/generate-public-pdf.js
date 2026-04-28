/**
 * Vector | WA — Public Bill Brief PDF Generator
 *
 * Thread 32 — anon-visible single-bill 2-page take-it-to-the-hearing PDF.
 * Content per PUBLIC_SITE_REVIEW_2026-04-27.md Issue 2 (12 sections, missing
 * gracefully omitted).
 *
 * Vector | WA palette only — directive D1: zero Shorepine references on this
 * surface. Brass / Dark Neutral / Card / Stone. No Forest, no Cormorant.
 *
 * Consumer side: lazy-loaded via `await import('.../generate-public-pdf')`
 * from /bill/[id]/page.js — parity with the firm brief's lazy-load pattern.
 *
 * Persona: lobbyist Sam — print, fold, walk it down the hall to a hearing.
 * Read in 60 seconds, hand it to a chief of staff.
 *
 * jsPDF Helvetica only supports Windows-1252 characters. No box-drawing,
 * Greek, or arrows in PDF text. Up/down indicators on the X-Factor chips
 * are drawn via doc.triangle() — vector primitives, not glyphs.
 */

import jsPDF from 'jspdf'
import { formatSessionDate } from './session-config'
import {
  VECTOR_PUBLIC_PALETTE,
  TIER_HIGH, TIER_MODERATE, TIER_LOW,
  loadImageAsBase64,
  getScoreColor, getScoreTierLabel, getOutcomeColor,
  checkPageBreak,
} from './pdf-shared'
import { translateAmendmentEvent } from './wsl-amendment-codes'

// Shorthand — every helper call below uses the public palette.
const P = VECTOR_PUBLIC_PALETTE

// Footer URL string — built via concat so the chat autolink trap doesn't
// rewrite the literal during code review or copy/paste.
const VECTOR_DOMAIN = 'vectorwa' + '.' + 'com'
const VECTOR_BASE_URL = 'https://' + VECTOR_DOMAIN

// ── Display helpers ─────────────────────────────────────────────

function billLabel(bill) {
  const prefix = bill.chamber === 'House' ? 'HB' : 'SB'
  return prefix + ' ' + (bill.bill_number || '')
}

function getBillTitle(bill) {
  const title = (bill.title || '').trim()
  if (!title) return bill.committee_name || 'Bill ' + bill.bill_number
  return title
}

/** Plain-English current-stage line. Mirrors the firm brief's logic. */
function getStagePlainText(bill) {
  const s = bill.stage || 1
  const chamber = bill.chamber || 'House'
  const cmte = bill.committee_name || ''

  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')  return 'Signed into law'
  if (cl === 'DEAD') return 'Did not advance — session ended'
  if (cl === 'PASSED_CHAMBER') return 'Passed ' + chamber + ' — carries to next session'

  if (s >= 6) return 'Signed into law'
  if (s >= 4) return 'Passed ' + chamber + ' floor'
  if (s >= 3) return cmte ? 'Passed ' + cmte : 'Passed committee'
  return 'Introduced in ' + chamber
}

/** Human date for "most recent action" — empty string when unavailable.
 *  formatSessionDate() returns the literal "session dates TBD" on null/
 *  malformed input — guard against that leaking into the status pill. */
function getRecentActionDate(bill) {
  const raw = bill.last_action_date || bill.updated_at || null
  if (!raw) return ''
  try {
    const formatted = formatSessionDate(raw)
    if (!formatted || formatted === 'session dates TBD') return ''
    return formatted
  } catch (e) { return '' }
}

/** One-sentence plain-English read of the score for the trajectory box. */
function getScoreOneLiner(bill, score) {
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW') return 'Signed into law — outcome final.'
  if (cl === 'DEAD') return 'Did not advance — session ended without passage.'
  if (cl === 'PASSED_CHAMBER') return 'Passed its first chamber — carries into the next session.'

  if (score >= TIER_HIGH)     return 'Strong forward movement — historically, bills in this band become law ~84% of the time.'
  if (score >= TIER_MODERATE) return 'Moderate momentum — a viable path to passage with active committee work.'
  if (score >= TIER_LOW)      return 'Limited movement — needs a sponsor push or hearing to gain ground.'
  return 'Very limited momentum — most bills in this band do not advance this session.'
}

/** Title-case fiscal-note size if present. */
function fiscalSizeLabel(size) {
  if (!size) return null
  return String(size).charAt(0).toUpperCase() + String(size).slice(1)
}

/** Companion-state plain-English label. */
function companionStateLabel(state) {
  const m = {
    both_moving: 'Both moving',
    leading:     'Leading',
    trailing:    'Trailing',
    forked:      'Diverged',
    both_stuck:  'Both stuck',
  }
  return m[state] || null
}

// ── Section drawers ─────────────────────────────────────────────

/**
 * Section 1 — Header band: official Vector | WA wordmark logo (left),
 * vectorwa.com + generated timestamp (right). Async because the logo is
 * rasterized from /logos/vector-wa-primary.svg via canvas at runtime.
 *
 * Falls back to a plain-text wordmark if the logo fails to load (offline,
 * dev server quirk, etc.) — never blocks PDF generation.
 */
async function drawHeaderBand(doc, y, m, contentW, pw, generatedAt) {
  // Official primary SVG ships at app/public/logos/vector-wa-primary.svg —
  // browsers can rasterize SVGs through <img> + canvas, no extra deps.
  // SVG aspect ratio 895/500 = 1.79.
  const logoH = 14
  const logoW = logoH * (895 / 500)  // ~25.06mm

  let logoDrawn = false
  try {
    const dataUrl = await loadImageAsBase64('/logos/vector-wa-primary.svg')
    if (dataUrl) {
      doc.addImage(dataUrl, 'PNG', m, y - 1, logoW, logoH)
      logoDrawn = true
    }
  } catch (e) {
    // Swallow — fall through to text fallback below
  }

  if (!logoDrawn) {
    // Text fallback — only renders if the SVG couldn't load
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...P.primary)
    doc.text('VECTOR | WA', m, y + 8)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...P.muted)
    doc.text('WASHINGTON STATE LEGISLATIVE INTELLIGENCE', m, y + 12.5)
  }

  // Right side: domain + generated timestamp
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...P.accent)
  doc.text(VECTOR_DOMAIN, pw - m, y + 5, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  const stamp = generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' · ' + generatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  doc.text('Generated ' + stamp, pw - m, y + 9.5, { align: 'right' })

  // Thin separator under header
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, y + logoH + 1, pw - m, y + logoH + 1)

  return y + logoH + 5
}

/**
 * Section 2 — Bill identity strip: bill # · short title · category · session ·
 * prime sponsor (with party dot if available).
 */
function drawIdentityStrip(doc, y, m, contentW, bill) {
  // Bill number — bold, large
  doc.setFont('courier', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...P.primary)
  doc.text(billLabel(bill), m, y + 4)

  // Title (right of bill number, may wrap to 2 lines)
  const titleX = m + 28
  const titleW = contentW - 28
  const title = getBillTitle(bill)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...P.primary)
  const titleLines = doc.splitTextToSize(title, titleW).slice(0, 2)
  titleLines.forEach((line, i) => doc.text(line, titleX, y + 4 + i * 4.5))

  let cy = y + 4 + Math.max(titleLines.length, 1) * 4.5 + 1

  // Meta row: category · session · sponsor (with optional party dot)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...P.muted)
  const metaParts = []
  if (bill.category) metaParts.push(bill.category)
  if (bill.session)  metaParts.push(bill.session)
  if (bill.prime_sponsor) {
    // Party dot only renders if bill.prime_sponsor_party is populated.
    // Today the bill row doesn't carry sponsor party — graceful skip.
    metaParts.push('Sponsor: ' + bill.prime_sponsor)
  }
  doc.text(metaParts.join('  ·  '), m, cy + 1)

  // Optional party dot
  if (bill.prime_sponsor && bill.prime_sponsor_party) {
    const dotColor = bill.prime_sponsor_party === 'D' ? [77, 154, 255]
                   : bill.prime_sponsor_party === 'R' ? [255, 105, 97]
                   : [138, 128, 112]
    // Calculate where "Sponsor: NAME" sits to draw a dot to its right
    const sponsorTxt = 'Sponsor: ' + bill.prime_sponsor
    const fullW = doc.getTextWidth(metaParts.join('  ·  '))
    doc.setFillColor(...dotColor)
    doc.circle(m + fullW + 2, cy + 0.2, 1.1, 'F')
  }

  return cy + 5
}

/**
 * Section 3 — Status pill: current stage + most recent action date.
 */
function drawStatusPill(doc, y, m, contentW, bill) {
  const stageLine = getStagePlainText(bill)
  const dateLbl   = getRecentActionDate(bill)
  // Terminal bills (LAW/DEAD/PASSED_CHAMBER) have a complete stage sentence;
  // appending a date reads as repetitive. Active bills get the date suffix.
  const cl = (bill.confidence_label || '').toUpperCase()
  const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'
  const text = (isTerminal || !dateLbl) ? stageLine : stageLine + ' — ' + dateLbl

  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.roundedRect(m, y, contentW, 9, 1.5, 1.5, 'FD')

  doc.setFillColor(...P.accent)
  doc.rect(m, y, 2.5, 9, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  doc.text(text, m + 6, y + 5.8)

  return y + 13
}

/**
 * Section 4 — Trajectory score box: big number + tier label + 1-sentence read.
 */
function drawScoreBox(doc, y, m, contentW, bill) {
  const score = bill.final_score || 0
  const tier  = bill.confidence_label || getScoreTierLabel(score)
  const color = getOutcomeColor(bill, P)
  const oneLiner = getScoreOneLiner(bill, score)

  const boxH = 28
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.roundedRect(m, y, contentW, boxH, 2, 2, 'FD')

  // Left: big score. Measure width at the LARGE font size before switching
  // to the small one for the "/100" suffix — otherwise the suffix overlaps
  // the score graphic (caught in Thread 32 first preview).
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...color)
  const scoreW = doc.getTextWidth(String(score))
  doc.text(String(score), m + 6, y + 18)

  // Score "/100" suffix — small, muted, baseline-aligned with the big number
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...P.muted)
  doc.text('/100', m + 6 + scoreW + 1.5, y + 18)

  // Tier label below score
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...color)
  doc.text(String(tier).toUpperCase(), m + 6, y + 24)

  // Right: label + one-liner
  const txtX = m + 36
  const txtW = contentW - 36 - 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('TRAJECTORY SCORE', txtX, y + 7)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(oneLiner, txtW)
  lines.slice(0, 3).forEach((line, i) => doc.text(line, txtX, y + 13 + i * 4.2))

  return y + boxH + 5
}

/**
 * Section 5 — Top X-Factors strip: top 2 ▲ + top 2 ▼.
 * Renders triangles via doc.triangle() to avoid Unicode glyph dependency.
 * scoreFeatures = latestSnap.xf_factors, items shaped { l, d, pos }.
 */
function drawXFactorStrip(doc, y, m, contentW, scoreFeatures) {
  const positives = (scoreFeatures || []).filter(f => f.pos).sort((a, b) => b.d - a.d).slice(0, 2)
  const negatives = (scoreFeatures || []).filter(f => !f.pos).sort((a, b) => a.d - b.d).slice(0, 2)
  const top = [...positives, ...negatives]
  if (top.length < 2) return y  // Graceful omit when nothing to show

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('TOP X-FACTORS', m, y)
  let cy = y + 4

  // Two-column wrap, each row up to 2 chips
  const chipH = 6
  const chipPadY = 1.5
  const chipGap = 4
  const colW = (contentW - chipGap) / 2

  top.forEach((f, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const cx = m + col * (colW + chipGap)
    const cy2 = cy + row * (chipH + 2)

    const triColor = f.pos ? P.accent : P.danger
    const txtColor = f.pos ? P.accent : P.danger
    const bgColor  = f.pos ? [248, 244, 234] : [252, 240, 236]
    const borderColor = f.pos ? [200, 175, 120] : [220, 160, 145]

    // Chip background
    doc.setFillColor(...bgColor)
    doc.setDrawColor(...borderColor)
    doc.setLineWidth(0.2)
    doc.roundedRect(cx, cy2, colW, chipH, 1, 1, 'FD')

    // Triangle (up or down) — drawn 2.4mm tall
    const triX = cx + 3
    const triY = cy2 + chipH / 2
    doc.setFillColor(...triColor)
    if (f.pos) {
      doc.triangle(triX, triY - 1.4, triX + 2.4, triY + 1.2, triX - 2.4, triY + 1.2, 'F')
    } else {
      doc.triangle(triX, triY + 1.4, triX + 2.4, triY - 1.2, triX - 2.4, triY - 1.2, 'F')
    }

    // Label + delta
    const deltaPct = (f.d > 0 ? '+' : '') + Math.round(f.d * 100) + '%'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...txtColor)
    const labelTxt = (f.l || '') + '  ' + deltaPct
    // Truncate if needed to fit chip width (label may be long)
    let trimmed = labelTxt
    while (doc.getTextWidth(trimmed) > colW - 10 && trimmed.length > 12) {
      trimmed = trimmed.slice(0, -1)
    }
    if (trimmed !== labelTxt) trimmed = trimmed.slice(0, -1) + '…'
    doc.text(trimmed, triX + 4, cy2 + chipH / 2 + 1.4)
  })

  const rows = Math.ceil(top.length / 2)
  return cy + rows * (chipH + 2) + 4
}

/**
 * Section 6 — Sponsor + chamber detail (compact two-line block).
 * Section 7 — Committee + chair (chair name not on bill row today; graceful).
 * Both bundled into one pair of mini-cards side-by-side.
 */
function drawSponsorAndCommittee(doc, y, m, contentW, bill) {
  const colW = (contentW - 6) / 2

  // Left card — Sponsor
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, colW, 16, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('PRIME SPONSOR', m + 4, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...P.primary)
  doc.text(bill.prime_sponsor || '—', m + 4, y + 10)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.muted)
  doc.text(bill.chamber || '', m + 4, y + 14)

  // Right card — Committee
  const rightX = m + colW + 6
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.roundedRect(rightX, y, colW, 16, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('COMMITTEE', rightX + 4, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...P.primary)
  const cmteTxt = bill.committee_name || 'No committee assigned'
  doc.text(doc.splitTextToSize(cmteTxt, colW - 8)[0] || cmteTxt, rightX + 4, y + 10)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.muted)
  let footRight = ''
  if (bill.hearing_date) {
    try { footRight = 'Hearing ' + formatSessionDate(bill.hearing_date) } catch (e) { footRight = 'Hearing scheduled' }
  } else {
    footRight = 'No hearing scheduled'
  }
  doc.text(footRight, rightX + 4, y + 14)

  return y + 16 + 4
}

/**
 * Section 8 — Recent floor vote (if any).
 * Pass null/undefined to gracefully omit.
 */
function drawRecentVote(doc, y, m, contentW, recentRollCall, partyBuckets) {
  if (!recentRollCall) return y
  const rc = recentRollCall

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('LATEST FLOOR VOTE', m, y)
  let cy = y + 4

  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, cy, contentW, 12, 1.5, 1.5, 'FD')

  // Chamber + date
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...P.primary)
  let dateLbl = ''
  try { dateLbl = formatSessionDate(rc.vote_date) } catch (e) {}
  doc.text((rc.chamber || '') + ' · ' + dateLbl, m + 4, cy + 4.5)

  // Tally
  const passed = (rc.result || '').toLowerCase() === 'passed'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...(passed ? P.accent : P.danger))
  const tally = (rc.yeas || 0) + ' yea  /  ' + (rc.nays || 0) + ' nay'
  doc.text(tally, m + 4, cy + 9.5)

  // Verdict text
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.muted)
  const verdict = passed ? 'Passed' : 'Failed'
  doc.text(verdict, m + contentW - 4, cy + 9.5, { align: 'right' })

  // Party split if available
  if (partyBuckets) {
    const pb = partyBuckets
    const parts = []
    if (pb.yesD || pb.noD) parts.push('D ' + (pb.yesD || 0) + '-' + (pb.noD || 0))
    if (pb.yesR || pb.noR) parts.push('R ' + (pb.yesR || 0) + '-' + (pb.noR || 0))
    if (parts.length > 0) {
      doc.setFontSize(7)
      doc.text(parts.join('  ·  '), m + contentW - 4, cy + 4.5, { align: 'right' })
    }
  }

  return cy + 12 + 4
}

/**
 * Section 9 — Recent amendments (last 3, plain-English via wsl translator).
 * Pass empty array to gracefully omit.
 */
function drawRecentAmendments(doc, y, m, contentW, recentAmendments, ph) {
  const items = (recentAmendments || []).slice(0, 3)
  if (items.length === 0) return y

  y = checkPageBreak(doc, y, 6 + items.length * 5, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('RECENT AMENDMENTS', m, y)
  let cy = y + 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...P.primary)

  items.forEach(a => {
    const t = translateAmendmentEvent({
      amendmentNumber: a.amendment_number || a.amendmentNumber,
      sponsor:         a.sponsor,
      description:     a.description,
      adopted:         a.adopted,
      floorAction:     a.floor_action || a.floorAction,
    })
    const line = '· ' + (t.label || ('Amendment ' + (a.amendment_number || '')))
    const wrapped = doc.splitTextToSize(line, contentW).slice(0, 1)
    doc.text(wrapped[0], m, cy + 3)
    cy += 4.5
  })

  return cy + 3
}

/**
 * Section 10 — Companion bill one-liner (if any).
 */
function drawCompanion(doc, y, m, contentW, bill, ph) {
  if (!bill.companion_bill) return y
  y = checkPageBreak(doc, y, 8, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('COMPANION BILL', m, y)

  const stateLbl = companionStateLabel(bill.companion_state)
  const scoreLbl = bill.companion_score != null ? 'score ' + bill.companion_score : ''
  const parts = [bill.companion_bill]
  if (scoreLbl) parts.push(scoreLbl)
  if (stateLbl) parts.push(stateLbl)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  doc.text(parts.join('  ·  '), m, y + 5)
  return y + 9
}

/**
 * Section 11 — Fiscal note (if available).
 */
function drawFiscalNote(doc, y, m, contentW, fiscalNote, bill, ph) {
  // Prefer the fiscalNote object if passed; fall back to bill.fiscal_note_size.
  const size = fiscalNote ? (fiscalNote.size || fiscalNote.new_size) : bill.fiscal_note_size
  const updated = fiscalNote ? (fiscalNote.detected_date || fiscalNote.updated_at) : bill.fiscal_note_updated_at
  if (!size) return y

  y = checkPageBreak(doc, y, 8, ph)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('FISCAL NOTE', m, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  let line = fiscalSizeLabel(size)
  if (updated) {
    let dateStr = ''
    try { dateStr = formatSessionDate(updated) } catch (e) { dateStr = String(updated).slice(0, 10) }
    if (dateStr) line += '  ·  Updated ' + dateStr
  }
  doc.text(line, m, y + 5)
  return y + 9
}

/**
 * Section 12 — Footer (every page).
 * "Generated {date}. Always verify against vectorwa.com/bill/{id}.
 *  Not legal advice. Vector | WA — Washington State legislative intelligence."
 */
function drawFooter(doc, ph, m, pw, bill, generatedAt) {
  const fy = ph - 14
  doc.setDrawColor(...P.accent)
  doc.setLineWidth(0.4)
  doc.line(m, fy, pw - m, fy)

  const stamp = generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const verifyPath = '/bill/' + (bill.bill_id || bill.id || '')
  const line1 = 'Generated ' + stamp + ' · Always verify against ' + VECTOR_DOMAIN + verifyPath
  const line2 = 'Not legal advice · Vector | WA — Washington State legislative intelligence'

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text(line1, m, fy + 4)
  doc.text(line2, m, fy + 8)
}

// ── MAIN ────────────────────────────────────────────────────────

/**
 * Generate the public Vector | WA single-bill brief.
 * All non-bill inputs are optional and gracefully omitted when null/empty.
 *
 * @param {Object} input
 * @param {Object} input.bill                Bills row from Supabase.
 * @param {Array<{l,d,pos}>} [input.scoreFeatures]  latestSnap.xf_factors.
 * @param {Object} [input.recentRollCall]    Most recent floor vote row.
 * @param {Object} [input.partyBuckets]      Optional party split for the vote.
 * @param {Array}  [input.recentAmendments]  Last 3-5 amendments.
 * @param {Object} [input.companion]         Reserved for future companion data.
 * @param {Object} [input.fiscalNote]        Reserved for richer fiscal data.
 * @param {Date}   [input.generatedAt]       Render timestamp; defaults to now.
 * @returns {Promise<string>} Filename of the saved PDF.
 */
export async function generatePublicBriefPDF({
  bill,
  scoreFeatures = [],
  recentRollCall = null,
  partyBuckets = null,
  recentAmendments = [],
  companion = null,
  fiscalNote = null,
  generatedAt = new Date(),
} = {}) {
  if (!bill) throw new Error('generatePublicBriefPDF: bill is required')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const m = 18
  const contentW = pw - 2 * m
  let y = 16

  // Section 1 — Header band (async; rasterizes the official SVG logo)
  y = await drawHeaderBand(doc, y, m, contentW, pw, generatedAt)

  // Section 2 — Bill identity strip
  y = drawIdentityStrip(doc, y, m, contentW, bill)

  // Section 3 — Status pill
  y = drawStatusPill(doc, y, m, contentW, bill)

  // Section 4 — Trajectory score box
  y = drawScoreBox(doc, y, m, contentW, bill)

  // Section 5 — Top X-Factors strip
  y = drawXFactorStrip(doc, y, m, contentW, scoreFeatures)

  // Section 6+7 — Sponsor + Committee mini-cards
  y = drawSponsorAndCommittee(doc, y, m, contentW, bill)

  // Section 8 — Recent floor vote (if any)
  y = drawRecentVote(doc, y, m, contentW, recentRollCall, partyBuckets)

  // Section 9 — Recent amendments (if any)
  y = drawRecentAmendments(doc, y, m, contentW, recentAmendments, ph)

  // Section 10 — Companion bill (if any)
  y = drawCompanion(doc, y, m, contentW, bill, ph)

  // Section 11 — Fiscal note (if available)
  y = drawFiscalNote(doc, y, m, contentW, fiscalNote, bill, ph)

  // Section 12 — Footer on every page
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    drawFooter(doc, ph, m, pw, bill, generatedAt)
  }

  // Save with bill-specific filename
  const safeBill = ((bill.chamber === 'House' ? 'HB' : 'SB') + (bill.bill_number || '')).replace(/[^a-zA-Z0-9]/g, '_')
  const safeDate = generatedAt.toISOString().slice(0, 10).replace(/-/g, '')
  const filename = 'Vector_WA_' + safeBill + '_brief_' + safeDate + '.pdf'
  doc.save(filename)
  return filename
}
