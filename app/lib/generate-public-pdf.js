/**
 * Vector | WA — Public Bill Brief PDF Generator
 *
 * Thread 32 — anon-visible single-bill 2-page take-it-to-the-hearing PDF.
 * Content per PUBLIC_SITE_REVIEW_2026-04-27.md Issue 2 (12 sections, missing
 * gracefully omitted).
 *
 * Vector | WA palette per Brand Guide v1.2 §02 — Brass / Dark Neutral / Card /
 * Stone over an off-white print surface. Helvetica throughout (jsPDF can't
 * render Playfair Display without a runtime VFS load).
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
import {
  formatSessionDate,
  isInterimPeriod,
  getCurrentBiennium,
  getNextBiennium,
  getSessionCutoffs,
  daysUntil,
} from './session-config'
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

// Party indicator colors — match the bill detail page's prime-sponsor dot.
const PARTY_COLOR = {
  D: [77, 154, 255],
  R: [239, 68, 68],
  I: [138, 128, 112],
  L: [138, 128, 112],
}

// Sponsor-tier copy (matches bill page line 2330)
const SPONSOR_TIER_LABEL = { 1: 'Leadership', 2: 'Senior', 3: 'Member' }

/**
 * Fetch an SVG, apply hex-color swaps in the source text, then rasterize to
 * a base64 PNG via canvas. Used to repaint the primary logo's wordmark from
 * the parchment '#ebeae4' (designed for dark backgrounds) to dark Vector
 * primary so it's legible on the white PDF page. Returns null on any failure
 * — caller handles the text fallback.
 */
