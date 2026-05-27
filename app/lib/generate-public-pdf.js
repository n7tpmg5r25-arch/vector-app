/**
 * Vector | WA — Public Bill Brief PDF Generator
 *
 * T150 (2026-05-27): Full rewrite — lobbyist-first, one-page US letter.
 *
 * Audience: professional lobbyist who prints before a committee hearing and
 * reads in 45 seconds. C-suite executive who wants to know if the bill
 * matters, who's behind it, and what happens next.
 *
 * Information hierarchy (Tier 1 above the fold → Tier 3 supporting detail):
 *   Tier 1: Bill identity · Sponsor · Status · Trajectory score
 *   Tier 2: What the bill does (AI exec summary + who affected) · Committee
 *            · Top X-factors
 *   Tier 3: Floor vote (if voted) · Companion (if any) · Fiscal note (if any)
 *            · Stage timeline (only if 3+ transitions)
 *
 * CUT from previous version: full AI summary wall, bill timeline, political
 * dynamics one-liner, recent amendments list, "What to Watch" section.
 *
 * Style: mirrors generate-member-pdf.js gold standard (T147–T148).
 *   — VECTOR_PALETTE (P) throughout; no legacy aliases
 *   — drawSectionLabel() matches member PDF exactly
 *   — Font-before-wrapText discipline on every splitTextToSize call
 *   — US letter format (not A4)
 *   — logoH = 14 (consistent with member PDF)
 *   — loadSvgWithFillSwap from pdf-shared (not duplicated locally)
 *
 * jsPDF built-in fonts (Helvetica/Courier) only support Windows-1252.
 * No box-drawing, Greek, or arrow glyphs. Triangles drawn via doc.triangle().
 */

import jsPDF from 'jspdf'
import {
  formatSessionDate,
  isInterimPeriod,
  isPostBienniumClose,
  getCurrentBiennium,
  getNextBiennium,
  getSessionCutoffs,
} from './session-config'
import {
  VECTOR_PALETTE,
  TIER_HIGH, TIER_MODERATE, TIER_LOW,
  loadSvgWithFillSwap,
  getScoreColor, getScoreTierLabel, getOutcomeColor,
  checkPageBreak,
} from './pdf-shared'

// Canonical v1.2 palette alias — matches generate-member-pdf.js convention
const P = VECTOR_PALETTE

const VECTOR_DOMAIN = 'vectorwa' + '.' + 'com'

// Party dot colors — match bill detail page prime-sponsor dot
const PARTY_COLOR = {
  D: [77, 154, 255],
  R: [239, 68, 68],
  I: [138, 128, 112],
  L: [138, 128, 112],
}

// Sponsor-tier copy (matches bill page)
const SPONSOR_TIER_LABEL = { 1: 'Leadership', 2: 'Senior', 3: 'Member' }

// ── Pure helpers ─────────────────────────────────────────────────────────────

