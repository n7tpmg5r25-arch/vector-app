/**
 * Vector | WA — PDF Intelligence Brief Generator
 * Phase 6M: Executive summary, bill detail cards, what-to-watch, session context bar
 * Part 2 additions: outcome grouping, sort by score, summary truncation, stat layout fix, methodology pinned to last page
 *
 * Uses jsPDF + jspdf-autotable (must be installed: npm install jspdf jspdf-autotable)
 *
 * NOTE: jsPDF built-in fonts (Helvetica/Times/Courier) only support Windows-1252 characters.
 * Do NOT use Unicode symbols like box-drawing, Greek letters, or arrows — use ASCII equivalents.
 */

import jsPDF from 'jspdf'
import {
  isInterimPeriod, isPostBienniumClose, getCurrentBiennium, getNextBiennium,
  getSessionCutoffs, formatSessionDate, daysUntil,
} from './session-config'
// Thread 32 / Thread 44 — shared color/tier/layout helpers. Helpers default
// to VECTOR_PALETTE (Brand Guide v1.2 §02). Both PDF generators share the
// same palette as of Thread 44.
import {
  STAGE_LABELS,
  TIER_HIGH, TIER_MODERATE, TIER_LOW,
  loadImageAsBase64,
  loadSvgWithFillSwap,
  getScoreColor, getScoreTierLabel, getOutcomeColor,
  checkPageBreak,
} from './pdf-shared'

// ── Summary truncation limit (max lines per bill card) ──────
const MAX_SUMMARY_LINES = 6

// ── Brand colors (RGB arrays) ────────────────────────────────
// Kept as module-level constants because they are referenced inline
// throughout this file via spread (e.g. doc.setTextColor(...PRIMARY)).
// The same values are exposed on VECTOR_PALETTE in pdf-shared.js for
// helpers that take a palette object — keep both in sync if either changes.
//
// Legacy variable names (FOREST/TEAL/GOLD/GRAY/LGRAY/RED/MUTED) survive as
// aliases to minimize the diff against the rest of this file's drawing
// code. Each maps to its Brand v1.2 equivalent below — see the comments.
const PRIMARY   = [14, 16, 20]     // Dark Neutral #0e1014 — text on white paper
const ACCENT    = [184, 151, 90]   // Brass        #b8975a — primary accent
const ACCENT_LT = [212, 180, 122]  // Brass Light  #d4b47a — bright accent (logo arrow tip)
const STONE     = [138, 128, 112]  // Stone        #8a8070 — tertiary / metadata
const TMUTED    = [70, 75, 85]     // text-muted analog — secondary text
const LGRAY     = [200, 195, 185]  // Light divider analog
const SURFACE   = [248, 246, 242]  // Off-white print surface (card background on paper)
const WHITE     = [255, 255, 255]
const RUST      = [196, 71, 48]    // Rust         #c44730 — universal warning

// Legacy aliases — same RGB tuples, old names. Lets the drawing code below
// stay diff-quiet while still rendering in the v1.2 palette.
const FOREST = PRIMARY    // was Forest dark green; now Dark Neutral text
const TEAL   = ACCENT     // was Forest Mid; now Brass accent
const GOLD   = ACCENT     // unchanged hex (Brass)
const GRAY   = TMUTED     // was Slate; now text-muted analog
const RED    = RUST       // unchanged hex (Rust / former Ember)
const MUTED  = STONE      // unchanged hex (Stone)

// ── Helpers ──────────────────────────────────────────────────

/** Display-ready bill title with fallback. */
function getBillTitle(bill) {
  const title = (bill.title || '').trim()
  if (!title) return bill.committee_name || 'Bill ' + bill.bill_number
  if (title === title.toUpperCase() && title.length < 40 && !/RELAT|CONCERN|PROVID|CREAT|AMEND|REPEAL/.test(title)) {
    return bill.committee_name || 'Bill ' + bill.bill_number
  }
  return title
}

/** Plain-English stage description.
 *  Post-biennium-close PASSED_CHAMBER reframing matches Thread 41's
 *  in-app scoreToEnglish branch: bills that passed one chamber don't
 *  "carry over" across a biennium boundary -- they die unless refiled. */
function getStagePlainText(bill) {
  const s = bill.stage || 1
  const chamber = bill.chamber || 'House'
  const cmte = bill.committee_name || ''

  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')  return 'Signed into law'
  if (cl === 'DEAD') return 'Did not advance — session ended'
  if (cl === 'PASSED_CHAMBER') {
    if (isPostBienniumClose()) {
      const next = getNextBiennium()?.session
      return next
        ? 'Passed ' + chamber + ' — must be refiled in ' + next
        : 'Passed ' + chamber + ' — must be refiled next biennium'
    }
    return 'Passed ' + chamber + ' — carries to next session'
  }

  if (s >= 6) return 'Signed into law'
  if (s >= 4) return 'Passed ' + chamber + ' floor'
  if (s >= 3) return cmte ? 'Passed ' + cmte : 'Passed committee'
  return 'Introduced in ' + chamber
}

/** Phase 7W.3: Companion status line for a bill card.
 *  Returns a single-line description of the companion relationship, or null
 *  if the bill has no companion (so the card skips the line entirely).
 *  Format: "Companion HB 2193 (Out of cmte, score 68) — Both moving"
 *  Matches the five-state relational signal set by sync-v2.js resolver. */