async function loadSvgWithFillSwap(url, swaps) {
  try {
    const resp = await fetch(url)
    if (!resp.ok) return null
    let svg = await resp.text()
    Object.keys(swaps).forEach(from => {
      // case-insensitive global replace, preserves quotes
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

// ── Display helpers ─────────────────────────────────────────────

function billLabel(bill) {
  const prefix = bill.chamber === 'House' ? 'HB' : 'SB'
  return prefix + ' ' + (bill.bill_number || '')
}

/** Parse an AI summary into structured {heading, body} sections.
 *
 *  Source summaries from Claude follow a consistent pattern: ALL-CAPS phrases
 *  (e.g. "EXECUTIVE SUMMARY", "WHO IS AFFECTED", "KEY PROVISIONS") act as
 *  section headers, with paragraph bodies underneath. The earlier flat
 *  cleanSummary() collapsed those into one wall of text. This structured
 *  version preserves the hierarchy so drawAISummary can render headings
 *  bolded with paragraph spacing.
 *
 *  Markdown ## headers and ** bold markers are stripped; ALL-CAPS phrases
 *  of 4–40 chars are detected as headings.
 */
function structureSummary(raw) {
  if (!raw) return []
  const lines = String(raw)
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim())
    .filter(line => line.length > 0)

  const sections = []
  let curHeading = null
  let curBody    = []
  const flush = () => {
    if (curHeading || curBody.length > 0) {
      sections.push({
        heading: curHeading,
        body: curBody.join(' ').replace(/\s{2,}/g, ' ').trim(),
      })
    }
  }
  for (const line of lines) {
    const isHeading = line.length >= 4 && line.length <= 40 &&
      /^[A-Z][A-Z0-9 \-/&]{3,}$/.test(line)
    if (isHeading) {
      flush()
      curHeading = line
      curBody = []
    } else {
      curBody.push(line)
    }
  }
  flush()
  return sections.filter(s => s.heading || s.body)
}

/** Compose the interim/session context strip that sits under the logo. */
function getSessionContextLine() {
  const interim  = isInterimPeriod()
  const biennium = getCurrentBiennium()
  if (interim) {
    const next = getNextBiennium()
    const ended = formatSessionDate(biennium.end)
    const safeEnded = (ended && ended !== 'session dates TBD') ? ended : null
    const parts = []
    if (safeEnded) parts.push('Session ended ' + safeEnded)
    parts.push('Outcomes final')
    if (next.start) {
      const startLbl = formatSessionDate(next.start)
      const days = daysUntil(next.start)
      if (startLbl && startLbl !== 'session dates TBD') {
        parts.push('Next session ' + startLbl + (days > 0 ? ' (' + days + ' days)' : ''))
      }
    }
    return parts.join('  ·  ')
  }
  // Active session
  let dayOfSession = null
  try {
    const start = new Date(biennium.start)
    const now   = new Date()
    dayOfSession = Math.ceil((now - start) / 86400000) + 1
  } catch (e) {}
  const cutoffs = getSessionCutoffs().filter(c => !c.passed).slice(0, 1)
  const parts = []
  if (dayOfSession) parts.push('Day ' + dayOfSession + ' of session')
  if (cutoffs.length > 0) {
    const c = cutoffs[0]
    parts.push(c.label + ': ' + formatSessionDate(c.date) + ' (' + c.daysLeft + ' days)')
  }
  return parts.join('  ·  ')
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
  // browsers rasterize SVGs through <img> + canvas, no extra deps.
  // SVG aspect ratio 895/500 = 1.79. Bumped from 14mm to 22mm so the
  // wordmark below the gold arc is legible (Thread 32 first-preview fix).
  const logoH = 22
  const logoW = logoH * (895 / 500)  // ~39.4mm

  let logoDrawn = false
  try {
    // Repaint the wordmark fill from parchment (#ebeae4) to Vector primary
    // (#0e1014) so it's readable on the white PDF page. Gold arc + separator
    // (#b8975a) stay untouched.
    const dataUrl = await loadSvgWithFillSwap('/logos/vector-wa-primary.svg', {
      '#ebeae4': '#0e1014',
    })
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
    doc.setFontSize(18)
    doc.setTextColor(...P.primary)
    doc.text('VECTOR | WA', m, y + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text('WASHINGTON STATE LEGISLATIVE INTELLIGENCE', m, y + 18)
  }

  // Right side: domain + generated timestamp
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...P.accent)
  doc.text(VECTOR_DOMAIN, pw - m, y + 6, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.muted)
  const stamp = generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' · ' + generatedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  doc.text('Generated ' + stamp, pw - m, y + 11, { align: 'right' })

  // Session context strip — interim or active-session aware
  const ctxLine = getSessionContextLine()
  if (ctxLine) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text(ctxLine, pw - m, y + 16.5, { align: 'right' })
  }

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

  // Meta row: category · session · sponsor (with optional party dot trailing)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...P.muted)
  const metaParts = []
  if (bill.category) metaParts.push(bill.category)
  if (bill.session)  metaParts.push(bill.session)
  if (bill.prime_sponsor) metaParts.push('Sponsor: ' + bill.prime_sponsor)
  const metaLine = metaParts.join('  ·  ')
  doc.text(metaLine, m, cy + 1)

  // Optional party dot — bill.prime_party is the canonical column on the
  // bills row (carries 'D'/'R'/'I'). Drawn just after the sponsor name.
  const partyChar = (bill.prime_party || '').charAt(0).toUpperCase()
  if (bill.prime_sponsor && PARTY_COLOR[partyChar]) {
    const fullW = doc.getTextWidth(metaLine)
    doc.setFillColor(...PARTY_COLOR[partyChar])
    doc.circle(m + fullW + 2.4, cy - 0.3, 1.1, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...PARTY_COLOR[partyChar])
    doc.text('(' + partyChar + ')', m + fullW + 4, cy + 1)
  }

  return cy + 5
}

/**
 * Section 3 — Status pill: current stage + most recent action date.
 */
function drawStatusPill(doc, y, m, contentW, bill) {
  const stageLine = getStagePlainText(bill)
  const dateLbl   = getRecentActionDate(bill)
  const cl = (bill.confidence_label || '').toUpperCase()
  const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'
  const interim    = isInterimPeriod()

  // Build the right-side detail string differently per state:
  //  - Terminal bills: append the action date so the lobbyist sees WHEN the
  //    outcome landed ("Signed into law · Mar 12, 2026"). Thread 32 add A.
  //  - Active during session: append hearing date or cutoff days when known.
  //  - Active during interim: append the recent-action date if we have one.
  let text = stageLine
  if (isTerminal) {
    if (dateLbl) text = stageLine + '  ·  ' + dateLbl
  } else {
    const tail = []
    if (!interim) {
      if (bill.hearing_date) {
        try {
          const h = new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          tail.push('Hearing ' + h)
        } catch (e) {}
      } else if (bill.days_to_cutoff != null && bill.days_to_cutoff > 0) {
        tail.push(bill.days_to_cutoff + ' days to cutoff')
      }
    } else if (dateLbl) {
      tail.push(dateLbl)
    }
    if (tail.length) text = stageLine + '  ·  ' + tail.join('  ·  ')
  }

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

  // Compacted from 28mm to 18mm in the Thread 32 lobbyist redesign — the
  // earlier box was visually heavy for the content it carried.
  const boxH = 18
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.roundedRect(m, y, contentW, boxH, 2, 2, 'FD')

  // Left strip: score number + /100 + tier label, all on the left third
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...color)
  const scoreW = doc.getTextWidth(String(score))
  doc.text(String(score), m + 6, y + 12)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...P.muted)
  doc.text('/100', m + 6 + scoreW + 1, y + 12)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...color)
  doc.text(String(tier).toUpperCase(), m + 6, y + 16)

  // Right side: label + one-liner
  const txtX = m + 30
  const txtW = contentW - 30 - 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('TRAJECTORY SCORE', txtX, y + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(oneLiner, txtW).slice(0, 2)
  lines.forEach((line, i) => doc.text(line, txtX, y + 10 + i * 4))

  return y + boxH + 4
}

