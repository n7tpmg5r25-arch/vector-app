/**
 * Vector | WA — Client PDF Intelligence Brief Generator
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
  isInterimPeriod, getCurrentBiennium, getNextBiennium,
  getSessionCutoffs, formatSessionDate, daysUntil,
} from './session-config'

// ── Stage labels (index = stage number from DB) ──────────────
const STAGE_LABELS = ['', 'Introduced', 'Committee', 'Passed Committee', 'Passed Floor', 'Conference', 'Signed into Law']

// ── Summary truncation limit (max lines in PDF card) ────────
const MAX_SUMMARY_LINES = 3

// ── Brand colors (RGB arrays) ────────────────────────────────
const NAVY  = [26, 74, 46]       // Forest #1a4a2e (firm brand v3.1 sec 14)
const TEAL  = [45, 107, 69]      // Forest Mid (Shorepine #2d6b45)
const GOLD  = [184, 151, 90]     // Brass (Shorepine #b8975a)
const GRAY  = [74, 80, 96]       // Slate (Shorepine #4a5060)
const LGRAY = [220, 212, 196]    // Parchment stroke (Shorepine)
const WHITE = [255, 255, 255]
const RED   = [196, 71, 48]      // Ember (Shorepine #c44730)
const MUTED = [138, 128, 112]    // Stone (Shorepine #8a8070)

// ── Score tier thresholds (match ScoreBadge from 6L.1) ───────
const TIER_HIGH     = 75
const TIER_MODERATE = 60
const TIER_LOW      = 45

function getScoreColor(score) {
  if (score >= TIER_HIGH)     return TEAL
  if (score >= TIER_MODERATE) return [58, 122, 138]  // Deep Teal (Shorepine)
  if (score >= TIER_LOW)      return GOLD
  return MUTED
}

function getScoreTierLabel(score) {
  if (score >= TIER_HIGH)     return 'HIGH'
  if (score >= TIER_MODERATE) return 'MODERATE'
  if (score >= TIER_LOW)      return 'LOW'
  return 'VERY LOW'
}

// Card border color based on outcome
function getOutcomeColor(bill) {
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')        return TEAL
  if (cl === 'CARRY OVER') return GOLD
  if (cl === 'DEAD')       return [138, 128, 112]
  // Active bill — use score color
  return getScoreColor(bill.final_score || 0)
}

// ── Helpers ──────────────────────────────────────────────────

/** Load image from URL as base64 data URL. Returns null on failure. */
function loadImageAsBase64(url) {
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

/** Display-ready bill title with fallback. */
function getBillTitle(bill) {
  const title = (bill.title || '').trim()
  if (!title) return bill.committee_name || 'Bill ' + bill.bill_number
  if (title === title.toUpperCase() && title.length < 40 && !/RELAT|CONCERN|PROVID|CREAT|AMEND|REPEAL/.test(title)) {
    return bill.committee_name || 'Bill ' + bill.bill_number
  }
  return title
}

/** Plain-English stage description. */
function getStagePlainText(bill) {
  const s = bill.stage || 1
  const chamber = bill.chamber || 'House'
  const cmte = bill.committee_name || ''

  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')  return 'Signed into law'
  if (cl === 'DEAD') return 'Did not advance — session ended'
  if (cl === 'CARRY OVER') return 'Passed ' + chamber + ' — carries to next session'

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
  if (cl === 'DEAD' || cl === 'LAW' || cl === 'CARRY OVER') return ''

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

/**
 * Check if we need a new page. If so, add one and return reset y.
 * @param {jsPDF} doc
 * @param {number} y - current y position
 * @param {number} needed - vertical space needed (mm)
 * @param {number} ph - page height
 * @returns {number} new y position
 */
function checkPageBreak(doc, y, needed, ph) {
  const footerReserve = 30  // keep clear of methodology + footer area on last page
  if (y + needed > ph - footerReserve) {
    doc.addPage()
    return 28  // top margin on continuation pages (leaves room for repeated header)
  }
  return y
}


// ── Bill grouping ───────────────────────────────────────────
// Groups: Signed into Law → Active (by score desc) → Passed Chamber → Did Not Advance

const GROUP_ORDER = ['LAW', 'ACTIVE', 'CARRY OVER', 'DEAD']
const GROUP_LABELS = {
  'LAW':        'Signed into Law',
  'ACTIVE':     'Active Legislation',
  'CARRY OVER': 'Passed Chamber',
  'DEAD':       'Did Not Advance',
}
const GROUP_COLORS = {
  'LAW':        TEAL,
  'ACTIVE':     NAVY,
  'CARRY OVER': GOLD,
  'DEAD':       GRAY,
}

/**
 * Sort and group bills by outcome, then by score descending within each group.
 * Returns array of { groupKey, label, color, bills[] } with empty groups omitted.
 */
function groupBills(bills) {
  const buckets = { 'LAW': [], 'ACTIVE': [], 'CARRY OVER': [], 'DEAD': [] }

  bills.forEach(tracked => {
    const cl = (tracked.bills?.confidence_label || '').toUpperCase()
    if (cl === 'LAW')             buckets['LAW'].push(tracked)
    else if (cl === 'DEAD')       buckets['DEAD'].push(tracked)
    else if (cl === 'CARRY OVER') buckets['CARRY OVER'].push(tracked)
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
      const pfDays = daysUntil(next.prefilingOpens)
      parts.push('Pre-filing opens ' + formatSessionDate(next.prefilingOpens) +
        (pfDays > 0 ? ' (' + pfDays + ' days)' : ''))
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
  doc.setFillColor(245, 240, 230)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.15)
  doc.roundedRect(m, y, contentW, 9, 1.5, 1.5, 'FD')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...NAVY)
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
    const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'CARRY OVER').length
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
      const pfDays = daysUntil(next.prefilingOpens)
      if (pfDays > 0) {
        narrative += ' Pre-filing for the ' + next.session + ' session opens in ' + pfDays + ' days.'
      }
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
 * 6M.2 — Bill Detail Card
 * Renders one bill card with colored left border, title, summary, score, stage, delta, tag.
 * Returns new y position.
 */
function drawBillCard(doc, tracked, scoreDeltas, changes, y, m, contentW, ph, billNotes, amendments = [], fiscalHistory = []) {
  const bill = tracked.bills || {}
  const billId = tracked.bill_id
  const score = bill.final_score || 0
  const tierLabel = bill.confidence_label || getScoreTierLabel(score)
  const borderColor = getOutcomeColor(bill)
  const title = getBillTitle(bill)
  // Clean AI summary: strip markdown headers and leading whitespace per line
  const rawSummary = (bill.ai_summary || '').trim()
  const summary = rawSummary
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))   // remove markdown headers
    .join(' ')
    .replace(/\s{2,}/g, ' ')                        // collapse extra whitespace
    .trim()
  const tag = tracked.client_tag || ''
  const billLabel = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
  const stageLine = getStagePlainText(bill)
  const deltaText = getDeltaNarrative(billId, bill, scoreDeltas, changes)
  const delta = scoreDeltas[billId] || 0
  // Phase 7W.3: companion status line (null if no companion)
  const companionLine = getCompanionLine(bill)

  // Phase 7S: client-visible analyst notes for this bill
  const clientNotes = (billNotes || []).filter(n => n.bill_id === tracked.bill_id && n.visibility === 'client')

  // Pre-calculate wrapped text heights
  const cardContentW = contentW - 10  // 5mm left border area + 5mm right padding
  const titleLines = doc.splitTextToSize(title, cardContentW)
  const allSummaryLines = summary ? doc.splitTextToSize(summary, cardContentW) : []
  // Truncate long summaries to keep cards compact
  const summaryTruncated = allSummaryLines.length > MAX_SUMMARY_LINES
  const summaryLines = summaryTruncated ? allSummaryLines.slice(0, MAX_SUMMARY_LINES) : allSummaryLines

  // Card height calculation
  const lineH = 3.5
  const titleH = titleLines.length * 4
  const summaryInterimCaveat = (summaryLines.length > 0 && isInterimPeriod()) ? 3 : 0
  const truncIndicatorH = summaryTruncated ? 2.5 : 0
  const summaryH = summaryLines.length > 0 ? (summaryLines.length * lineH) + 2 + summaryInterimCaveat + truncIndicatorH : 0
  const companionH = companionLine ? 3.5 : 0  // Phase 7W.3

  // Phase 7S: pre-wrap analyst note lines
  const analystNoteWrapped = clientNotes.map(n => {
    const dateLine = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const bodyLines = doc.splitTextToSize(n.body, cardContentW - 4)
    return { dateLine, bodyLines }
  })
  // Height: 4 (label + rule) + per note (3 date + bodyLines * 3.2 + 2 gap)
  const analystNotesH = clientNotes.length > 0
    ? 5 + analystNoteWrapped.reduce((h, n) => h + 3 + (n.bodyLines.length * 3.2) + 2, 0)
    : 0

  // Phase 10.5: Recent Activity line — compact summary of amendments + fiscal changes
  const billAmendments = amendments.filter(a => a.bill_id === tracked.bill_id)
  const billFiscal = fiscalHistory.filter(f => f.bill_id === tracked.bill_id)
  let activityParts = []
  if (billAmendments.length > 0) {
    const adopted = billAmendments.filter(a => a.adopted).length
    activityParts.push(billAmendments.length + ' amendment' + (billAmendments.length !== 1 ? 's' : '') +
      (adopted > 0 ? ' (' + adopted + ' adopted)' : ''))
  }
  if (billFiscal.length > 0) {
    const latest = billFiscal.sort((a, b) => (b.detected_date || '').localeCompare(a.detected_date || ''))[0]
    activityParts.push('Fiscal note ' + (latest.new_size || 'updated') +
      (latest.detected_date ? ' ' + latest.detected_date : ''))
  }
  const activityLine = activityParts.join(' | ')
  const activityH = activityLine ? 3.5 : 0

  const cardH = 5 +         // top padding
                5 +         // bill number + score line
                titleH +    // title lines
                summaryH +  // AI summary (if present)
                companionH + // Phase 7W.3 companion line (if present)
                analystNotesH + // Phase 7S analyst notes (if present)
                activityH + // Phase 10.5 recent activity (if present)
                4 +         // stage + delta line
                (tag ? 4 : 0) +  // tag line (if present)
                3           // bottom padding

  // Page break check
  y = checkPageBreak(doc, y, cardH + 2, ph)

  // Card background
  doc.setFillColor(250, 246, 238)
  doc.setDrawColor(220, 212, 196)
  doc.setLineWidth(0.15)
  doc.roundedRect(m, y, contentW, cardH, 2, 2, 'FD')

  // Left color border (2mm wide strip, inset to stay inside rounded corners)
  doc.setFillColor(...borderColor)
  doc.rect(m + 0.3, y + 2, 2, cardH - 4, 'F')

  const cx = m + 6  // content start x (after border + padding)
  let cy = y + 5    // content start y (top padding)

  // ── Line 1: Bill number + Score badge + Tier ──
  doc.setFont('courier', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...NAVY)
  doc.text(billLabel, cx, cy)

  // Score indicator (right side)
  const scoreStr = String(score)
  const tierStr = tierLabel.toUpperCase()
  const scoreX = m + contentW - 6
  const scoreColor = getScoreColor(score)

  // Score circle
  doc.setFillColor(...scoreColor)
  const circleX = scoreX - doc.getTextWidth(scoreStr + '  ' + tierStr) - 4
  doc.circle(circleX, cy - 1.2, 1.5, 'F')

  // Score number
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...scoreColor)
  doc.text(scoreStr, circleX + 3, cy)

  // Tier label
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  const scoreNumW = doc.getTextWidth(scoreStr)
  doc.text(tierStr, circleX + 3 + scoreNumW + 2, cy)

  cy += 5

  // ── Title (may wrap to 2 lines) ──
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(30, 35, 45)
  titleLines.forEach(line => {
    doc.text(line, cx, cy)
    cy += 4
  })

  // ── AI Summary (smaller, gray, with caveat during interim) ──
  if (summaryLines.length > 0) {
    cy += 1
    const interim = isInterimPeriod()
    if (interim) {
      doc.setFont('helvetica', 'bolditalic')
      doc.setFontSize(6.5)
      doc.setTextColor(140, 145, 155)
      doc.text('Summary as of session:', cx, cy)
      cy += 3
    }
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(90, 95, 105)
    summaryLines.forEach(line => {
      doc.text(line, cx, cy)
      cy += lineH
    })
    if (summaryTruncated) {
      doc.setFontSize(6)
      doc.setTextColor(150, 155, 165)
      doc.text('[...]', cx, cy)
      cy += 2.5
    }
    cy += 1
  }

  // ── Phase 7W.3: Companion line ──
  if (companionLine) {
    // Tone-color the divergence case (forked) so the page reader notices it
    const forked = bill.companion_state === 'forked'
    doc.setFont('helvetica', forked ? 'bold' : 'italic')
    doc.setFontSize(6.5)
    if (forked) {
      doc.setTextColor(170, 80, 60)  // muted red
    } else {
      doc.setTextColor(110, 115, 125)
    }
    doc.text(companionLine, cx, cy)
    cy += 3.5
  }

  // ── Phase 7S: Analyst Note blocks (client-visible only) ──
  if (clientNotes.length > 0) {
    cy += 1
    // Forest rule line
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.3)
    doc.line(cx, cy, cx + 30, cy)
    cy += 3
    // "Analyst Note" label in Brass
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(6.5)
    doc.setTextColor(...GOLD)
    doc.text('Analyst Note', cx, cy)
    cy += 1

    analystNoteWrapped.forEach(({ dateLine, bodyLines }) => {
      cy += 2
      // Date stamp (small, muted)
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(6)
      doc.setTextColor(...MUTED)
      doc.text(dateLine, cx + 2, cy)
      cy += 3
      // Note body in Forest on Parchment
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...NAVY)
      bodyLines.forEach(line => {
        doc.text(line, cx + 2, cy)
        cy += 3.2
      })
    })
  }

  // ── Phase 10.5: Recent Activity line ──
  if (activityLine) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    doc.setTextColor(...GOLD)
    doc.text(activityLine, cx, cy)
    cy += 3.5
  }

  // ── Stage + Delta ──
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(70, 75, 85)
  doc.text(stageLine, cx, cy)

  // Delta (right-aligned, only shown for active bills — terminal bills already covered by stageLine)
  if (deltaText) {
    const deltaColor = delta > 0 ? TEAL : delta < 0 ? RED : GRAY
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...deltaColor)
    doc.text(deltaText, m + contentW - 6, cy, { align: 'right' })
  }
  cy += 4

  // ── Client tag (if present) ──
  if (tag) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(6.5)
    doc.setTextColor(...GOLD)
    doc.text('Tagged: ' + tag, cx, cy)
    cy += 3.5
  }

  return y + cardH + 3  // 3mm gap between cards
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
        items.push('Pre-filing opens: ' + formatSessionDate(next.prefilingOpens) + ' (' + pfDays + ' days)')
      } else {
        items.push('Pre-filing is now open for the ' + next.session + ' session')
      }
    }
    const nextDays = daysUntil(next.start)
    if (nextDays > 0) {
      items.push('Next session begins: ' + formatSessionDate(next.start) + ' (' + nextDays + ' days)')
    }

    const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'CARRY OVER').length
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