function getCompanionLine(bill) {
  if (!bill.companion_bill) return null

  const COMP_STATE_LABELS = {
    both_moving: 'Both moving',
    leading:     'Leading',
    trailing:    'Trailing',
    forked:      'Diverged',
    both_stuck:  'Both stuck',
  }

  const compStage = bill.companion_stage
  const compScore = bill.companion_score
  const compState = bill.companion_state
  const stateLabel = compState ? COMP_STATE_LABELS[compState] : null

  // Companion stage short label (mirrors PDF stage vocabulary, not the bill page one)
  let stageLabel = null
  if (compStage != null) {
    if (compStage >= 6)      stageLabel = 'Signed'
    else if (compStage >= 4) stageLabel = 'Passed floor'
    else if (compStage >= 3) stageLabel = 'Out of cmte'
    else if (compStage >= 2) stageLabel = 'In committee'
    else                     stageLabel = 'Introduced'
  }

  // Build "(stage, score X)" parenthetical — only include fields we actually have
  const parenParts = []
  if (stageLabel) parenParts.push(stageLabel)
  if (compScore != null) parenParts.push('score ' + compScore)
  const paren = parenParts.length ? ' (' + parenParts.join(', ') + ')' : ''

  const prefix = 'Companion ' + bill.companion_bill + paren
  return stateLabel ? prefix + ' -- ' + stateLabel : prefix
}

/** Delta narrative for a bill card. Returns empty string for terminal bills (no redundancy). */
function getDeltaNarrative(billId, bill, scoreDeltas, changes) {
  const cl = (bill.confidence_label || '').toUpperCase()
  // Terminal bills — stage line already says it all, don't repeat
  if (cl === 'DEAD' || cl === 'LAW' || cl === 'PASSED_CHAMBER') return ''

  const delta = scoreDeltas[billId]
  const change = changes[billId]

  const parts = []
  if (delta && delta !== 0) {
    parts.push((delta > 0 ? '+' : '') + delta + ' pts')
  }
  if (change && change.stageChanged) {
    const newLabel = STAGE_LABELS[change.newStage] || 'stage ' + change.newStage
    parts.push('moved to ' + newLabel)
  }
  if (parts.length === 0) return 'No change this week'
  return parts.join(' -- ')
}

// ── Bill grouping ───────────────────────────────────────────
// Groups: Signed into Law → Active (by score desc) → Passed Chamber → Did Not Advance

const GROUP_ORDER = ['LAW', 'ACTIVE', 'PASSED_CHAMBER', 'DEAD']
const GROUP_LABELS = {
  'LAW':        'Signed into Law',
  'ACTIVE':     'Active Legislation',
  'PASSED_CHAMBER': 'Passed Chamber',
  'DEAD':       'Did Not Advance',
}
const GROUP_COLORS = {
  'LAW':        TEAL,
  'ACTIVE':     FOREST,
  'PASSED_CHAMBER': GOLD,
  'DEAD':       GRAY,
}

/**
 * Sort and group bills by outcome, then by score descending within each group.
 * Returns array of { groupKey, label, color, bills[] } with empty groups omitted.
 */
function groupBills(bills) {
  const buckets = { 'LAW': [], 'ACTIVE': [], 'PASSED_CHAMBER': [], 'DEAD': [] }

  bills.forEach(tracked => {
    const cl = (tracked.bills?.confidence_label || '').toUpperCase()
    if (cl === 'LAW')             buckets['LAW'].push(tracked)
    else if (cl === 'DEAD')       buckets['DEAD'].push(tracked)
    else if (cl === 'PASSED_CHAMBER') buckets['PASSED_CHAMBER'].push(tracked)
    else                          buckets['ACTIVE'].push(tracked)
  })

  // Sort each bucket by score descending
  Object.values(buckets).forEach(arr => {
    arr.sort((a, b) => (b.bills?.final_score || 0) - (a.bills?.final_score || 0))
  })

  return GROUP_ORDER
    .filter(key => buckets[key].length > 0)
    .map(key => ({
      groupKey: key,
      label: GROUP_LABELS[key],
      color: GROUP_COLORS[key],
      bills: buckets[key],
    }))
}

/**
 * Draw a group section header (e.g., "Signed into Law (2)")
 * Returns new y position.
 */
function drawGroupHeader(doc, group, y, m, contentW, ph) {
  y = checkPageBreak(doc, y, 10, ph)

  // Accent line
  doc.setDrawColor(...group.color)
  doc.setLineWidth(0.8)
  doc.line(m, y, m + 18, y)

  // Label
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...group.color)
  doc.text(group.label.toUpperCase() + '  (' + group.bills.length + ')', m + 20, y + 0.5)

  // Faint full-width line
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.15)
  const labelW = doc.getTextWidth(group.label.toUpperCase() + '  (' + group.bills.length + ')')
  doc.line(m + 22 + labelW, y, m + contentW, y)

  return y + 5
}


// ═══════════════════════════════════════════════════════════════
// SECTION RENDERERS
// ═══════════════════════════════════════════════════════════════

/**
 * 6M.4 — Session Context Bar
 * Thin horizontal bar showing where we are in the legislative calendar.
 */