/**
 * NEW Section — Bill timeline. Walks the snapshots history (which carries
 * `stage` + `created_at` per row) and captures the FIRST appearance of each
 * stage as the date the bill moved into that stage. Renders as a horizontal
 * arrow flow ("Introduced Jan 14 -> Out of committee Feb 3 -> ...").
 *
 * Snapshot data may not stretch back to the bill's introduction (Vector
 * didn't always exist) so the earliest stage shown reflects the earliest
 * snapshot we have, not necessarily a true first-day-of-bill record.
 */
function buildBillTimeline(snapshots) {
  if (!snapshots || snapshots.length === 0) return []
  const sorted = [...snapshots].sort((a, b) => {
    const da = new Date(a.created_at || a.snapshot_date || 0).getTime()
    const db = new Date(b.created_at || b.snapshot_date || 0).getTime()
    return da - db
  })
  const STAGE_NAMES = {
    1: 'Introduced',
    2: 'In committee',
    3: 'Out of committee',
    4: 'Passed floor',
    5: 'Sent to other chamber',
    6: 'Signed into law',
  }
  const events = []
  const seen = new Set()
  sorted.forEach(snap => {
    const s = snap.stage
    if (s != null && !seen.has(s) && STAGE_NAMES[s]) {
      seen.add(s)
      const d = snap.created_at || snap.snapshot_date
      if (d) events.push({ label: STAGE_NAMES[s], date: d, stage: s })
    }
  })
  return events
}