function billLabel(bill) {
  return (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + (bill.bill_number || '')
}

function getBillTitle(bill) {
  const t = (bill.title || '').trim()
  return t || (bill.committee_name || 'Bill ' + bill.bill_number)
}

/** Plain-English current-stage line. */
function getStagePlainText(bill) {
  const s  = bill.stage || 1
  const ch = bill.chamber || 'House'
  const cm = bill.committee_name || ''
  const cl = (bill.confidence_label || '').toUpperCase()

  if (cl === 'LAW')             return 'Signed into law'
  if (cl === 'DEAD')            return 'Did not advance — session ended'
  if (cl === 'PASSED_CHAMBER') {
    if (isPostBienniumClose()) {
      const next = getNextBiennium()?.session
      return next
        ? 'Passed ' + ch + ' — must be refiled in ' + next
        : 'Passed ' + ch + ' — must be refiled next biennium'
    }
    return 'Passed ' + ch + ' — carries to next session'
  }

  if (s >= 6) return 'Signed into law'
  if (s >= 4) return 'Passed ' + ch + ' floor'
  if (s >= 3) return cm ? 'Passed ' + cm : 'Passed committee'
  return 'Introduced in ' + ch
}

/** Human-readable date for the most recent action. */
function getRecentActionDate(bill) {
  const raw = bill.last_action_date || bill.updated_at || null
  if (!raw) return ''
  try {
    const formatted = formatSessionDate(raw)
    if (!formatted || formatted === 'session dates TBD') return ''
    return formatted
  } catch (e) { return '' }
}

/** One-sentence read of the score for the trajectory block. */
function getScoreOneLiner(bill, score) {
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')  return 'Signed into law — outcome final.'
  if (cl === 'DEAD') return 'Did not advance — session ended without passage.'
  if (cl === 'PASSED_CHAMBER') {
    if (isPostBienniumClose()) {
      const next = getNextBiennium()?.session
      const where = next ? 'in ' + next : 'next biennium'
      return 'Did not pass this biennium — must be refiled ' + where + ' to advance.'
    }
    return 'Passed its first chamber — carries into the next session.'
  }
  if (score >= TIER_HIGH)     return 'Strong forward movement — historically, bills in this band become law ~84% of the time.'
  if (score >= TIER_MODERATE) return 'Moderate momentum — a viable path to passage with active committee work.'
  if (score >= TIER_LOW)      return 'Limited movement — needs a sponsor push or hearing to gain ground.'
  return 'Very limited momentum — most bills in this band do not advance this session.'
}

/** Title-case fiscal-note size label. */
function fiscalSizeLabel(size) {
  if (!size) return null
  return String(size).charAt(0).toUpperCase() + String(size).slice(1)
}

/** Companion-state plain-English label. */
function companionStateLabel(state) {
  const m = {
    both_moving: 'Both moving', leading: 'Leading', trailing: 'Trailing',
    forked: 'Diverged', both_stuck: 'Both stuck',
  }
  return m[state] || null
}

/**
 * Build a compact session context line for the header right column.
 * Interim: "Session ended {date}  ·  Outcomes final  ·  Next session {date}"
 * Active:  "Day N of session  ·  {Cutoff label}: {date} (N days)"
 */
function getSessionContextLine() {
  const interim  = isInterimPeriod()
  const biennium = getCurrentBiennium()
  if (interim) {
    const next  = getNextBiennium()
    const ended = formatSessionDate(biennium.end)
    const parts = []
    if (ended && ended !== 'session dates TBD') parts.push('Session ended ' + ended)
    parts.push('Outcomes final')
    if (next.start) {
      const startLbl = formatSessionDate(next.start)
      if (startLbl && startLbl !== 'session dates TBD') parts.push('Next session ' + startLbl)
    }
    return parts.join('  ·  ')
  }
  let dayOfSession = null
  try {
    dayOfSession = Math.ceil((new Date() - new Date(biennium.start)) / 86400000) + 1
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

/**
 * Parse AI summary into { heading, body } sections.
 * ALL-CAPS phrases (4–40 chars) are detected as section headings.
 * Markdown ## and ** markers are stripped.
 */
function structureSummary(raw) {
  if (!raw) return []
  const lines = String(raw)
    .split(/\r?\n/)
    .map(l => l.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim())
    .filter(l => l.length > 0)

  const sections = []
  let curHeading = null
  let curBody    = []
  const flush = () => {
    if (curHeading || curBody.length > 0)
      sections.push({ heading: curHeading, body: curBody.join(' ').replace(/\s{2,}/g, ' ').trim() })
  }
  for (const line of lines) {
    const isHeading = line.length >= 4 && line.length <= 40 &&
      /^[A-Z][A-Z0-9 \-/&]{3,}$/.test(line)
    if (isHeading) { flush(); curHeading = line; curBody = [] }
    else           { curBody.push(line) }
  }
  flush()
  return sections.filter(s => s.heading || s.body)
}

/**
 * Extract chronological stage events from snapshots for the optional
 * compact timeline row. Returns [] when fewer than 3 transitions exist.
 */
function buildBillTimeline(snapshots) {
  if (!snapshots || snapshots.length === 0) return []
  const sorted = [...snapshots].sort((a, b) =>
    new Date(a.created_at || a.snapshot_date || 0) -
    new Date(b.created_at || b.snapshot_date || 0)
  )
  const STAGE_NAMES = {
    1: 'Introduced', 2: 'In committee', 3: 'Out of committee',
    4: 'Passed floor', 5: 'Sent to other chamber', 6: 'Signed into law',
  }
  const events = []
  const seen = new Set()
  sorted.forEach(snap => {
    const s = snap.stage
    if (s != null && !seen.has(s) && STAGE_NAMES[s]) {
      seen.add(s)
      const d = snap.created_at || snap.snapshot_date
      if (d) events.push({ label: STAGE_NAMES[s], date: d })
    }
  })
  return events
}

// ── Section label helper (matches generate-member-pdf.js exactly) ────────────

/**
 * Draw a brass ALL-CAPS section label + rule line.
 * Returns y advanced past the rule + 4mm gap.
 * Font + size are set here — callers must re-set font for body text after.
 */
function drawSectionLabel(doc, y, m, contentW, label) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.accent)
  doc.text(label.toUpperCase(), m, y)
  y += 1.5
  doc.setDrawColor(...P.accent)
  doc.setLineWidth(0.4)
  doc.line(m, y, m + contentW, y)
  return y + 4
}

// ── Section 1 — Header ────────────────────────────────────────────────────────

/**
 * Logo (left) + domain + generated timestamp + session context (right).
 * logoH = 14 — consistent with generate-member-pdf.js T147.
 * Async: rasterizes /logos/vector-wa-primary.svg via canvas.
 */
async function drawHeader(doc, y, m, pw, contentW, generatedAt) {
  const logoH = 14
  const logoW = logoH * (895 / 500)  // aspect 895:500 = ~25mm

  let logoDrawn = false
  try {
    const dataUrl = await loadSvgWithFillSwap('/logos/vector-wa-primary.svg', {
      '#ebeae4': '#0e1014',
    })
    if (dataUrl) {
      doc.addImage(dataUrl, 'PNG', m, y, logoW, logoH)
      logoDrawn = true
    }
  } catch (_) {}

  if (!logoDrawn) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...P.primary)
    doc.text('VECTOR | WA', m, y + 9)
  }

  // Right: domain
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...P.accent)
  doc.text(VECTOR_DOMAIN, pw - m, y + 5, { align: 'right' })

  // Right: generated timestamp
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  const stamp = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  }) + ' · ' + generatedAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  })
  doc.text('Generated ' + stamp, pw - m, y + 10, { align: 'right' })

  // Right: session context strip (active session vs. interim)
  const ctxLine = getSessionContextLine()
  if (ctxLine) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...P.muted)
    doc.text(ctxLine, pw - m, y + 14.5, { align: 'right' })
  }

  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, y + logoH + 2, pw - m, y + logoH + 2)

  return y + logoH + 6
}