function drawSessionContextBar(doc, y, pw, m, contentW) {
  const interim = isInterimPeriod()
  const biennium = getCurrentBiennium()
  let contextText = ''

  if (interim) {
    const next = getNextBiennium()
    const endFormatted = formatSessionDate(biennium.end)
    const parts = ['Session ended ' + endFormatted]
    if (next.prefilingOpens) {
      parts.push('Pre-filing opens ' + formatSessionDate(next.prefilingOpens))
    }
    parts.push('Next session: ' + formatSessionDate(next.start))
    contextText = parts.join('  |  ')
  } else {
    // Active session — compute day-of-session
    const startDate = new Date(biennium.start)
    const now = new Date()
    const dayOfSession = Math.ceil((now - startDate) / 86400000) + 1
    const endDate = new Date(biennium.end)
    const totalDays = Math.ceil((endDate - startDate) / 86400000)

    const cutoffs = getSessionCutoffs().filter(c => !c.passed).slice(0, 2)
    const cutoffParts = cutoffs.map(c => c.label + ': ' + formatSessionDate(c.date) +
      ' (' + c.daysLeft + ' days)')

    contextText = 'Day ' + dayOfSession + ' of ' + totalDays
    if (cutoffParts.length > 0) contextText += '  |  ' + cutoffParts.join('  |  ')
  }

  // Draw bar
  doc.setFillColor(...SURFACE)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.15)
  doc.roundedRect(m, y, contentW, 9, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...FOREST)
  doc.text(contextText, m + 4, y + 5.8)

  return y + 13
}


/**
 * 6M.1 — Executive Summary
 * Template-driven narrative about what changed, approaching cutoffs, portfolio health.
 */
function drawExecutiveSummary(doc, y, pw, m, contentW, ph, bills) {
  y = checkPageBreak(doc, y, 28, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...TEAL)
  doc.text('EXECUTIVE SUMMARY', m, y)
  y += 5

  const interim = isInterimPeriod()
  const biennium = getCurrentBiennium()
  const n = bills.length

  let narrative = ''

  if (interim) {
    // Count outcomes
    const lawCount   = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'LAW').length
    const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'PASSED_CHAMBER').length
    const deadCount  = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'DEAD').length

    const endFormatted = formatSessionDate(biennium.end)
    narrative = 'The ' + biennium.session + ' session ended ' + endFormatted + '. '
    narrative += 'Of your ' + n + ' tracked bill' + (n !== 1 ? 's' : '') + ', '

    const outcomes = []
    if (lawCount > 0)   outcomes.push(lawCount + ' signed into law')
    if (carryCount > 0) outcomes.push(carryCount + ' passed ' + (carryCount === 1 ? 'its' : 'their') + ' chamber and will carry into the next session')
    if (deadCount > 0)  outcomes.push(deadCount + ' did not advance')

    if (outcomes.length === 0) {
      narrative += 'none have recorded outcomes yet.'
    } else if (outcomes.length === 1) {
      narrative += outcomes[0] + '.'
    } else {
      narrative += outcomes.slice(0, -1).join(', ') + ', and ' + outcomes[outcomes.length - 1] + '.'
    }

    // Add forward-looking line
    const next = getNextBiennium()
    if (next.prefilingOpens) {
      narrative += ' Pre-filing for the ' + next.session + ' session opens ' + formatSessionDate(next.prefilingOpens) + '.'
    }

  } else {
    // Active session narrative
    const startDate = new Date(biennium.start)
    const now = new Date()
    const weekNum = Math.ceil((now - startDate) / (7 * 86400000))

    narrative = 'Week ' + weekNum + ' of the ' + biennium.session + ' session. '

    // Approaching cutoffs
    const cutoffs = getSessionCutoffs().filter(c => !c.passed && c.daysLeft <= 21)
    if (cutoffs.length > 0) {
      const next = cutoffs[0]
      narrative += next.label + ' is ' + next.dateFormatted + ' (' + next.daysLeft + ' days away). '
    }

    // Count score movements and stage changes
    const allScores = bills.map(b => b.bills?.final_score || 0)
    const highMovers = bills.filter(b => {
      const delta = Math.abs(b.bills?.final_score || 0)  // placeholder
      return false  // deltas checked below
    })

    // Stage changes
    const stageChanges = bills.filter(b => {
      // Check if any bill advanced stage recently (from changes data)
      return false  // Will be populated from changes param if available
    })

    // Portfolio health summary
    const highCount = allScores.filter(s => s >= TIER_HIGH).length
    const atRisk    = allScores.filter(s => s < TIER_LOW && s > 0).length

    if (highCount > 0) narrative += highCount + ' bill' + (highCount !== 1 ? 's are' : ' is') + ' in strong position (score 75+). '
    if (atRisk > 0)    narrative += atRisk + ' bill' + (atRisk !== 1 ? 's are' : ' is') + ' at risk of stalling. '
    if (highCount === 0 && atRisk === 0) narrative += n + ' bill' + (n !== 1 ? 's' : '') + ' tracked in your portfolio.'
  }

  // Render narrative paragraph
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(50, 55, 65)

  const wrappedLines = doc.splitTextToSize(narrative, contentW - 4)
  wrappedLines.forEach(line => {
    y = checkPageBreak(doc, y, 5, ph)
    doc.text(line, m + 2, y)
    y += 3.8
  })

  return y + 4
}


/**
 * Option B — Portfolio Overview Table (page 1).
 * One compact row per bill: Bill # | Title | Score | Stage | Trend | Upcoming.
 * Grouped by outcome when multiple outcome types exist in the watchlist.
 */