function drawBillTimeline(doc, y, m, contentW, snapshots, ph) {
  const events = buildBillTimeline(snapshots)
  if (events.length < 2) return y  // Not worth a section with only one event

  y = checkPageBreak(doc, y, 12, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('BILL TIMELINE', m, y)

  // Build the flow string: "Label MMM DD  ->  Label MMM DD  ->  ..."
  const parts = events.map(e => {
    let dateLbl = ''
    try {
      dateLbl = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    } catch (err) {}
    return e.label + (dateLbl ? ' ' + dateLbl : '')
  })
  const flowText = parts.join('  >  ')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(flowText, contentW)
  let cy = y + 4
  lines.forEach(line => {
    cy = checkPageBreak(doc, cy, 4, ph)
    doc.text(line, m, cy + 1)
    cy += 4.2
  })
  return cy + 3
}

/**
 * NEW Section — "What the bill does." Plain-English summary from the bill's
 * AI-generated (or operator-edited) summary column. Truncated to ~5 lines so
 * it stays compact. Skipped entirely when no summary exists.
 *
 * Brand §14/§17 — AI-generated content must be labeled. We carry that label
 * forward from the firm brief.
 */
function drawAISummary(doc, y, m, contentW, bill, ph) {
  const sections = structureSummary(bill.custom_summary || bill.ai_summary || '')
  if (sections.length === 0) return y

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  // Measure header width AT 7pt before switching font sizes (same width-at-
  // wrong-size trap that caused the /100 overlap in the first preview)
  const headerW = doc.getTextWidth('WHAT THE BILL DOES')
  doc.text('WHAT THE BILL DOES', m, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(...P.accent)
  const aiLabel = bill.custom_summary ? 'AI-GENERATED · EDITED' : 'AI-GENERATED'
  doc.text(aiLabel, m + headerW + 4, y)

  let cy = y + 4

  sections.forEach((section, idx) => {
    // Subheading (when present) — bolded, brass, slightly larger than body
    if (section.heading) {
      cy = checkPageBreak(doc, cy, 5, ph)
      // Add a small gap above subheadings (except the very first)
      if (idx > 0) cy += 1
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...P.accent)
      doc.text(section.heading, m, cy + 2.5)
      cy += 4.5
    }
    // Body paragraph
    if (section.body) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8.5)
      doc.setTextColor(...P.primary)
      const bodyLines = doc.splitTextToSize(section.body, contentW)
      bodyLines.forEach(line => {
        cy = checkPageBreak(doc, cy, 4, ph)
        doc.text(line, m, cy + 1)
        cy += 4
      })
      cy += 1.5  // small gap after each section's body
    }
  })

  return cy + 2
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
  const cardH = 22

  // ── Left card — Sponsor ────────────────────────────────────────
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, colW, cardH, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('PRIME SPONSOR', m + 4, y + 5)

  // Name (bold) + party-letter in colored parens
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...P.primary)
  const nameTxt = bill.prime_sponsor || '—'
  doc.text(nameTxt, m + 4, y + 10.5)
  const nameW = doc.getTextWidth(nameTxt)
  const partyChar = (bill.prime_party || '').charAt(0).toUpperCase()
  if (PARTY_COLOR[partyChar]) {
    doc.setFontSize(9)
    doc.setTextColor(...PARTY_COLOR[partyChar])
    doc.text(' (' + partyChar + ')', m + 4 + nameW, y + 10.5)
  }

  // Chamber + sponsor tier
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.muted)
  const tierLbl = SPONSOR_TIER_LABEL[bill.sponsor_tier]
  const sponsorMeta = [bill.chamber || '', tierLbl].filter(Boolean).join('  ·  ')
  if (sponsorMeta) doc.text(sponsorMeta, m + 4, y + 14.5)

  // Cosponsor count + bipartisan flag
  const cosponsorN = bill.cosponsor_count || 0
  const sponsorFoot = []
  if (cosponsorN > 0) sponsorFoot.push(cosponsorN + ' cosponsor' + (cosponsorN !== 1 ? 's' : ''))
  if (bill.bipartisan) sponsorFoot.push('Bipartisan')
  else if (cosponsorN > 0) sponsorFoot.push('Single party')
  if (sponsorFoot.length) doc.text(sponsorFoot.join('  ·  '), m + 4, y + 18.5)

  // ── Right card — Committee ─────────────────────────────────────
  const rightX = m + colW + 6
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.roundedRect(rightX, y, colW, cardH, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('COMMITTEE', rightX + 4, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...P.primary)
  const cmteTxt = bill.committee_name || 'No committee assigned'
  doc.text(doc.splitTextToSize(cmteTxt, colW - 8)[0] || cmteTxt, rightX + 4, y + 10.5)

  // Sponsor-is-chair indicator (when applicable)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  if (bill.is_committee_chair) {
    doc.setTextColor(...P.accent)
    doc.text('Sponsor is committee chair', rightX + 4, y + 14.5)
  } else if (bill.chair_alignment) {
    doc.setTextColor(...P.muted)
    doc.text('Chair alignment: ' + bill.chair_alignment, rightX + 4, y + 14.5)
  }

  // Hearing date
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.muted)
  let hearingTxt = 'No hearing scheduled'
  if (bill.hearing_date) {
    try { hearingTxt = 'Hearing ' + new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) } catch (e) {}
  }
  doc.text(hearingTxt, rightX + 4, y + 18.5)

  return y + cardH + 4
}

/**
 * Section 8 — Floor votes (multi-chamber). Shows the latest vote per chamber
 * (House and Senate) when both exist, so a 2-chamber bill gets the full
 * cross-chamber story instead of just the most recent half.
 *
 * Accepts `rollCalls` array (page-level state) + `partyBucketsByRcId` map.
 * Falls back to `recentRollCall` + `partyBuckets` when only the singular
 * inputs are provided (backwards-compat with the consumer).
 */