// ── Section 2 — Bill identity ─────────────────────────────────────────────────

/**
 * Bill number (courier bold brass) · session inline · title (bold, ≤2 lines)
 * Category · Chamber meta row.
 */
function drawBillIdentity(doc, y, m, contentW, bill) {
  // Bill number — courier bold brass (matches top-bills list in member PDF)
  doc.setFont('courier', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...P.accent)
  const label = billLabel(bill)
  doc.text(label, m, y + 5)
  const labelW = doc.getTextWidth(label)

  // Session inline — same baseline, muted
  if (bill.session) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text(bill.session, m + labelW + 4, y + 5)
  }

  // Title — font MUST be set before splitTextToSize (T148 discipline)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10.5)
  doc.setTextColor(...P.primary)
  const titleLines = doc.splitTextToSize(getBillTitle(bill), contentW)
  const shownLines = titleLines.slice(0, 2)
  shownLines.forEach((line, i) => doc.text(line, m, y + 11 + i * 5))

  const titleBottom = y + 11 + shownLines.length * 5

  // Meta: category · chamber
  const metaParts = [bill.category, bill.chamber].filter(Boolean)
  if (metaParts.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text(metaParts.join('  ·  '), m, titleBottom + 3)
    return titleBottom + 8
  }

  return titleBottom + 4
}

// ── Section 3 — Status pill ───────────────────────────────────────────────────

/**
 * Brass left-accent rounded pill: current stage · hearing date or action date.
 */