function drawPortfolioTable(doc, bills, scoreDeltas, changes, y, m, contentW, ph) {
  y = checkPageBreak(doc, y, 14, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...TEAL)
  doc.text('PORTFOLIO OVERVIEW', m, y)
  y += 6

  // Column widths — must sum to contentW (170mm)
  const colBill     = 18
  const colTitle    = 66
  const colScore    = 14
  const colStage    = 34
  const colTrend    = 14
  const colUpcoming = contentW - colBill - colTitle - colScore - colStage - colTrend  // 24

  // Header row
  doc.setFillColor(...SURFACE)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.15)
  doc.rect(m, y - 1, contentW, 6, 'FD')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...GRAY)
  let hx = m + 1.5
  const hy = y + 3.2
  ;[
    ['BILL #', colBill], ['TITLE', colTitle], ['SCORE', colScore],
    ['STAGE', colStage], ['TREND', colTrend], ['UPCOMING', colUpcoming],
  ].forEach(([label, w]) => { doc.text(label, hx, hy); hx += w })
  y += 7

  if (bills.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text('No bills tracked.', m + 2, y + 4)
    return y + 10
  }

  const groups = groupBills(bills)
  const showGroupLabels = groups.length > 1
  const rowH = 7.5

  groups.forEach(group => {
    // Group label row (only when multiple outcome types)
    if (showGroupLabels) {
      y = checkPageBreak(doc, y, rowH + 3, ph)
      doc.setFillColor(240, 240, 238)
      doc.setDrawColor(...LGRAY)
      doc.setLineWidth(0.1)
      doc.rect(m, y - 0.5, contentW, 5.5, 'FD')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6.5)
      doc.setTextColor(...group.color)
      doc.text(group.label.toUpperCase() + '  (' + group.bills.length + ')', m + 2.5, y + 3.2)
      y += 6.5
    }

    group.bills.forEach((tracked, i) => {
      y = checkPageBreak(doc, y, rowH + 1, ph)
      const bill = tracked.bills || {}
      const billId = tracked.bill_id
      const score = bill.final_score || 0
      const scoreColor = getScoreColor(score)
      const billLbl = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
      const title = getBillTitle(bill)
      const stageTxt = getStagePlainText(bill)
      const delta = scoreDeltas[billId] || 0
      const cl = (bill.confidence_label || '').toUpperCase()
      const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'

      // Alternating row background
      doc.setFillColor(...(i % 2 === 0 ? SURFACE : WHITE))
      doc.setDrawColor(...LGRAY)
      doc.setLineWidth(0.1)
      doc.rect(m, y - 0.5, contentW, rowH, 'FD')

      // Outcome-color strip on left edge
      doc.setFillColor(...getOutcomeColor(bill))
      doc.rect(m, y - 0.5, 1.5, rowH, 'F')

      const rowTextY = y + rowH / 2 + 1.2
      let rx = m + 3

      // Bill #
      doc.setFont('courier', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...FOREST)
      doc.text(billLbl, rx, rowTextY)
      rx += colBill

      // Title (truncated to fit column)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(30, 35, 45)
      let titleFit = title
      while (doc.getTextWidth(titleFit) > colTitle - 3 && titleFit.length > 10) {
        titleFit = titleFit.slice(0, -1)
      }
      if (titleFit !== title) titleFit = titleFit.slice(0, -1) + '...'
      doc.text(titleFit, rx, rowTextY)
      rx += colTitle

      // Score (colored number)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...scoreColor)
      doc.text(String(score), rx, rowTextY)
      rx += colScore

      // Stage (truncated)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...GRAY)
      let stageFit = stageTxt
      while (doc.getTextWidth(stageFit) > colStage - 2 && stageFit.length > 8) {
        stageFit = stageFit.slice(0, -1)
      }
      if (stageFit !== stageTxt) stageFit = stageFit.slice(0, -1) + '...'
      doc.text(stageFit, rx, rowTextY)
      rx += colStage

      // Trend (delta with +/-  or "final" for terminal bills)
      if (!isTerminal) {
        const trendColor = delta > 0 ? TEAL : delta < 0 ? RED : GRAY
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(7.5)
        doc.setTextColor(...trendColor)
        doc.text(delta !== 0 ? (delta > 0 ? '+' : '') + delta : '--', rx, rowTextY)
      } else {
        doc.setFont('helvetica', 'italic')
        doc.setFontSize(6.5)
        doc.setTextColor(...MUTED)
        doc.text('final', rx, rowTextY)
      }
      rx += colTrend

      // Upcoming: hearing within 21 days, or cutoff days ≤21
      if (!isTerminal && !isInterimPeriod()) {
        let upcomingTxt = ''
        if (bill.hearing_date) {
          try {
            const hDays = daysUntil(bill.hearing_date)
            if (hDays > 0 && hDays <= 21) {
              const hLbl = new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              upcomingTxt = 'Hear ' + hLbl
            }
          } catch (e) {}
        } else if (bill.days_to_cutoff != null && bill.days_to_cutoff > 0 && bill.days_to_cutoff <= 21) {
          upcomingTxt = 'Cutoff ' + bill.days_to_cutoff + 'd'
        }
        if (upcomingTxt) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6.5)
          doc.setTextColor(...RUST)
          doc.text(upcomingTxt, rx, rowTextY)
        }
      }

      y += rowH
    })
    y += 2
  })

  return y + 4
}


/**
 * Option B — Expanded Half-Page Bill Intelligence Card (pages 2+).
 * Score box, status pill, AI summary (up to 6 lines), sponsor/committee,
 * companion, analyst notes, what-to-watch flag, and trend line per bill.
 * Approximately 2 cards per A4 page. Adapted from generate-public-pdf.js.
 */