export async function generateClientPDF({ clientName, date, bills, scoreDeltas, changes, session, billNotes, amendments = [], fiscalHistory = [] }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()   // 210
  const ph = doc.internal.pageSize.getHeight()   // 297
  const m  = 20  // margin
  const contentW = pw - 2 * m  // usable width = 170
  let y = 16

  /* ================================================================
     HEADER (with logo)
     ================================================================ */

  const logoData = await loadImageAsBase64('/logo.png')

  if (logoData) {
    const logoH = 22
    const logoW = logoH * 0.82
    doc.addImage(logoData, 'PNG', m, y - 4, logoW, logoH)

    const textX = m + logoW + 4

    doc.setFont('times', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(...NAVY)
    doc.text('SHOREPINE', textX, y + 5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...TEAL)
    doc.text('VECTOR | WA', textX, y + 11)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY)
    doc.text('LEGISLATIVE INTELLIGENCE BRIEF', pw - m, y + 11, { align: 'right' })

    y += logoH + 2
  } else {
    // Fallback: text-only header
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(1.2)
    doc.line(m, y, pw - m, y)
    y += 8

    doc.setFont('times', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(...NAVY)
    doc.text('SHOREPINE', m, y)
    y += 7

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...TEAL)
    doc.text('VECTOR | WA', m, y)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...GRAY)
    doc.text('LEGISLATIVE INTELLIGENCE BRIEF', pw - m, y, { align: 'right' })
    y += 4
  }

  // Thin separator
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.3)
  doc.line(m, y, pw - m, y)
  y += 6

  /* ================================================================
     CLIENT INFO
     ================================================================ */

  if (clientName) {
    // 6M.8 — Prominent client branding with teal accent bar
    doc.setFillColor(245, 240, 230)
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.3)
    doc.roundedRect(m, y - 3, contentW, 14, 1.5, 1.5, 'FD')
    doc.setFillColor(...TEAL)
    doc.rect(m, y - 3, 2.5, 14, 'F')  // left accent

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...GRAY)
    doc.text('Prepared for', m + 6, y + 1)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...NAVY)
    doc.text(clientName, m + 6, y + 8)

    y += 15
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor(...NAVY)
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
     6M.5 — PORTFOLIO SUMMARY STATS (dynamic layout, truncation-safe)
     ================================================================ */

  y = checkPageBreak(doc, y, 24, ph)

  const isCurrentlyInterim = isInterimPeriod()

  doc.setFillColor(245, 240, 230)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, contentW, 18, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...NAVY)
  doc.text(isCurrentlyInterim ? 'SESSION RESULTS' : 'PORTFOLIO SUMMARY', m + 4, y + 5.5)

  let stats
  if (isCurrentlyInterim) {
    // Outcome-oriented stats for interim (matches executive summary language)
    const lawCount   = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'LAW').length
    const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'CARRY OVER').length
    const deadCount  = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'DEAD').length
    stats = [
      { label: 'Bills Tracked', value: String(bills.length) },
      { label: 'Signed into Law', value: String(lawCount) },
      { label: 'Passed Chamber', value: String(carryCount) },
      { label: 'Did Not Advance', value: String(deadCount) },
    ]
  } else {
    // Client-friendly stats for active session
    const onTrack   = bills.filter(b => (b.bills?.final_score || 0) >= TIER_MODERATE).length
    const momentum  = bills.filter(b => {
      const d = scoreDeltas[b.bill_id] || 0
      return d >= 5 && (b.bills?.final_score || 0) >= TIER_LOW
    }).length
    const atRisk    = bills.filter(b => {
      const s = b.bills?.final_score || 0
      return s > 0 && s < TIER_LOW && !(b.bills?.confidence_label || '').match(/DEAD|LAW/i)
    }).length
    stats = [
      { label: 'Bills Tracked', value: String(bills.length) },
      { label: 'On Track (60+)', value: String(onTrack) },
      { label: 'Gaining Momentum', value: String(momentum) },
      { label: 'At Risk of Stalling', value: String(atRisk) },
    ]
  }

  // Dynamic stat layout: measure text widths to prevent truncation
  const statY = y + 14
  doc.setFontSize(11)  // for measuring value widths
  const statWidths = stats.map(stat => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    const vw = doc.getTextWidth(stat.value)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    const lw = doc.getTextWidth(stat.label)
    return vw + 2 + lw + 6  // value + gap + label + padding
  })
  const totalStatW = statWidths.reduce((a, b) => a + b, 0)
  const scale = totalStatW > (contentW - 8) ? (contentW - 8) / totalStatW : 1

  let statX = m + 4
  stats.forEach((stat, i) => {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...NAVY)
    doc.text(stat.value, statX, statY)
    const valueWidth = doc.getTextWidth(stat.value)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(stat.label, statX + valueWidth + 2, statY)
    statX += statWidths[i] * scale
  })

  y += 24

  /* ================================================================
     6M.2 — BILL DETAIL CARDS (grouped by outcome)
     ================================================================ */

  y = checkPageBreak(doc, y, 12, ph)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...NAVY)
  doc.text('TRACKED LEGISLATION', m, y)
  y += 5

  if (bills.length === 0) {
    // 0-bill guard
    y = checkPageBreak(doc, y, 12, ph)
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(...GRAY)
    doc.text('No bills are currently tracked. Add bills from the Search page to see them here.', m + 2, y)
    y += 8
  } else {
    const groups = groupBills(bills)
    const showGroupHeaders = groups.length > 1  // only show headers if there are multiple outcome types

    groups.forEach(group => {
      if (showGroupHeaders) {
        y = drawGroupHeader(doc, group, y, m, contentW, ph)
      }
      group.bills.forEach(tracked => {
        y = drawBillCard(doc, tracked, scoreDeltas, changes, y, m, contentW, ph, billNotes || [], amendments, fiscalHistory)
      })
      y += 2  // extra gap between groups
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
      doc.setFontSize(8)
      doc.setTextColor(...NAVY)
      doc.text('SHOREPINE', m, 14)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...TEAL)
      doc.text('VECTOR | WA', m + 32, 14)
      // Client name on continuation pages (if present)
      if (clientName) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...GRAY)
        doc.text('Prepared for: ' + clientName, pw - m, 14, { align: 'right' })
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
      doc.text('Trajectory scores (0-99) calibrated against 8,062 bills across 3 WA biennia (2021-2026). 75+ = 84% became law.', m, methY + 3.5)
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
    doc.text('Shorepine Government Relations  |  Vector | WA  |  Legislative Intelligence', m, fy + 5)
    doc.text('CONFIDENTIAL', pw - m, fy + 5, { align: 'right' })

    if (pageCount > 1) {
      doc.setFontSize(6.5)
      doc.text('Page ' + p + ' of ' + pageCount, pw / 2, fy + 5, { align: 'center' })
    }
  }

  /* ================================================================
     SAVE
     ================================================================ */

  const safeName = (clientName || 'Portfolio').replace(/[^a-zA-Z0-9]/g, '_')
  const safeDate = date.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = 'Vector_WA_Brief_' + safeName + '_' + safeDate + '.pdf'

  doc.save(filename)
  return filename
}