function drawStatusPill(doc, y, m, contentW, bill) {
  const stageLine  = getStagePlainText(bill)
  const dateLbl    = getRecentActionDate(bill)
  const cl         = (bill.confidence_label || '').toUpperCase()
  const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'
  const interim    = isInterimPeriod()

  let text = stageLine
  if (isTerminal) {
    if (dateLbl) text += '  ·  ' + dateLbl
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
    if (tail.length) text += '  ·  ' + tail.join('  ·  ')
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

// ── Section 4 — Score block ───────────────────────────────────────────────────

/**
 * Score circle (left) + TRAJECTORY SCORE label + tier + one-liner (right).
 * Circle pattern matches generate-member-pdf.js drawTopBills, scaled up for
 * the primary metric display role.
 */
function drawScoreBlock(doc, y, m, contentW, bill) {
  const score    = bill.final_score || 0
  const color    = getOutcomeColor(bill, P)
  const tierLbl  = getScoreTierLabel(score)
  const oneLiner = getScoreOneLiner(bill, score)
  const boxH     = 20

  // Outer surface box
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.roundedRect(m, y, contentW, boxH, 2, 2, 'FD')

  // Score circle — r=8, left-center
  const circleR = 8
  const cx = m + 4 + circleR
  const cy = y + boxH / 2
  doc.setFillColor(...color)
  doc.circle(cx, cy, circleR, 'F')

  // Score number — font MUST be set before text (T148 discipline)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...P.white)
  doc.text(String(score), cx, cy + 1.8, { align: 'center' })

  // Tier label — below circle, centered, colored
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6)
  doc.setTextColor(...color)
  doc.text(tierLbl, cx, y + boxH - 1, { align: 'center' })

  // Right-side content
  const txtX = m + 4 + circleR * 2 + 5
  const txtW = contentW - 4 - circleR * 2 - 5 - 4

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('TRAJECTORY SCORE', txtX, y + 5)

  // One-liner — font MUST be set before splitTextToSize (T148)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(oneLiner, txtW)
  lines.slice(0, 2).forEach((line, i) => doc.text(line, txtX, y + 10 + i * 4.5))

  return y + boxH + 4
}

// ── Section 5 — Sponsor + Committee ──────────────────────────────────────────

/**
 * Two compact cards side-by-side: Prime Sponsor (left) · Committee (right).
 * cardH = 16 (tightened from 22 in T32 design — saves 6mm).
 */
function drawSponsorCommittee(doc, y, m, contentW, bill) {
  const colW  = (contentW - 5) / 2
  const cardH = 16

  // ── Left card — Sponsor ──────────────────────────────────────────────────

  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, colW, cardH, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('PRIME SPONSOR', m + 4, y + 4.5)

  // Name — font MUST be set before splitTextToSize (T148)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...P.primary)
  const name     = bill.prime_sponsor || '—'
  const nameLines = doc.splitTextToSize(name, colW - 14)
  doc.text(nameLines.slice(0, 1), m + 4, y + 9.5)

  // Party character in color — appended after the name
  const partyChar = ((bill.prime_party || bill.sponsor_party || '')).charAt(0).toUpperCase()
  if (PARTY_COLOR[partyChar] && name !== '—') {
    // font still set to bold/9.5 from above — getTextWidth uses current state
    const nameW = doc.getTextWidth(nameLines[0] || name)
    doc.setFontSize(9)
    doc.setTextColor(...PARTY_COLOR[partyChar])
    doc.text(' (' + partyChar + ')', m + 4 + nameW, y + 9.5)
  }

  // District · tier · chair flag · bipartisan
  const metaParts = [
    bill.sponsor_district ? 'Dist. ' + bill.sponsor_district : null,
    SPONSOR_TIER_LABEL[bill.sponsor_tier] || null,
    (bill.sponsor_is_chair || bill.is_committee_chair) ? 'Committee Chair' : null,
    bill.bipartisan ? 'Bipartisan' : null,
  ].filter(Boolean)
  if (metaParts.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...P.muted)
    doc.text(metaParts.join('  ·  '), m + 4, y + 13.5)
  }

  // ── Right card — Committee ───────────────────────────────────────────────

  const rightX = m + colW + 5
  doc.setFillColor(...P.surface)
  doc.setDrawColor(...P.neutralLt)
  doc.roundedRect(rightX, y, colW, cardH, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('COMMITTEE', rightX + 4, y + 4.5)

  // Committee name — font MUST be set before splitTextToSize (T148)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...P.primary)
  const cmteName  = bill.committee_name || 'No committee assigned'
  const cmteLines = doc.splitTextToSize(cmteName, colW - 8)
  doc.text(cmteLines.slice(0, 1), rightX + 4, y + 9.5)

  // Chair + hearing date
  const cmteMeta = []
  if (bill.committee_chair) cmteMeta.push('Chair: ' + bill.committee_chair)
  if (bill.hearing_date) {
    try {
      cmteMeta.push('Hearing ' + new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
    } catch (e) {}
  }
  if (cmteMeta.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...P.muted)
    doc.text(cmteMeta.join('  ·  '), rightX + 4, y + 13.5)
  }

  return y + cardH + 4
}

// ── Section 6 — What the bill does ───────────────────────────────────────────

/**
 * Extracts EXECUTIVE SUMMARY (≤3 lines) + WHO IS AFFECTED (≤1 line) from
 * the structured AI summary. Other AI sections (KEY PROVISIONS, POLITICAL
 * OUTLOOK, etc.) are intentionally omitted — they create a wall of text that
 * lobbyists skip.
 *
 * "AI-GENERATED" attribution tag placed right-aligned on the section header
 * baseline, per Brand Guide v1.2 §14/§17.
 */
function drawWhatItDoes(doc, y, m, contentW, bill, ph) {
  const sections = structureSummary(bill.custom_summary || bill.ai_summary || '')
  if (!sections.length) return y

  // Extract the two useful sections from the structured parse
  const execSec = sections.find(s => s.heading && /EXECUTIVE|SUMMARY/i.test(s.heading))
    || sections.find(s => !s.heading)
    || sections[0]

  const affectedSec = sections.find(s =>
    s.heading && /AFFECTED|IMPACT/i.test(s.heading)
  )

  if (!execSec?.body && !affectedSec?.body) return y

  y = checkPageBreak(doc, y, 24, ph)

  // AI attribution — drawn at pre-advance y, right-aligned, same baseline as label
  const aiLabel = bill.custom_summary ? 'AI-GENERATED · EDITED' : 'AI-GENERATED'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...P.muted)
  doc.text(aiLabel, m + contentW, y, { align: 'right' })

  y = drawSectionLabel(doc, y, m, contentW, 'What the bill does')

  let cy = y

  // EXECUTIVE SUMMARY — max 3 lines at 8.5pt; font MUST be set before wrapText (T148)
  if (execSec?.body) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.primary)
    const lines = doc.splitTextToSize(execSec.body, contentW)
    lines.slice(0, 3).forEach(line => {
      cy = checkPageBreak(doc, cy, 4.5, ph)
      doc.text(line, m, cy)
      cy += 4.3
    })
    cy += 1.5
  }

  // WHO IS AFFECTED — 1 line, muted; font set before splitTextToSize (T148)
  if (affectedSec?.body) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    const affLines = doc.splitTextToSize('Affects: ' + affectedSec.body, contentW)
    doc.text(affLines.slice(0, 1), m, cy)
    cy += 4.5
  }

  return cy + 2
}