function drawFloorVotes(doc, y, m, contentW, rollCalls, partyBucketsByRcId, fallbackSingle, fallbackBuckets, ph) {
  // Build a per-chamber latest-vote map. If the array is missing, fall back
  // to a single recentRollCall (legacy contract).
  let votes = []
  if (Array.isArray(rollCalls) && rollCalls.length > 0) {
    const byChamber = {}
    rollCalls.forEach(rc => {
      const ch = rc.chamber || 'Unknown'
      const prev = byChamber[ch]
      const newer = !prev || (rc.vote_date && (!prev.vote_date || rc.vote_date > prev.vote_date))
      if (newer) byChamber[ch] = rc
    })
    // Stable order: House, Senate, then anything else
    if (byChamber.House)  votes.push(byChamber.House)
    if (byChamber.Senate) votes.push(byChamber.Senate)
    Object.keys(byChamber).forEach(k => {
      if (k !== 'House' && k !== 'Senate') votes.push(byChamber[k])
    })
  } else if (fallbackSingle) {
    votes = [fallbackSingle]
  }
  if (votes.length === 0) return y

  y = checkPageBreak(doc, y, 6 + votes.length * 14, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text(votes.length > 1 ? 'FLOOR VOTES' : 'LATEST FLOOR VOTE', m, y)
  let cy = y + 4

  votes.forEach(rc => {
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
    if (dateLbl === 'session dates TBD') dateLbl = ''
    doc.text((rc.chamber || '') + (dateLbl ? '  ·  ' + dateLbl : ''), m + 4, cy + 4.5)

    // Tally
    const passed = (rc.result || '').toLowerCase() === 'passed'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...(passed ? P.accent : P.danger))
    const tally = (rc.yeas || 0) + ' yea  /  ' + (rc.nays || 0) + ' nay'
    doc.text(tally, m + 4, cy + 9.5)

    // Verdict (right-aligned)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text(passed ? 'Passed' : 'Failed', m + contentW - 4, cy + 9.5, { align: 'right' })

    // Party split — top-right of card
    const pb = (partyBucketsByRcId && rc.id && partyBucketsByRcId[rc.id]) || (rollCalls === null && fallbackBuckets) || null
    if (pb) {
      const parts = []
      if ((pb.yesD || 0) + (pb.noD || 0) > 0) parts.push('D ' + (pb.yesD || 0) + '-' + (pb.noD || 0))
      if ((pb.yesR || 0) + (pb.noR || 0) > 0) parts.push('R ' + (pb.yesR || 0) + '-' + (pb.noR || 0))
      if (parts.length > 0) {
        doc.setFontSize(7)
        doc.text(parts.join('  ·  '), m + contentW - 4, cy + 4.5, { align: 'right' })
      }
    }

    cy += 14
  })

  return cy + 1
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
 * NEW Section — Political dynamics one-liner. Combines bipartisan_index,
 * chair_alignment, sponsor_track_record, cross_aisle_count into a single
 * sentence. Mirrors the on-page Political Dynamics block (page.js:1829).
 * Returns y unchanged when none of the columns are populated.
 */
function drawPoliticalDynamics(doc, y, m, contentW, bill, ph) {
  const parts = []
  if (bill.bipartisan_index != null) {
    const pct = Math.round(Number(bill.bipartisan_index) * 100)
    parts.push(pct + '% bipartisan support')
  } else if (bill.cross_aisle_count > 0) {
    parts.push(bill.cross_aisle_count + ' opposing-party cosponsor' + (bill.cross_aisle_count !== 1 ? 's' : ''))
  }
  if (bill.chair_alignment) {
    parts.push('Chair alignment: ' + bill.chair_alignment)
  }
  if (bill.sponsor_track_record != null) {
    const pct = Math.round(Number(bill.sponsor_track_record) * 100)
    parts.push("Sponsor's historical pass rate: " + pct + '%')
  }
  if (parts.length === 0) return y
  y = checkPageBreak(doc, y, 8, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('POLITICAL DYNAMICS', m, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  // Wrap if longer than one line
  const sentence = parts.join('  ·  ')
  const wrapped = doc.splitTextToSize(sentence, contentW).slice(0, 2)
  let cy = y + 4
  wrapped.forEach(line => {
    doc.text(line, m, cy)
    cy += 4
  })
  return cy + 2
}

/**
 * NEW Section — What to Watch. Active-session only (skipped for terminal
 * bills and during interim). Bullets the imminent dates a lobbyist needs:
 * next hearing, days to cutoff, calendar pressure for the assigned committee.
 */
function drawWhatToWatch(doc, y, m, contentW, bill, ph) {
  const cl = (bill.confidence_label || '').toUpperCase()
  const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'
  if (isTerminal || isInterimPeriod()) return y

  const items = []
  if (bill.hearing_date) {
    try {
      const h = new Date(bill.hearing_date)
      const days = Math.ceil((h - new Date()) / 86400000)
      const lbl = h.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      items.push('Next hearing: ' + lbl + (days > 0 ? ' (' + days + ' days)' : ''))
    } catch (e) {}
  }
  if (bill.days_to_cutoff != null && bill.days_to_cutoff > 0 && bill.days_to_cutoff <= 21) {
    items.push('Cutoff in ' + bill.days_to_cutoff + ' day' + (bill.days_to_cutoff !== 1 ? 's' : ''))
  }
  if (bill.calendar_pressure != null && bill.calendar_pressure >= 20) {
    items.push(bill.calendar_pressure + ' agenda items competing this week')
  }
  if (items.length === 0) return y

  y = checkPageBreak(doc, y, 6 + items.length * 4.5, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('WHAT TO WATCH', m, y)
  let cy = y + 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  items.forEach(item => {
    doc.text('· ' + item, m, cy + 3)
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
 * @param {Array}  [input.rollCalls]         Full roll-calls array; PDF picks
 *                                           the latest per chamber.
 * @param {Object} [input.partyBucketsByRcId] Map id -> {yesD,yesR,noD,noR,...}.
 * @param {Object} [input.recentRollCall]    Legacy single-vote shortcut;
 *                                           overridden by rollCalls when set.
 * @param {Object} [input.partyBuckets]      Legacy single-bucket companion
 *                                           to recentRollCall.
 * @param {Array}  [input.recentAmendments]  Last 3-5 amendments.
 * @param {Object} [input.companion]         Reserved for future companion data.
 * @param {Object} [input.fiscalNote]        Reserved for richer fiscal data.
 * @param {Date}   [input.generatedAt]       Render timestamp; defaults to now.
 * @returns {Promise<string>} Filename of the saved PDF.
 */
export async function generatePublicBriefPDF({
  bill,
  scoreFeatures = [],
  rollCalls = null,
  partyBucketsByRcId = null,
  recentRollCall = null,
  partyBuckets = null,
  recentAmendments = [],
  snapshots = null,        // Thread 32 add B — fed to drawBillTimeline
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

  // Section 1 — Header band (async; rasterizes the official SVG logo +
  // appends the interim/session context strip)
  y = await drawHeaderBand(doc, y, m, contentW, pw, generatedAt)

  // Section 2 — Bill identity strip (with party dot when available)
  y = drawIdentityStrip(doc, y, m, contentW, bill)

  // Section 3 — Status pill (interim/session aware for active bills)
  y = drawStatusPill(doc, y, m, contentW, bill)

  // Section 4 — Trajectory score box
  y = drawScoreBox(doc, y, m, contentW, bill)

  // NEW Section (Thread 32 add B) — Bill timeline. Walks snapshot stage
  // history. Skipped silently when fewer than 2 stage transitions are known.
  y = drawBillTimeline(doc, y, m, contentW, snapshots, ph)

  // NEW Section — What the bill does (AI summary, biggest content fix from
  // Thread 32 first-preview lobbyist review)
  y = drawAISummary(doc, y, m, contentW, bill, ph)

  // Section 5 — Top X-Factors strip
  y = drawXFactorStrip(doc, y, m, contentW, scoreFeatures)

  // Section 6+7 — Sponsor + Committee mini-cards (party, tier, bipartisan,
  // chair indicator, hearing date)
  y = drawSponsorAndCommittee(doc, y, m, contentW, bill)

  // Section 8 — Floor votes (multi-chamber when available)
  y = drawFloorVotes(doc, y, m, contentW, rollCalls, partyBucketsByRcId, recentRollCall, partyBuckets, ph)

  // NEW Section — Political dynamics one-liner
  y = drawPoliticalDynamics(doc, y, m, contentW, bill, ph)

  // Section 9 — Recent amendments (if any)
  y = drawRecentAmendments(doc, y, m, contentW, recentAmendments, ph)

  // Section 10 — Companion bill (if any)
  y = drawCompanion(doc, y, m, contentW, bill, ph)

  // Section 11 — Fiscal note (if available)
  y = drawFiscalNote(doc, y, m, contentW, fiscalNote, bill, ph)

  // NEW Section — What to watch (active bills during session only)
  y = drawWhatToWatch(doc, y, m, contentW, bill, ph)

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