function drawExpandedBillCard(doc, tracked, scoreDeltas, changes, y, m, contentW, ph, billNotes, amendments = [], fiscalHistory = []) {
  const bill = tracked.bills || {}
  const billId = tracked.bill_id
  const score = bill.final_score || 0
  const scoreColor = getScoreColor(score)
  const borderColor = getOutcomeColor(bill)
  const billLbl = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
  const title = getBillTitle(bill)
  const stageLine = getStagePlainText(bill)
  const delta = scoreDeltas[billId] || 0
  const cl = (bill.confidence_label || '').toUpperCase()
  const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'
  const tag = tracked.tag || ''
  const tierLabel = bill.confidence_label || getScoreTierLabel(score)

  // Pre-compute summary — strip markdown headers and bold markers
  const rawSummary = (bill.custom_summary || bill.ai_summary || '').trim()
  const cleanSummary = rawSummary
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join(' ')
    .replace(/\*\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const cardContentW = contentW - 10
  const allSummaryLines = cleanSummary ? doc.splitTextToSize(cleanSummary, cardContentW) : []
  const summaryTruncated = allSummaryLines.length > MAX_SUMMARY_LINES
  const summaryLines = summaryTruncated ? allSummaryLines.slice(0, MAX_SUMMARY_LINES) : allSummaryLines

  // Analyst notes (shared-visibility only)
  const sharedNotes = (billNotes || []).filter(n => n.bill_id === billId && n.visibility === 'shared')
  const noteWrapped = sharedNotes.map(n => {
    const dateLine = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const bodyLines = doc.splitTextToSize(n.body, cardContentW - 4)
    return { dateLine, bodyLines }
  })

  // Companion line
  const companionLine = getCompanionLine(bill)

  // What to Watch items (active bills during session only)
  const watchItems = []
  if (!isTerminal && !isInterimPeriod()) {
    if (bill.hearing_date) {
      try {
        const h = new Date(bill.hearing_date)
        const days = Math.ceil((h - new Date()) / 86400000)
        const lbl = h.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
        if (days > 0 && days <= 21) watchItems.push('Hearing: ' + lbl + (days <= 14 ? ' (' + days + ' days)' : ''))
      } catch (e) {}
    }
    if (bill.days_to_cutoff != null && bill.days_to_cutoff > 0 && bill.days_to_cutoff <= 21) {
      watchItems.push('Cutoff in ' + bill.days_to_cutoff + ' day' + (bill.days_to_cutoff !== 1 ? 's' : ''))
    }
  }

  // Delta/trend narrative
  const deltaText = getDeltaNarrative(billId, bill, scoreDeltas, changes)

  // Score one-liner interpretation (adapted from generate-public-pdf.js)
  const oneLiner = (() => {
    if (cl === 'LAW') return 'Signed into law -- outcome final.'
    if (cl === 'DEAD') return 'Did not advance -- session ended without passage.'
    if (cl === 'PASSED_CHAMBER') {
      if (isPostBienniumClose()) return 'Did not pass this biennium -- must be refiled to advance.'
      return 'Passed its first chamber -- carries into the next session.'
    }
    if (score >= TIER_HIGH)     return 'Strong forward movement -- ~84% of bills in this band become law.'
    if (score >= TIER_MODERATE) return 'Moderate momentum -- viable path to passage with active committee work.'
    if (score >= TIER_LOW)      return 'Limited movement -- needs a sponsor push or hearing to gain ground.'
    return 'Very limited momentum -- most bills in this band do not advance this session.'
  })()

  // ── Height pre-calculation ──────────────────────────────────────
  const lineH = 3.8
  const titleH = Math.min(doc.splitTextToSize(title, cardContentW).length, 2) * 4.5
  const summaryH = summaryLines.length > 0
    ? 3 + summaryLines.length * lineH + (summaryTruncated ? 2.5 : 0) + (isInterimPeriod() ? 3 : 0)
    : 0
  const notesH = sharedNotes.length > 0
    ? 7 + noteWrapped.reduce((h, n) => h + 3 + n.bodyLines.length * 3.2 + 2, 0)
    : 0
  const watchH = watchItems.length > 0 ? 5 + watchItems.length * 4.5 : 0

  const cardH = 4             // top padding
    + 5                       // bill # line
    + titleH                  // title (1-2 lines)
    + 2                       // pre-score gap
    + 18                      // score box
    + 13                      // status pill + gap
    + summaryH                // summary section
    + ((bill.prime_sponsor || bill.committee_name) ? 6 : 0)
    + (companionLine ? 5 : 0)
    + notesH
    + watchH
    + (deltaText ? 5 : 0)
    + 4                       // bottom padding

  // Page break — allow mid-card break only if card is very tall
  y = checkPageBreak(doc, y, Math.min(cardH, ph - 60), ph)

  // ── Card shell ─────────────────────────────────────────────────
  doc.setFillColor(...SURFACE)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, contentW, cardH, 2.5, 2.5, 'FD')

  // Outcome-color left strip
  doc.setFillColor(...borderColor)
  doc.rect(m + 0.3, y + 2.5, 2.5, cardH - 5, 'F')

  const cx = m + 6
  let cy = y + 4

  // ── Bill # + tag ─────────────────────────────────────────────────
  doc.setFont('courier', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...FOREST)
  doc.text(billLbl, cx, cy)
  if (tag) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...TEAL)
    doc.text(tag.toUpperCase(), m + contentW - 5, cy, { align: 'right' })
  }
  cy += 5

  // ── Title (max 2 lines) ──────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(25, 30, 40)
  doc.splitTextToSize(title, cardContentW).slice(0, 2).forEach(line => {
    doc.text(line, cx, cy)
    cy += 4.5
  })
  cy += 2

  // ── Score Box (full-width, 18mm tall) ───────────────────────────
  const sbH = 18
  doc.setFillColor(250, 249, 247)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.15)
  doc.roundedRect(cx - 2, cy, contentW - 8, sbH, 1.5, 1.5, 'FD')

  // Left: large score number + /100 + tier label
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...scoreColor)
  const scoreNumStr = String(score)
  const scoreNumW = doc.getTextWidth(scoreNumStr)
  doc.text(scoreNumStr, cx + 2, cy + 13)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...GRAY)
  doc.text('/100', cx + 2 + scoreNumW + 1, cy + 13)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...scoreColor)
  doc.text(String(tierLabel).toUpperCase(), cx + 2, cy + 17)

  // Right: label + one-liner interpretation
  const olX = cx + 30
  const olW = contentW - 8 - 30 - 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(6.5)
  doc.setTextColor(...GRAY)
  doc.text('TRAJECTORY SCORE', olX, cy + 5)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...FOREST)
  doc.splitTextToSize(oneLiner, olW).slice(0, 2).forEach((line, i) => {
    doc.text(line, olX, cy + 10 + i * 4)
  })
  cy += sbH + 3

  // ── Status Pill ──────────────────────────────────────────────────
  const pillW = contentW - 8
  doc.setFillColor(250, 249, 247)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.2)
  doc.roundedRect(cx - 2, cy, pillW, 9, 1.5, 1.5, 'FD')
  doc.setFillColor(...borderColor)
  doc.rect(cx - 2, cy, 2.5, 9, 'F')

  let statusTxt = stageLine
  if (!isTerminal && !isInterimPeriod()) {
    if (bill.hearing_date) {
      try {
        const h = new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        statusTxt += '  ·  Hearing ' + h
      } catch (e) {}
    } else if (bill.days_to_cutoff != null && bill.days_to_cutoff > 0) {
      statusTxt += '  ·  ' + bill.days_to_cutoff + ' days to cutoff'
    }
  } else if (isTerminal && bill.last_action_date) {
    try {
      const d = formatSessionDate(bill.last_action_date)
      if (d && d !== 'session dates TBD') statusTxt += '  ·  ' + d
    } catch (e) {}
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...FOREST)
  doc.text(statusTxt, cx + 3, cy + 5.8)
  cy += 13

  // ── AI Summary (up to 6 lines) ───────────────────────────────────
  if (summaryLines.length > 0) {
    const aiLabel = bill.custom_summary ? 'AI-GENERATED + EDITED' : 'AI-GENERATED SUMMARY'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...TEAL)
    doc.text(aiLabel, cx, cy)
    cy += 2.5
    if (isInterimPeriod()) {
      doc.setFont('helvetica', 'bolditalic')
      doc.setFontSize(6)
      doc.setTextColor(140, 145, 155)
      doc.text('Summary as of session end:', cx, cy)
      cy += 3
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(70, 75, 85)
    summaryLines.forEach(line => {
      cy = checkPageBreak(doc, cy, lineH + 1, ph)
      doc.text(line, cx, cy)
      cy += lineH
    })
    if (summaryTruncated) {
      doc.setFontSize(6)
      doc.setTextColor(150, 155, 165)
      doc.text('[summary continues -- see vectorwa.com]', cx, cy)
      cy += 2.5
    }
    cy += 1
  }

  // ── Sponsor + Committee (compact one-liner) ──────────────────────
  if (bill.prime_sponsor || bill.committee_name) {
    const sponsorParts = []
    if (bill.prime_sponsor) {
      const party = (bill.prime_party || '').charAt(0).toUpperCase()
      sponsorParts.push((bill.chamber === 'House' ? 'Rep.' : 'Sen.') + ' ' + bill.prime_sponsor + (party ? ' (' + party + ')' : ''))
    }
    if (bill.committee_name) sponsorParts.push(bill.committee_name)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(sponsorParts.join('  ·  '), cx, cy)
    cy += 6
  }

  // ── Companion line ───────────────────────────────────────────────
  if (companionLine) {
    const forked = bill.companion_state === 'forked'
    doc.setFont('helvetica', forked ? 'bold' : 'italic')
    doc.setFontSize(6.5)
    doc.setTextColor(...(forked ? RED : GRAY))
    doc.text(companionLine, cx, cy)
    cy += 5
  }

  // ── Analyst Notes ────────────────────────────────────────────────
  if (sharedNotes.length > 0) {
    cy += 1
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.25)
    doc.line(cx, cy, cx + 30, cy)
    cy += 2.5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...GOLD)
    doc.text('ANALYST NOTE', cx, cy)
    cy += 2.5
    noteWrapped.forEach(({ dateLine, bodyLines }) => {
      cy = checkPageBreak(doc, cy, 8, ph)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(6)
      doc.setTextColor(...MUTED)
      doc.text(dateLine, cx + 2, cy)
      cy += 3
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...FOREST)
      bodyLines.forEach(line => { doc.text(line, cx + 2, cy); cy += 3.2 })
      cy += 2
    })
  }

  // ── What to Watch ────────────────────────────────────────────────
  if (watchItems.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...RUST)
    doc.text('WATCH:', cx, cy)
    cy += 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...FOREST)
    watchItems.forEach(item => {
      doc.text('> ' + item, cx + 2, cy)
      cy += 4.5
    })
  }

  // ── Trend / Movement line ────────────────────────────────────────
  if (deltaText) {
    const deltaColor = delta > 0 ? TEAL : delta < 0 ? RED : GRAY
    doc.setFont('helvetica', delta !== 0 ? 'bold' : 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...deltaColor)
    doc.text('Movement: ' + deltaText, cx, cy)
    cy += 5
  }

  return y + cardH + 4  // 4mm gap between cards
}