// ── Section 7 — Top X-Factors ─────────────────────────────────────────────────

/**
 * Top 3 signals (2 positive + 1 negative) in a single horizontal chip row.
 * Triangles drawn via doc.triangle() — no Unicode glyph dependency.
 * Gracefully omitted when fewer than 2 factors are available.
 */
function drawXFactors(doc, y, m, contentW, scoreFeatures, ph) {
  const positives = (scoreFeatures || []).filter(f => f.pos).sort((a, b) => b.d - a.d).slice(0, 2)
  const negatives = (scoreFeatures || []).filter(f => !f.pos).sort((a, b) => a.d - b.d).slice(0, 1)
  const top = [...positives, ...negatives].slice(0, 3)
  if (top.length < 2) return y

  y = checkPageBreak(doc, y, 16, ph)
  y = drawSectionLabel(doc, y, m, contentW, 'Top X-Factors')

  const chipH   = 7
  const chipGap = 3
  const chipW   = (contentW - chipGap * (top.length - 1)) / top.length

  top.forEach((f, i) => {
    const cx    = m + i * (chipW + chipGap)
    const isPos = f.pos

    doc.setFillColor(...(isPos ? [248, 244, 234] : [252, 240, 236]))
    doc.setDrawColor(...(isPos ? [200, 175, 120] : [220, 160, 145]))
    doc.setLineWidth(0.2)
    doc.roundedRect(cx, y, chipW, chipH, 1, 1, 'FD')

    // Triangle indicator
    const triX = cx + 3.5
    const triY = y + chipH / 2
    doc.setFillColor(...(isPos ? P.accent : P.danger))
    if (isPos) {
      doc.triangle(triX, triY - 1.2, triX + 2, triY + 1, triX - 2, triY + 1, 'F')
    } else {
      doc.triangle(triX, triY + 1.2, triX + 2, triY - 1, triX - 2, triY - 1, 'F')
    }

    // Label + delta — font MUST be set before getTextWidth (T148 discipline)
    const deltaPct = (f.d > 0 ? '+' : '') + Math.round(f.d * 100) + '%'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...(isPos ? P.accent : P.danger))
    let labelTxt = (f.l || '') + '  ' + deltaPct
    while (doc.getTextWidth(labelTxt) > chipW - 9 && labelTxt.length > 8) {
      labelTxt = labelTxt.slice(0, -1)
    }
    if (labelTxt !== (f.l || '') + '  ' + deltaPct) labelTxt += '...'
    doc.text(labelTxt, triX + 4, y + chipH / 2 + 1.4)
  })

  return y + chipH + 4
}

// ── Section 8 — Floor votes (conditional) ────────────────────────────────────

/**
 * Latest vote per chamber — compact 10mm rows with party split.
 * Skipped entirely when rollCalls is empty.
 */
function drawFloorVotes(doc, y, m, contentW, rollCalls, partyBucketsByRcId, ph) {
  if (!rollCalls || !rollCalls.length) return y

  // Latest vote per chamber
  const byChamber = {}
  rollCalls.forEach(rc => {
    const ch   = rc.chamber || 'Unknown'
    const prev = byChamber[ch]
    if (!prev || (rc.vote_date && (!prev.vote_date || rc.vote_date > prev.vote_date)))
      byChamber[ch] = rc
  })
  const votes = []
  if (byChamber.House)  votes.push(byChamber.House)
  if (byChamber.Senate) votes.push(byChamber.Senate)
  Object.keys(byChamber).forEach(k => {
    if (k !== 'House' && k !== 'Senate') votes.push(byChamber[k])
  })
  if (!votes.length) return y

  const rowH = 10
  y = checkPageBreak(doc, y, 12 + votes.length * (rowH + 2), ph)
  y = drawSectionLabel(doc, y, m, contentW, votes.length > 1 ? 'Floor Votes' : 'Floor Vote')

  votes.forEach(rc => {
    const passed = (rc.result || '').toLowerCase() === 'passed'

    doc.setFillColor(...P.surface)
    doc.setDrawColor(...P.neutralLt)
    doc.setLineWidth(0.2)
    doc.roundedRect(m, y, contentW, rowH, 1.5, 1.5, 'FD')

    // Left accent bar — brass if passed, rust if failed
    doc.setFillColor(...(passed ? P.accent : P.danger))
    doc.rect(m, y, 2.5, rowH, 'F')

    // Chamber + date (top-left)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.primary)
    let dateLbl = ''
    try { dateLbl = formatSessionDate(rc.vote_date) } catch (e) {}
    if (dateLbl === 'session dates TBD') dateLbl = ''
    doc.text((rc.chamber || '') + (dateLbl ? '  ·  ' + dateLbl : ''), m + 5, y + 4.2)

    // Yea-Nay tally (bottom-left)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...(passed ? P.accent : P.danger))
    doc.text((rc.yeas || 0) + '-' + (rc.nays || 0), m + 5, y + 8.5)

    // Result label
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...P.muted)
    doc.text(passed ? 'Passed' : 'Failed', m + 28, y + 8.5)

    // Party split (top-right)
    const pb = partyBucketsByRcId && rc.id ? partyBucketsByRcId[rc.id] : null
    if (pb) {
      const parts = []
      if ((pb.yesD || 0) + (pb.noD || 0) > 0) parts.push('D ' + (pb.yesD || 0) + '-' + (pb.noD || 0))
      if ((pb.yesR || 0) + (pb.noR || 0) > 0) parts.push('R ' + (pb.yesR || 0) + '-' + (pb.noR || 0))
      if (parts.length) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...P.muted)
        doc.text(parts.join('  ·  '), m + contentW - 4, y + 4.2, { align: 'right' })
      }
    }

    y += rowH + 2
  })

  return y + 2
}