/**
 * 6M.3 — What to Watch Section
 * During active session: upcoming hearings, cutoff deadlines, action items.
 * During interim: key dates ahead (pre-filing, next session).
 */
function drawWhatToWatch(doc, y, pw, m, contentW, ph, bills) {
  const interim = isInterimPeriod()

  // Build items list
  const items = []

  if (interim) {
    const next = getNextBiennium()
    if (next.prefilingOpens) {
      const pfDays = daysUntil(next.prefilingOpens)
      if (pfDays > 0) {
        items.push('Pre-filing opens: ' + formatSessionDate(next.prefilingOpens))
      } else {
        items.push('Pre-filing is now open for the ' + next.session + ' session')
      }
    }
    if (daysUntil(next.start) > 0) {
      items.push('Next session begins: ' + formatSessionDate(next.start))
    }

    const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'PASSED_CHAMBER').length
    if (carryCount > 0) {
      items.push(carryCount + ' bill' + (carryCount !== 1 ? 's' : '') + ' passed ' +
        (carryCount === 1 ? 'its' : 'their') + ' chamber and will carry into the new session automatically')
    }
  } else {
    // Active session — approaching cutoffs
    const cutoffs = getSessionCutoffs().filter(c => !c.passed && c.daysLeft <= 21)
    cutoffs.forEach(c => {
      items.push(c.label + ': ' + c.dateFormatted + ' (' + c.daysLeft + ' days)')
    })

    // Bills with upcoming hearings
    bills.forEach(tracked => {
      const bill = tracked.bills || {}
      if (bill.hearing_date) {
        const hDays = daysUntil(bill.hearing_date)
        if (hDays > 0 && hDays <= 14) {
          const label = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
          items.push(label + ' has a hearing ' + formatSessionDate(bill.hearing_date))
        }
      }
    })

    // Bills at risk of missing cutoff
    const atRiskBills = bills.filter(b => {
      const bill = b.bills || {}
      return (bill.stage || 1) <= 2 && (bill.final_score || 0) < TIER_LOW && !(bill.confidence_label || '').match(/DEAD|LAW/i)
    })
    if (atRiskBills.length > 0 && cutoffs.length > 0) {
      items.push(atRiskBills.length + ' bill' + (atRiskBills.length !== 1 ? 's have' : ' has') +
        ' not yet passed committee -- monitor closely')
    }

    if (items.length === 0) {
      items.push('No imminent deadlines or hearings for tracked bills')
    }
  }

  // Calculate space needed
  const sectionH = 6 + (items.length * 5) + 4
  y = checkPageBreak(doc, y, sectionH, ph)

  // Section header
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...TEAL)
  doc.text(interim ? 'KEY DATES AHEAD' : 'WHAT TO WATCH THIS WEEK', m, y)
  y += 5

  // Items
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(50, 55, 65)

  items.forEach(item => {
    y = checkPageBreak(doc, y, 5, ph)
    doc.text('> ' + item, m + 3, y)
    y += 4.5
  })

  return y + 4
}