// ── Section 9 — Companion bill (conditional) ─────────────────────────────────

function drawCompanion(doc, y, m, contentW, bill, ph) {
  if (!bill.companion_bill) return y
  y = checkPageBreak(doc, y, 12, ph)
  y = drawSectionLabel(doc, y, m, contentW, 'Companion Bill')

  const parts = [bill.companion_bill]
  if (bill.companion_score != null) parts.push('Score ' + bill.companion_score)
  const stateLbl = companionStateLabel(bill.companion_state)
  if (stateLbl) parts.push(stateLbl)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  doc.text(parts.join('  ·  '), m, y)
  return y + 6
}

// ── Section 10 — Fiscal note (conditional) ───────────────────────────────────

function drawFiscalNote(doc, y, m, contentW, fiscalNote, bill, ph) {
  const size    = fiscalNote ? (fiscalNote.size || fiscalNote.new_size) : bill.fiscal_note_size
  const updated = fiscalNote ? (fiscalNote.detected_date || fiscalNote.updated_at) : bill.fiscal_note_updated_at
  if (!size) return y

  y = checkPageBreak(doc, y, 12, ph)
  y = drawSectionLabel(doc, y, m, contentW, 'Fiscal Note')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  let line = fiscalSizeLabel(size) || String(size)
  if (updated) {
    let dateStr = ''
    try { dateStr = formatSessionDate(updated) } catch (e) { dateStr = String(updated).slice(0, 10) }
    if (dateStr && dateStr !== 'session dates TBD') line += '  ·  Updated ' + dateStr
  }
  doc.text(line, m, y)
  return y + 6
}

// ── Section 11 — Stage timeline (conditional, 3+ transitions only) ────────────

/**
 * Compact dot-arrow row: "Introduced Jan 14  >  Out of committee Feb 3  >  ..."
 * Only rendered when the snapshot history has 3 or more distinct stage events.
 * Shown last (supporting detail, Tier 3) so it never bumps higher-signal content.
 */
function drawTimeline(doc, y, m, contentW, snapshots, ph) {
  const events = buildBillTimeline(snapshots)
  if (events.length < 3) return y   // Not worth a section with 1–2 points

  y = checkPageBreak(doc, y, 12, ph)
  y = drawSectionLabel(doc, y, m, contentW, 'Stage History')

  const parts = events.map(e => {
    try {
      const d = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return e.label + ' ' + d
    } catch { return e.label }
  })
  const flowText = parts.join('  >  ')

  // Font MUST be set before splitTextToSize (T148 discipline)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(flowText, contentW)
  let cy = y
  lines.slice(0, 2).forEach(line => {
    cy = checkPageBreak(doc, cy, 4.5, ph)
    doc.text(line, m, cy)
    cy += 4.3
  })
  return cy + 2
}

// ── Footer ────────────────────────────────────────────────────────────────────

function drawFooter(doc, ph, m, pw, bill, generatedAt) {
  const fy   = ph - 13
  const stamp = generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const verifyPath = '/bill/' + (bill.bill_id || bill.id || '')
  const line1 = 'Generated ' + stamp + ' · Verify at ' + VECTOR_DOMAIN + verifyPath
  const line2  = 'Not legal advice · Vector | WA — Washington State legislative intelligence'

  doc.setDrawColor(...P.accent)
  doc.setLineWidth(0.4)
  doc.line(m, fy, pw - m, fy)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text(line1, m, fy + 4)
  doc.text(line2, m, fy + 8)
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate the Vector | WA single-bill public brief (US letter, one page).
 * All non-bill inputs are optional — sections degrade gracefully when absent.
 *
 * Signature is unchanged from T32 — call site in bill/[id]/page.js requires
 * no modification. Legacy params (recentRollCall, partyBuckets, companion)
 * are retained for backwards compatibility; the T150 layout uses rollCalls
 * and partyBucketsByRcId exclusively.
 *
 * @param {Object} input
 * @param {Object} input.bill                   Bills row from Supabase.
 * @param {Array<{l,d,pos}>} [input.scoreFeatures]  latestSnap.xf_factors.
 * @param {Array}  [input.rollCalls]             Roll-call rows; latest per chamber used.
 * @param {Object} [input.partyBucketsByRcId]    Map id -> {yesD,yesR,noD,noR}.
 * @param {Object} [input.recentRollCall]        Legacy compat — not used in T150 layout.
 * @param {Object} [input.partyBuckets]          Legacy compat — not used in T150 layout.
 * @param {Array}  [input.recentAmendments]      Legacy compat — not used in T150 layout.
 * @param {Array}  [input.snapshots]             Stage history for timeline (Tier 3).
 * @param {Object} [input.companion]             Reserved for future companion enrichment.
 * @param {Object} [input.fiscalNote]            Fiscal note object.
 * @param {Date}   [input.generatedAt]           Render timestamp; defaults to now.
 * @returns {Promise<string>} Filename of the saved PDF.
 */
export async function generatePublicBriefPDF({
  bill,
  scoreFeatures    = [],
  rollCalls        = null,
  partyBucketsByRcId = null,
  recentRollCall   = null,      // legacy compat
  partyBuckets     = null,      // legacy compat
  recentAmendments = [],        // legacy compat
  snapshots        = null,
  companion        = null,      // reserved
  fiscalNote       = null,
  generatedAt      = new Date(),
} = {}) {
  if (!bill) throw new Error('generatePublicBriefPDF: bill is required')

  // US letter (215.9 × 279.4 mm) — consistent with generate-member-pdf.js
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const m  = 16
  const contentW = pw - 2 * m
  let y = 14

  // ── Render pipeline ─────────────────────────────────────────────────────

  // Tier 1 — always visible, above the fold
  y = await drawHeader(doc, y, m, pw, contentW, generatedAt)
  y = drawBillIdentity(doc, y, m, contentW, bill)
  y = drawStatusPill(doc, y, m, contentW, bill)
  y = drawScoreBlock(doc, y, m, contentW, bill)

  // Tier 2 — body: context + committee + top signals
  y = drawSponsorCommittee(doc, y, m, contentW, bill)
  y = drawWhatItDoes(doc, y, m, contentW, bill, ph)
  y = drawXFactors(doc, y, m, contentW, scoreFeatures, ph)

  // Tier 3 — supporting detail (conditional, each section self-guards)
  y = drawFloorVotes(doc, y, m, contentW, Array.isArray(rollCalls) ? rollCalls : [], partyBucketsByRcId || {}, ph)
  y = drawCompanion(doc, y, m, contentW, bill, ph)
  y = drawFiscalNote(doc, y, m, contentW, fiscalNote, bill, ph)
  y = drawTimeline(doc, y, m, contentW, snapshots, ph)

  // ────────────────────────────────────────────────────────────────────────

  // Footer on every page
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    drawFooter(doc, ph, m, pw, bill, generatedAt)
  }

  // Bill-specific filename
  const safeBill = ((bill.chamber === 'House' ? 'HB' : 'SB') + (bill.bill_number || '')).replace(/[^a-zA-Z0-9]/g, '_')
  const safeDate = generatedAt.toISOString().slice(0, 10).replace(/-/g, '')
  const filename = 'Vector_WA_' + safeBill + '_brief_' + safeDate + '.pdf'
  doc.save(filename)
  return filename
}