// ═══════════════════════════════════════════════════════════════
// MAIN PDF GENERATOR
// ═══════════════════════════════════════════════════════════════

export async function generateBriefPDF({ tagLabel, date, bills, scoreDeltas, changes, session, billNotes, amendments = [], fiscalHistory = [], cohortStats = null }) {
  // cohortStats: { total, biennia, ok } from app/lib/app-stats.js fetchTotalScoredBills().
  // Used to build the live methodology footnote at the bottom of the last page.
  // Falls back to the original calibration cohort (N=8,062 across 3 WA biennia,
  // 2021-2026) when null or ok === false.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()   // 210
  const ph = doc.internal.pageSize.getHeight()   // 297
  const m  = 20  // margin
  const contentW = pw - 2 * m  // usable width = 170
  let y = 16

  /* ================================================================
     HEADER (Vector | WA wordmark + tagline, inline vector mark)
     Brand v1.2 §02 — Brass V with Brass-Light arrow tip; no raster
     logo so the brief renders even if a logo file is missing.
     ================================================================ */

  {
    // Official primary SVG logo — same rasterization technique as the
    // single-bill public brief (generate-public-pdf.js). Repaint the
    // wordmark fill from parchment (#ebeae4) to Dark Neutral (#0e1014)
    // so it reads on the white PDF page. Gold arc stays untouched.
    const logoH = 22
    const logoW = logoH * (895 / 500)  // SVG natural aspect ratio ~1.79

    let logoDrawn = false
    try {
      const dataUrl = await loadSvgWithFillSwap('/logos/vector-wa-primary.svg', {
        '#ebeae4': '#0e1014',
      })
      if (dataUrl) {
        doc.addImage(dataUrl, 'PNG', m, y - 1, logoW, logoH)
        logoDrawn = true
      }
    } catch (e) { /* fall through to text fallback */ }

    if (!logoDrawn) {
      // Text fallback when SVG cannot load (offline, dev, etc.)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(16)
      doc.setTextColor(...PRIMARY)
      doc.text('VECTOR | WA', m, y + 12)
    }

    // Right side: report label + date (matches single-bill brief right column)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...TMUTED)
    doc.text('LEGISLATIVE INTELLIGENCE BRIEF', pw - m, y + 6, { align: 'right' })

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(date, pw - m, y + 11, { align: 'right' })

    y += logoH
  }

  // Thin separator
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.3)
  doc.line(m, y, pw - m, y)
  y += 6

  /* ================================================================
     TAG / SCOPE INFO
     ================================================================ */

  if (tagLabel) {
    // 6M.8 — Prominent scope label with teal accent bar
    doc.setFillColor(...SURFACE)
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.3)
    doc.roundedRect(m, y - 3, contentW, 14, 1.5, 1.5, 'FD')
    doc.setFillColor(...TEAL)
    doc.rect(m, y - 3, 2.5, 14, 'F')  // left accent

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text('Filtered by tag', m + 6, y + 1)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...FOREST)
    doc.text(tagLabel, m + 6, y + 8)

    y += 15
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...FOREST)
    doc.text('Full Portfolio Report', m, y)
    y += 6
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(date, m, y)
  if (session) {
    doc.text('Session: ' + session, m + 55, y)
  }
  y += 8

  /* ================================================================
     6M.4 — SESSION CONTEXT BAR
     ================================================================ */

  y = drawSessionContextBar(doc, y, pw, m, contentW)

  /* ================================================================
     6M.1 — EXECUTIVE SUMMARY
     ================================================================ */

  y = drawExecutiveSummary(doc, y, pw, m, contentW, ph, bills)

  /* ================================================================
     PORTFOLIO OVERVIEW TABLE (page 1)
     ================================================================ */

  y = drawPortfolioTable(doc, bills, scoreDeltas, changes, y, m, contentW, ph)

  /* ================================================================
     BILL INTELLIGENCE CARDS (expanded half-page per bill, pages 2+)
     ================================================================ */

  y = checkPageBreak(doc, y, 12, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...FOREST)
  doc.text('BILL INTELLIGENCE', m, y)
  y += 6

  if (bills.length === 0) {
    y = checkPageBreak(doc, y, 12, ph)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(...GRAY)
    doc.text('No bills are currently tracked. Add bills from the Search page to see them here.', m + 2, y)
    y += 8
  } else {
    const groups = groupBills(bills)
    const showGroupHeaders = groups.length > 1

    groups.forEach(group => {
      if (showGroupHeaders) {
        y = drawGroupHeader(doc, group, y, m, contentW, ph)
      }
      group.bills.forEach(tracked => {
        y = drawExpandedBillCard(doc, tracked, scoreDeltas, changes, y, m, contentW, ph, billNotes || [], amendments, fiscalHistory)
      })
      y += 2
    })
  }

  y += 2

  /* ================================================================
     6M.3 — WHAT TO WATCH
     ================================================================ */

  y = drawWhatToWatch(doc, y, pw, m, contentW, ph, bills)

  /* ================================================================
     6M.6 — COMPACT METHODOLOGY (pinned above footer on last page)
     Drawn later in the per-page footer loop so it sits above the
     footer line on the final page only.
     ================================================================ */

  /* ================================================================
     6M.7 — FOOTER (every page) + CONTINUATION HEADER (pages 2+)
     ================================================================ */

  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)

    // ── Continuation header on pages 2+ ──
    if (p > 1) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...PRIMARY)
      doc.text('VECTOR | WA', m, 14)
      // Tag label on continuation pages (if present)
      if (tagLabel) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...GRAY)
        doc.text('Tag: ' + tagLabel, pw - m, 14, { align: 'right' })
      }
      // Thin line below header
      doc.setDrawColor(...LGRAY)
      doc.setLineWidth(0.2)
      doc.line(m, 18, pw - m, 18)
    }

    // ── Methodology (last page only, above footer) ──
    if (p === pageCount) {
      const methY = ph - 24
      doc.setDrawColor(...LGRAY)
      doc.setLineWidth(0.15)
      doc.line(m, methY, pw - m, methY)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...GRAY)
      // DATA_FRESHNESS #22: cohort total + biennium span are live when the
      // caller passes cohortStats. Fallback matches original engine cohort.
      let calibBlurb = 'Trajectory scores (0-99) calibrated against 8,062 bills across 3 WA biennia (2021-2026). 75+ = 84% became law.'
      if (cohortStats && cohortStats.ok && cohortStats.total > 0 && cohortStats.biennia && cohortStats.biennia.length > 0) {
        const n = cohortStats.total.toLocaleString()
        const bCount = cohortStats.biennia.length
        const firstYear = cohortStats.biennia[0].split('-')[0]
        const lastParts = cohortStats.biennia[cohortStats.biennia.length - 1].split('-')
        const lastYear = lastParts[lastParts.length - 1]
        calibBlurb = `Trajectory scores (0-99) calibrated against ${n} bills across ${bCount} WA biennia (${firstYear}-${lastYear}). 75+ = 84% became law.`
      }
      doc.text(calibBlurb, m, methY + 3.5)
      doc.text('Signal tiers: HIGH (75+), MODERATE (60-74), LOW (45-59), VERY LOW (<45). Full methodology: vectorwa.com/methodology', m, methY + 7)
    }

    // ── Footer ──
    const fy = ph - 12
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.4)
    doc.line(m, fy, pw - m, fy)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text('Vector | WA — Washington State legislative intelligence', m, fy + 5)
    doc.text('vectorwa.com', pw - m, fy + 5, { align: 'right' })

    if (pageCount > 1) {
      doc.setFontSize(6.5)
      doc.text('Page ' + p + ' of ' + pageCount, pw / 2, fy + 5, { align: 'center' })
    }
  }

  /* ================================================================
     SAVE
     ================================================================ */

  const safeName = (tagLabel || 'Portfolio').replace(/[^a-zA-Z0-9]/g, '_')
  const safeDate = date.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = 'Vector_WA_Brief_' + safeName + '_' + safeDate + '.pdf'

  doc.save(filename)
  return filename
}
