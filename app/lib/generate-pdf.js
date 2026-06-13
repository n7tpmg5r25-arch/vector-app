/**
 * Vector | WA — Watchlist Intelligence Brief PDF Generator
 *
 * Phase 6M: Original build — executive summary, portfolio table, bill cards, session bar.
 *
 * T154 (2026-05-28): Full redesign — memo grammar aligned with generate-public-pdf.js v5.5.8.
 *   Problems resolved:
 *   - All roundedRect card boxes removed: card shell, score box, status pill,
 *     session context bar, tag label box. Looked like a mobile screenshot.
 *   - 20pt score number replaced with tier word (11pt bold tier color) — same fix
 *     applied to generate-public-pdf.js in T152. Number without scale is noise.
 *   - AI summary was stripping headings and concatenating the full blob (6 lines).
 *     Now uses structureSummary() to pull executive section only — 3 lines max.
 *   - Executive summary was a template with unimplemented stubs. Now names specific
 *     bills: stage changes, urgent hearings (<= 7 days), cutoff pressure.
 *   - KPI strip added above session context: N tracked / N HIGH / N at risk.
 *   - What to Watch moved from last page to page 1, before portfolio table.
 *   - Format unified to US Letter (was A4). Margin 16mm (was 20mm).
 *   - Bill # font: Helvetica (was Courier — inconsistent with single-bill brief).
 *   - Section headers: drawSectionLabel() pattern throughout (was plain bold text).
 *   - Separator: \xB7 (CP1252 middle dot) throughout (was -- double-dash).
 *   - Duplicate date removed — header date is sufficient.
 *   - GROUP_COLORS: PASSED_CHAMBER -> Brass-Light (was Brass, same as LAW).
 *   - getOutcomeColor() calls: P passed as second arg (was missing, used defaults).
 *   - Inline hardcoded RGB magic numbers replaced with palette constants.
 *   - Summary line height 3.8 -> 4.3 (was too tight — 1.1mm leading at 7.5pt).
 *   - Portfolio table: UPCOMING -> NEXT, threshold 21 -> 30 days.
 *   - Analyst note short rule extended to full content width.
 *   - '> ' watch item prefix replaced with drawn \xB7 bullet.
 *
 * Visual grammar (T154):
 *   Structure = drawSectionLabel() (brass ALL-CAPS + rule) for named sections.
 *   Bill cards = drawBillLabel() (bill # + tier word + full-width rule) — no box.
 *   No roundedRect with stroke anywhere.
 *   Portfolio table: fill-only row alternation is justified for data tables.
 *
 * Pipeline (page 1):
 *   Header -> Tag/scope -> KPI strip -> Session context ->
 *   Executive Summary -> What to Watch -> Portfolio Overview Table
 *
 * Pipeline (pages 2+):
 *   Bill Intelligence (section block per bill, separated by drawBillLabel)
 *
 * jsPDF built-in fonts (Helvetica) — Windows-1252 only.
 * Use \xB7 for middle dot. T148 discipline: setFont() + setFontSize() before
 * every splitTextToSize() and getTextWidth() call.
 */

import jsPDF from 'jspdf'
import {
  isInterimPeriod, isPostBienniumClose, getCurrentBiennium, getNextBiennium,
  getSessionCutoffs, formatSessionDate, daysUntil,
} from './session-config'
import {
  VECTOR_PALETTE,
  STAGE_LABELS,
  TIER_HIGH, TIER_MODERATE, TIER_LOW,
  loadSvgWithFillSwap,
  getScoreColor, getScoreTierLabel, getOutcomeColor,
  checkPageBreak,
} from './pdf-shared'

// Canonical palette alias — matches generate-public-pdf.js convention
const P = VECTOR_PALETTE

// Legacy color names kept as aliases to minimise diff noise in drawing code
// that predates the T154 rewrite. All new code uses P.xxx directly.
const PRIMARY   = P.primary          // [14, 16, 20]   Dark Neutral — text
const ACCENT    = P.accent           // [184, 151, 90]  Brass
const ACCENT_LT = P.tierMod         // [212, 180, 122] Brass-Light
const STONE     = P.muted            // [138, 128, 112] Stone
const TMUTED    = P.neutral          // [70, 75, 85]    text-muted
const LGRAY     = P.neutralLt        // [200, 195, 185] light divider
const SURFACE   = P.surface          // [248, 246, 242] off-white print surface
const WHITE     = P.white            // [255, 255, 255]
const RUST      = P.danger           // [196, 71, 48]   Rust

const FOREST = PRIMARY
const TEAL   = ACCENT
const GOLD   = ACCENT_LT    // FIX: was ACCENT (= TEAL) — now Brass-Light for visual distinction
const GRAY   = TMUTED
const RED    = RUST
const MUTED  = STONE

// Max summary lines per bill card — executive section only (T154: was 6 full-blob lines)
const MAX_SUMMARY_LINES = 3

const VECTOR_DOMAIN = 'vectorwa' + '.' + 'com'

// ── Pure helpers ──────────────────────────────────────────────────────────────

function getBillTitle(bill) {
  const title = (bill.title || '').trim()
  if (!title) return bill.committee_name || 'Bill ' + bill.bill_number
  if (title === title.toUpperCase() && title.length < 40 && !/RELAT|CONCERN|PROVID|CREAT|AMEND|REPEAL/.test(title)) {
    return bill.committee_name || 'Bill ' + bill.bill_number
  }
  return title
}

function getStagePlainText(bill) {
  const s = bill.stage || 1
  const chamber = bill.chamber || 'House'
  const cmte = bill.committee_name || ''
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW')  return 'Signed into law'
  if (cl === 'DEAD') return 'Did not advance - session ended'
  if (cl === 'PASSED_CHAMBER') {
    if (isPostBienniumClose()) {
      const next = getNextBiennium()?.session
      return next ? 'Passed ' + chamber + ' - must be refiled in ' + next
                  : 'Passed ' + chamber + ' - must be refiled next biennium'
    }
    return 'Passed ' + chamber + ' - carries to next session'
  }
  if (s >= 6) return 'Signed into law'
  if (s >= 4) return 'Passed ' + chamber + ' floor'
  if (s >= 3) return cmte ? 'Passed ' + cmte : 'Passed committee'
  return 'Introduced in ' + chamber
}

function getCompanionLine(bill) {
  if (!bill.companion_bill) return null
  const COMP_STATE_LABELS = {
    both_moving: 'Both moving', leading: 'Leading', trailing: 'Trailing',
    forked: 'Diverged', both_stuck: 'Both stuck',
  }
  const compStage = bill.companion_stage
  const compScore = bill.companion_score
  const stateLabel = bill.companion_state ? COMP_STATE_LABELS[bill.companion_state] : null
  let stageLabel = null
  if (compStage != null) {
    if (compStage >= 6)      stageLabel = 'Signed'
    else if (compStage >= 4) stageLabel = 'Passed floor'
    else if (compStage >= 3) stageLabel = 'Out of cmte'
    else if (compStage >= 2) stageLabel = 'In committee'
    else                     stageLabel = 'Introduced'
  }
  const parenParts = []
  if (stageLabel) parenParts.push(stageLabel)
  if (compScore != null) parenParts.push('score ' + compScore)
  const paren = parenParts.length ? ' (' + parenParts.join(', ') + ')' : ''
  // Type-safe: companion_bill may be string or object
  const compLabel = typeof bill.companion_bill === 'string'
    ? bill.companion_bill
    : (bill.companion_bill?.label || bill.companion_bill?.bill_number || String(bill.companion_bill))
  const prefix = 'Companion ' + compLabel + paren
  return stateLabel ? prefix + '  \xB7  ' + stateLabel : prefix
}

function getDeltaNarrative(billId, bill, scoreDeltas, changes) {
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'DEAD' || cl === 'LAW' || cl === 'PASSED_CHAMBER') return ''
  const delta = scoreDeltas[billId]
  const change = changes[billId]
  const parts = []
  if (delta && delta !== 0) parts.push((delta > 0 ? '+' : '') + delta + ' pts')
  if (change && change.stageChanged) {
    const newLabel = STAGE_LABELS[change.newStage] || 'stage ' + change.newStage
    parts.push('moved to ' + newLabel)
  }
  if (parts.length === 0) return 'No change this week'
  return parts.join('  \xB7  ')
}

/**
 * Parse AI summary into { heading, body } sections — same as generate-public-pdf.js.
 * ALL-CAPS phrases (4-40 chars) detected as section headings.
 */
function structureSummary(raw) {
  if (!raw) return []
  const lines = String(raw)
    .split(/\r?\n/)
    .map(l => l.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim())
    .filter(l => l.length > 0)
  const sections = []
  let curHeading = null
  let curBody = []
  const flush = () => {
    if (curHeading || curBody.length > 0)
      sections.push({ heading: curHeading, body: curBody.join(' ').replace(/\s{2,}/g, ' ').trim() })
  }
  for (const line of lines) {
    const isHeading = line.length >= 4 && line.length <= 40 &&
      /^[A-Z][A-Z0-9 \-/&]{3,}$/.test(line)
    if (isHeading) { flush(); curHeading = line; curBody = [] }
    else            { curBody.push(line) }
  }
  flush()
  return sections.filter(s => s.heading || s.body)
}

// ── Bill grouping ─────────────────────────────────────────────────────────────

const GROUP_ORDER  = ['LAW', 'ACTIVE', 'PASSED_CHAMBER', 'DEAD']
const GROUP_LABELS = {
  LAW: 'Signed into Law', ACTIVE: 'Active Legislation',
  PASSED_CHAMBER: 'Passed Chamber', DEAD: 'Did Not Advance',
}
const GROUP_COLORS = {
  LAW:            TEAL,     // Brass
  ACTIVE:         FOREST,   // Dark Neutral (primary text weight)
  PASSED_CHAMBER: GOLD,     // Brass-Light — FIX: was TEAL (same as LAW, no distinction)
  DEAD:           GRAY,     // Neutral muted
}

function groupBills(bills) {
  const buckets = { LAW: [], ACTIVE: [], PASSED_CHAMBER: [], DEAD: [] }
  bills.forEach(tracked => {
    const cl = (tracked.bills?.confidence_label || '').toUpperCase()
    if (cl === 'LAW')             buckets.LAW.push(tracked)
    else if (cl === 'DEAD')       buckets.DEAD.push(tracked)
    else if (cl === 'PASSED_CHAMBER') buckets.PASSED_CHAMBER.push(tracked)
    else                          buckets.ACTIVE.push(tracked)
  })
  Object.values(buckets).forEach(arr =>
    arr.sort((a, b) => (b.bills?.final_score || 0) - (a.bills?.final_score || 0))
  )
  return GROUP_ORDER
    .filter(key => buckets[key].length > 0)
    .map(key => ({ groupKey: key, label: GROUP_LABELS[key], color: GROUP_COLORS[key], bills: buckets[key] }))
}

function drawGroupHeader(doc, group, y, m, contentW, ph) {
  y = checkPageBreak(doc, y, 10, ph)
  doc.setDrawColor(...group.color)
  doc.setLineWidth(0.8)
  doc.line(m, y, m + 18, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...group.color)
  const groupLbl = group.label.toUpperCase() + '  (' + group.bills.length + ')'
  doc.text(groupLbl, m + 20, y + 0.5)
  // Faint rule to right of label
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  const labelW = doc.getTextWidth(groupLbl)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.15)
  doc.line(m + 22 + labelW, y, m + contentW, y)
  return y + 5
}

// ── Section label helpers ─────────────────────────────────────────────────────

/** Brass ALL-CAPS label + full-width rule. Matches generate-public-pdf.js exactly. */
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

/**
 * Bill card header — bill number left + tier word right + full-width rule.
 * Replaces the roundedRect card shell from pre-T154. No box, just typography.
 */
function drawBillLabel(doc, y, m, contentW, billLbl, tierLbl, tierColor) {
  // Bill number — brass, left-aligned
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.accent)
  doc.text(billLbl.toUpperCase(), m, y)
  // Tier word — right-aligned, tier color
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...tierColor)
  doc.text(tierLbl.toUpperCase(), m + contentW, y, { align: 'right' })
  y += 1.5
  doc.setDrawColor(...P.accent)
  doc.setLineWidth(0.4)
  doc.line(m, y, m + contentW, y)
  return y + 4
}

// ── Section 0 — KPI strip (NEW in T154) ──────────────────────────────────────

function drawKpiStrip(doc, y, m, contentW, bills) {
  const total = bills.length
  const highCount = bills.filter(b => (b.bills?.final_score || 0) >= TIER_HIGH).length
  const atRisk = bills.filter(b => {
    const score = b.bills?.final_score || 0
    const cl = (b.bills?.confidence_label || '').toUpperCase()
    return score < TIER_LOW && score > 0 && !['LAW', 'DEAD', 'PASSED_CHAMBER'].includes(cl)
  }).length

  const parts = [
    total + ' tracked',
    highCount + ' HIGH',
    atRisk > 0 ? atRisk + ' at risk' : '0 at risk',
  ]

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...P.accent)
  doc.text(parts.join('  \xB7  '), m, y)
  return y + 7
}

// ── Section 1 — Session context (T154: plain text, no roundedRect) ────────────

function drawSessionContext(doc, y, m, contentW) {
  const interim = isInterimPeriod()
  const biennium = getCurrentBiennium()
  let contextText = ''

  if (interim) {
    const next = getNextBiennium()
    const parts = ['Session ended ' + formatSessionDate(biennium.end)]
    if (next.prefilingOpens) parts.push('Pre-filing opens ' + formatSessionDate(next.prefilingOpens))
    if (next.start) parts.push('Next session ' + formatSessionDate(next.start))
    contextText = parts.join('  \xB7  ')
  } else {
    const cutoffs = getSessionCutoffs().filter(c => !c.passed).slice(0, 2)
    if (cutoffs.length > 0) {
      contextText = cutoffs.map(c =>
        c.label + ': ' + formatSessionDate(c.date) + ' (' + c.daysLeft + ' days)'
      ).join('  \xB7  ')
    } else {
      contextText = biennium.session + ' session in progress'
    }
  }

  y = drawSectionLabel(doc, y, m, contentW, 'Session')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...P.primary)
  doc.text(contextText, m, y)
  return y + 7
}

// ── Section 2 — Executive Summary (T154: named-bill intelligence) ─────────────

/**
 * T154: Replaced the template stub with actual named-bill intelligence.
 * The previous version had two short-circuit stubs (highMovers, stageChanges)
 * that both returned false — so the narrative never named a specific bill.
 * This version uses scoreDeltas + changes + hearing/cutoff data to produce
 * a genuinely actionable summary.
 */
function drawExecutiveSummary(doc, y, m, contentW, ph, bills, scoreDeltas, changes) {
  y = checkPageBreak(doc, y, 28, ph)
  y = drawSectionLabel(doc, y, m, contentW, 'Executive Summary')

  const interim = isInterimPeriod()
  const biennium = getCurrentBiennium()
  const n = bills.length
  let narrative = ''

  if (n === 0) {
    narrative = 'No bills currently tracked. Add bills from the Search page to populate this brief.'
  } else if (interim) {
    const lawCount   = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'LAW').length
    const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'PASSED_CHAMBER').length
    const deadCount  = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'DEAD').length
    narrative = 'The ' + biennium.session + ' session ended ' + formatSessionDate(biennium.end) + '. '
    narrative += 'Of your ' + n + ' tracked bill' + (n !== 1 ? 's' : '') + ': '
    const outcomes = []
    if (lawCount > 0)   outcomes.push(lawCount + ' signed into law')
    if (carryCount > 0) outcomes.push(carryCount + ' passed ' + (carryCount === 1 ? 'its' : 'their') + ' chamber and carry into the next session')
    if (deadCount > 0)  outcomes.push(deadCount + ' did not advance')
    narrative += outcomes.length ? outcomes.join(', ') + '.' : 'none have recorded outcomes yet.'
    const next = getNextBiennium()
    if (next.prefilingOpens) {
      narrative += ' Pre-filing for ' + next.session + ' opens ' + formatSessionDate(next.prefilingOpens) + '.'
    }
  } else {
    // Active session — build named-bill intelligence from available signals
    const activeBills = bills.filter(b => {
      const cl = (b.bills?.confidence_label || '').toUpperCase()
      return !['LAW', 'DEAD', 'PASSED_CHAMBER'].includes(cl)
    })

    // Stage changes this period (from changes param)
    const stageChangeBills = bills
      .filter(b => changes && changes[b.bill_id]?.stageChanged)
      .sort((a, b) => (b.bills?.final_score || 0) - (a.bills?.final_score || 0))

    // Urgent hearings <= 7 days
    const urgentHearings = activeBills.filter(b => {
      if (!b.bills?.hearing_date) return false
      try { const d = daysUntil(b.bills.hearing_date); return d > 0 && d <= 7 } catch { return false }
    }).sort((a, b) => {
      try { return daysUntil(a.bills.hearing_date) - daysUntil(b.bills.hearing_date) } catch { return 0 }
    })

    // Cutoff pressure <= 7 days
    const cutoffUrgent = activeBills.filter(b => {
      const dc = b.bills?.days_to_cutoff
      return dc != null && dc > 0 && dc <= 7
    })

    // Portfolio health
    const highCount = bills.filter(b => (b.bills?.final_score || 0) >= TIER_HIGH).length
    const atRisk    = activeBills.filter(b => (b.bills?.final_score || 0) < TIER_LOW).length

    const billLabel = b => (b.bills?.chamber === 'House' ? 'HB' : 'SB') + ' ' + b.bills?.bill_number

    const sentences = []

    if (stageChangeBills.length > 0) {
      const names = stageChangeBills.slice(0, 2).map(billLabel)
      sentences.push(names.join(' and ') + ' advanced this week.')
    }

    if (urgentHearings.length > 0) {
      const hb = urgentHearings[0]
      try {
        const days    = daysUntil(hb.bills.hearing_date)
        const dateStr = new Date(hb.bills.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        sentences.push(billLabel(hb) + ' has a hearing ' + dateStr + ' (' + days + ' day' + (days !== 1 ? 's' : '') + ') - prepare testimony.')
        if (urgentHearings.length > 1) {
          sentences.push((urgentHearings.length - 1) + ' additional bill' + (urgentHearings.length > 2 ? 's' : '') + ' also have hearings this week.')
        }
      } catch (e) {}
    }

    if (cutoffUrgent.length > 0 && urgentHearings.length === 0) {
      const names = cutoffUrgent.slice(0, 2).map(billLabel)
      sentences.push(names.join(' and ') + ' face' + (cutoffUrgent.length === 1 ? 's' : '') + ' cutoff within 7 days - sponsor outreach needed.')
    }

    if (highCount > 0) sentences.push(highCount + ' bill' + (highCount !== 1 ? 's are' : ' is') + ' in strong position.')
    if (atRisk > 0)    sentences.push(atRisk + ' bill' + (atRisk !== 1 ? 's are' : ' is') + ' at risk of stalling.')

    if (sentences.length === 0) {
      sentences.push(n + ' bill' + (n !== 1 ? 's' : '') + ' tracked. No imminent hearings or cutoff pressure this week.')
    }

    narrative = sentences.join(' ')
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  const wrappedLines = doc.splitTextToSize(narrative, contentW)
  wrappedLines.forEach(line => {
    y = checkPageBreak(doc, y, 5, ph)
    doc.text(line, m, y)
    y += 4.3
  })
  return y + 4
}

// ── Section 3 — What to Watch (T154: moved to page 1, \xB7 bullets, no box) ────

function drawWhatToWatch(doc, y, m, contentW, ph, bills) {
  const interim = isInterimPeriod()
  const items = []

  if (interim) {
    const next = getNextBiennium()
    if (next.prefilingOpens) {
      const pfDays = daysUntil(next.prefilingOpens)
      items.push(pfDays > 0
        ? 'Pre-filing opens: ' + formatSessionDate(next.prefilingOpens)
        : 'Pre-filing is now open for the ' + next.session + ' session'
      )
    }
    if (daysUntil(next.start) > 0) items.push('Next session begins: ' + formatSessionDate(next.start))
    const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'PASSED_CHAMBER').length
    if (carryCount > 0) {
      items.push(carryCount + ' bill' + (carryCount !== 1 ? 's' : '') + ' carry into the new session automatically')
    }
  } else {
    const cutoffs = getSessionCutoffs().filter(c => !c.passed && c.daysLeft <= 21)
    cutoffs.forEach(c => items.push(c.label + ': ' + c.dateFormatted + ' (' + c.daysLeft + ' days)'))
    bills.forEach(tracked => {
      const bill = tracked.bills || {}
      if (bill.hearing_date) {
        try {
          const hDays = daysUntil(bill.hearing_date)
          if (hDays > 0 && hDays <= 14) {
            const lbl = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
            items.push(lbl + ' hearing ' + formatSessionDate(bill.hearing_date))
          }
        } catch (e) {}
      }
    })
    const atRiskBills = bills.filter(b => {
      const bill = b.bills || {}
      return (bill.stage || 1) <= 2 && (bill.final_score || 0) < TIER_LOW &&
        !(bill.confidence_label || '').match(/DEAD|LAW/i)
    })
    if (atRiskBills.length > 0 && cutoffs.length > 0) {
      items.push(atRiskBills.length + ' bill' + (atRiskBills.length !== 1 ? 's have' : ' has') + ' not yet passed committee')
    }
    if (items.length === 0) items.push('No imminent deadlines or hearings for tracked bills')
  }

  const sectionH = 6 + items.length * 5 + 4
  y = checkPageBreak(doc, y, sectionH, ph)
  y = drawSectionLabel(doc, y, m, contentW, interim ? 'Key Dates Ahead' : 'What to Watch')

  items.forEach(item => {
    y = checkPageBreak(doc, y, 5, ph)
    // \xB7 bullet indicator
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...P.accent)
    doc.text('\xB7', m + 1, y)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.primary)
    doc.text(item, m + 5, y)
    y += 5
  })

  return y + 4
}

// ── Section 4 — Portfolio Overview Table ─────────────────────────────────────

function drawPortfolioTable(doc, bills, scoreDeltas, changes, y, m, contentW, ph) {
  y = checkPageBreak(doc, y, 14, ph)
  y = drawSectionLabel(doc, y, m, contentW, 'Portfolio Overview')

  // Column widths summing to contentW (184mm at 16mm margin on Letter)
  // T154: colTitle widened (+12), colStage +2; UPCOMING -> NEXT, threshold 30d
  const colBill     = 18
  const colTitle    = 78
  const colScore    = 14
  const colStage    = 36
  const colTrend    = 14
  const colNext     = contentW - colBill - colTitle - colScore - colStage - colTrend  // ~24

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
    ['BILL #', colBill], ['TITLE', colTitle], ['SCORE/99', colScore],
    ['STAGE', colStage], ['TREND', colTrend], ['NEXT', colNext],
  ].forEach(([label, w]) => { doc.text(label, hx, hy); hx += w })
  y += 7

  if (bills.length === 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text('No bills tracked.', m + 2, y + 4)
    return y + 10
  }

  const groups = groupBills(bills)
  const showGroupLabels = groups.length > 1
  const rowH = 7.5

  groups.forEach(group => {
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
      const bill    = tracked.bills || {}
      const billId  = tracked.bill_id
      const score   = bill.final_score || 0
      const scoreColor = getScoreColor(score, P)           // FIX: pass P
      const billLbl = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
      const title   = getBillTitle(bill)
      const stageTxt = getStagePlainText(bill)
      const delta   = scoreDeltas[billId] || 0
      const cl      = (bill.confidence_label || '').toUpperCase()
      const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'

      // Alternating row fill (no border stroke on data rows)
      doc.setFillColor(...(i % 2 === 0 ? SURFACE : WHITE))
      doc.setDrawColor(...LGRAY)
      doc.setLineWidth(0.1)
      doc.rect(m, y - 0.5, contentW, rowH, 'FD')

      // Outcome-color left edge strip
      doc.setFillColor(...getOutcomeColor(bill, P))        // FIX: pass P
      doc.rect(m, y - 0.5, 1.5, rowH, 'F')

      const rowY = y + rowH / 2 + 1.2
      let rx = m + 3

      // Bill # — Helvetica (T154: was Courier)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7.5)
      doc.setTextColor(...P.primary)
      doc.text(billLbl, rx, rowY)
      rx += colBill

      // Title — truncate to fit
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7)
      doc.setTextColor(...P.primary)
      let titleFit = title
      // T148: font must be set before getTextWidth
      while (doc.getTextWidth(titleFit) > colTitle - 3 && titleFit.length > 10) titleFit = titleFit.slice(0, -1)
      if (titleFit !== title) titleFit = titleFit.slice(0, -1) + '\x85'  // CP1252 ellipsis
      doc.text(titleFit, rx, rowY)
      rx += colTitle

      // Score — colored number
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...scoreColor)
      doc.text(String(score), rx, rowY)
      rx += colScore

      // Stage — truncate
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...P.neutral)
      let stageFit = stageTxt
      while (doc.getTextWidth(stageFit) > colStage - 2 && stageFit.length > 8) stageFit = stageFit.slice(0, -1)
      if (stageFit !== stageTxt) stageFit = stageFit.slice(0, -1) + '\x85'
      doc.text(stageFit, rx, rowY)
      rx += colStage

      // Trend — delta with "pts" unit (T154: was bare number)
      if (!isTerminal) {
        const trendColor = delta > 0 ? TEAL : delta < 0 ? RED : GRAY
        doc.setFont('helvetica', delta !== 0 ? 'bold' : 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...trendColor)
        doc.text(delta !== 0 ? (delta > 0 ? '+' : '') + delta + ' pts' : '--', rx, rowY)
      } else {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(6.5)
        doc.setTextColor(...P.muted)
        doc.text('final', rx, rowY)
      }
      rx += colTrend

      // Next — hearing or cutoff within 30 days (T154: was 21 days, column was "UPCOMING")
      if (!isTerminal && !isInterimPeriod()) {
        let nextTxt = ''
        if (bill.hearing_date) {
          try {
            const hDays = daysUntil(bill.hearing_date)
            if (hDays > 0 && hDays <= 30) {
              const hLbl = new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              nextTxt = 'Hear ' + hLbl
            }
          } catch (e) {}
        }
        if (!nextTxt && bill.days_to_cutoff != null && bill.days_to_cutoff > 0 && bill.days_to_cutoff <= 30) {
          nextTxt = 'Cutoff ' + bill.days_to_cutoff + 'd'
        }
        if (nextTxt) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(6.5)
          doc.setTextColor(...RUST)
          doc.text(nextTxt, rx, rowY)
        }
      }

      y += rowH
    })
    y += 2
  })

  return y + 4
}

// ── Section 5 — Expanded Bill Intelligence Cards (T154: no boxes) ────────────

/**
 * T154: Complete redesign. All roundedRect removed.
 * Card structure: drawBillLabel (bill # + tier word + rule) acts as the visual
 * separator. Content flows as text rows below — no surrounding box.
 *
 * Score display: tier word (11pt bold tier color) + one-liner, same grammar
 * as generate-public-pdf.js v5.5.8.
 *
 * AI summary: structureSummary() extracts executive section only — 3 lines max.
 * Was: full blob stripped of headings, up to 6 lines.
 */
function drawExpandedBillCard(doc, tracked, scoreDeltas, changes, y, m, contentW, ph, billNotes, fiscalHistory = []) {
  const bill      = tracked.bills || {}
  const billId    = tracked.bill_id
  const score     = bill.final_score || 0
  const scoreColor = getScoreColor(score, P)
  const billLbl   = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
  const title     = getBillTitle(bill)
  const stageLine = getStagePlainText(bill)
  const delta     = scoreDeltas[billId] || 0
  const cl        = (bill.confidence_label || '').toUpperCase()
  const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'
  const tag       = tracked.tag || ''
  const tierColor = getOutcomeColor(bill, P)                // FIX: pass P
  const tierLbl   = isTerminal
    ? (cl === 'LAW' ? 'Signed into Law' : cl === 'DEAD' ? 'Did Not Advance' : 'Passed Chamber')
    : (getScoreTierLabel(score) || 'VERY LOW')

  // T154: executive section only from structured summary
  const sections  = structureSummary(bill.custom_summary || bill.ai_summary || '')
  const execSec   = sections.find(s => s.heading && /EXECUTIVE|SUMMARY/i.test(s.heading))
    || sections.find(s => !s.heading && !/AFFECTED|IMPACT/i.test(s.heading || ''))
    || sections[0]
  const affectedSec = sections.find(s => s.heading && /AFFECTED|IMPACT/i.test(s.heading))

  // Analyst notes — shared visibility only
  const sharedNotes = (billNotes || []).filter(n => n.bill_id === billId && n.visibility === 'shared')

  // Companion line
  const companionLine = getCompanionLine(bill)

  // Watch items
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

  const deltaText = getDeltaNarrative(billId, bill, scoreDeltas, changes)

  // Score one-liner — matches generate-public-pdf.js
  const oneLiner = (() => {
    if (cl === 'LAW')  return 'Signed into law - outcome final.'
    if (cl === 'DEAD') return 'Did not advance - session ended without passage.'
    if (cl === 'PASSED_CHAMBER') {
      if (isPostBienniumClose()) return 'Did not pass this biennium - must be refiled to advance.'
      return 'Passed its first chamber - carries into the next session.'
    }
    if (score >= TIER_HIGH)     return '84% historical pass rate - strong forward momentum.'
    if (score >= TIER_MODERATE) return 'Viable path to passage - moderate momentum.'
    if (score >= TIER_LOW)      return 'Limited movement - needs sponsor push or scheduled hearing.'
    return 'Very limited momentum - most bills in this band do not advance this session.'
  })()

  // Ensure the card block starts with enough room for at least the header + title
  y = checkPageBreak(doc, y, 20, ph)

  // ── Bill label (visual separator, replaces rounded card box) ────────────────
  y = drawBillLabel(doc, y, m, contentW, billLbl, tierLbl, tierColor)

  // ── Title (max 2 lines) ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...P.primary)
  const titleLines = doc.splitTextToSize(title, contentW - 30)
  titleLines.slice(0, 2).forEach(line => {
    doc.text(line, m, y)
    y += 5
  })

  // Tag — right-aligned on same line as first title word (actually after title block)
  if (tag) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...P.accent)
    doc.text(tag.toUpperCase(), m + contentW, y - 5, { align: 'right' })
  }

  // ── Affects (inline, same as bill brief) ────────────────────────────────────
  if (affectedSec?.body) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.accent)
    doc.text('Affects:', m, y)
    const labW = doc.getTextWidth('Affects:')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    // A4 (ER-B3): wrap the Affects body to up to 3 lines instead of clipping to
    // one. A printed brief must carry the full "who's affected" line. Continuation
    // lines hang-indent under the label; uniform row-title truncation stays elsewhere.
    const affAll = doc.splitTextToSize(affectedSec.body, contentW - labW - 3)
    const affLines = affAll.slice(0, 3)
    if (affAll.length > 3) {
      affLines[2] = (affLines[2] || '').trim().replace(/[.,;]?\s*$/, '') + '\x85'
    }
    affLines.forEach((line, i) => doc.text(String(line).trim(), m + labW + 2, y + i * 4))
    y += 5.5 + (affLines.length - 1) * 4
  } else {
    y += 2
  }

  // ── Status line ──────────────────────────────────────────────────────────────
  const statusParts = [stageLine]
  if (!isTerminal && !isInterimPeriod()) {
    if (bill.hearing_date) {
      try {
        const h = new Date(bill.hearing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        statusParts.push('Hearing ' + h)
      } catch (e) {}
    } else if (bill.days_to_cutoff != null && bill.days_to_cutoff > 0) {
      statusParts.push(bill.days_to_cutoff + ' days to cutoff')
    }
  } else if (isTerminal && bill.last_action_date) {
    try {
      const d = formatSessionDate(bill.last_action_date)
      if (d && d !== 'session dates TBD') statusParts.push(d)
    } catch (e) {}
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  doc.text(statusParts.join('  \xB7  '), m, y)
  y += 7

  // ── Tier word + one-liner (T154: replaces 20pt score box with roundedRect) ────
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...tierColor)
  doc.text(tierLbl.toUpperCase(), m, y)
  y += 8    // same spacing rule as generate-public-pdf.js T153

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  const olLines = doc.splitTextToSize(oneLiner, contentW)
  olLines.slice(0, 2).forEach(line => { doc.text(line, m, y); y += 4.5 })
  y += 2

  // ── Sponsor + Committee (compact one-liner) ──────────────────────────────────
  if (bill.prime_sponsor || bill.committee_name) {
    const sponsorParts = []
    if (bill.prime_sponsor) {
      const party = (bill.prime_party || '').charAt(0).toUpperCase()
      sponsorParts.push((bill.chamber === 'House' ? 'Rep.' : 'Sen.') + ' ' + bill.prime_sponsor + (party ? ' (' + party + ')' : ''))
    }
    if (bill.committee_name) sponsorParts.push(bill.committee_name)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.neutral)
    doc.text(sponsorParts.join('  \xB7  '), m, y)
    y += 6
  }

  // ── Executive summary prose (T154: structured extract, max 3 lines) ──────────
  if (execSec?.body) {
    y = checkPageBreak(doc, y, 14, ph)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.primary)
    // T148: font set above
    const sumLines = doc.splitTextToSize(execSec.body, contentW)
    sumLines.slice(0, MAX_SUMMARY_LINES).forEach(line => {
      y = checkPageBreak(doc, y, 4.3 + 1, ph)
      doc.text(line, m, y)
      y += 4.3   // T154: was 3.8 — cramped at 1.1mm leading
    })
    if (sumLines.length > MAX_SUMMARY_LINES) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...P.muted)
      doc.text('[summary continues]', m, y)
      y += 4
    }
    y += 2
    // PORTAL-6 scrub-gate item 2: one AI-attribution line per summary block
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...P.muted)
    doc.text('AI-drafted summary', m, y)
    y += 3.5
  }

  // ── Companion line ───────────────────────────────────────────────────────────
  if (companionLine) {
    y = checkPageBreak(doc, y, 6, ph)
    doc.setFont('helvetica', bill.companion_state === 'forked' ? 'bold' : 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...(bill.companion_state === 'forked' ? P.danger : P.neutral))
    doc.text(companionLine, m, y)
    y += 5
  }

  // ── Analyst Notes ────────────────────────────────────────────────────────────
  if (sharedNotes.length > 0) {
    y = checkPageBreak(doc, y, 12, ph)
    // T154: full-width rule (was 30mm stub)
    doc.setDrawColor(...P.accent)
    doc.setLineWidth(0.25)
    doc.line(m, y, m + contentW, y)
    y += 2.5

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...P.accent)
    doc.text('ANALYST NOTE', m, y)
    y += 4

    sharedNotes.forEach(note => {
      y = checkPageBreak(doc, y, 8, ph)
      const dateLine = new Date(note.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...P.muted)
      doc.text(dateLine, m, y)
      y += 3.5

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...P.primary)
      const bodyLines = doc.splitTextToSize(note.body, contentW - 4)
      bodyLines.forEach(line => { y = checkPageBreak(doc, y, 4.3, ph); doc.text(line, m + 2, y); y += 4.3 })
      y += 2
    })
  }

  // ── Watch items ──────────────────────────────────────────────────────────────
  if (watchItems.length > 0) {
    y = checkPageBreak(doc, y, 6 + watchItems.length * 5, ph)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...P.danger)
    doc.text('WATCH:', m, y)
    y += 4.5
    watchItems.forEach(item => {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(...P.primary)
      doc.text('\xB7  ' + item, m + 2, y)
      y += 4.5
    })
  }

  // ── Movement/trend line ──────────────────────────────────────────────────────
  if (deltaText) {
    y = checkPageBreak(doc, y, 6, ph)
    const deltaColor = delta > 0 ? TEAL : delta < 0 ? RED : GRAY
    doc.setFont('helvetica', delta !== 0 ? 'bold' : 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...deltaColor)
    doc.text('Movement: ' + deltaText, m, y)
    y += 5
  }

  return y + 8  // gap between bill blocks
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateBriefPDF({
  tagLabel,
  date,
  bills,
  scoreDeltas,
  changes,
  session,
  billNotes,
  amendments = [],      // legacy compat — not used in T154 layout
  fiscalHistory = [],
  cohortStats = null,
}) {
  // T154: US Letter (was A4). Margin 16mm (was 20mm). Unified with single-bill brief.
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()   // 215.9
  const ph = doc.internal.pageSize.getHeight()  // 279.4
  const m  = 16
  const contentW = pw - 2 * m   // ~183.9mm
  let y = 14

  // ── Header ────────────────────────────────────────────────────────────────────
  {
    const genTime = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    const stampDate = date || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text('Generated ' + stampDate + '  ·  ' + genTime, m, y + 4)
    if (session) {
      doc.setFontSize(7)
      doc.text(session, pw - m, y + 4, { align: 'right' })
    }
    y += 8
  }

  // Thin separator
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, y, pw - m, y)
  y += 6

  // ── Tag / scope label (T154: plain text, no roundedRect box) ─────────────────
  if (tagLabel) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text('Filtered by tag', m, y)
    y += 4.5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...P.primary)
    doc.text(tagLabel, m, y)
    y += 7
  } else {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...P.primary)
    doc.text('Full Portfolio Report', m, y)
    y += 7
  }

  // ── KPI strip (NEW in T154) ───────────────────────────────────────────────────
  y = drawKpiStrip(doc, y, m, contentW, bills)

  // ── Session context (T154: plain text + rule, no roundedRect bar) ─────────────
  y = drawSessionContext(doc, y, m, contentW)

  // ── Executive summary (T154: named-bill intelligence) ────────────────────────
  y = drawExecutiveSummary(doc, y, m, contentW, ph, bills, scoreDeltas || {}, changes || {})

  // ── What to Watch (T154: MOVED UP — was after bill cards on last page) ────────
  y = drawWhatToWatch(doc, y, m, contentW, ph, bills)

  // ── Portfolio overview table ──────────────────────────────────────────────────
  y = drawPortfolioTable(doc, bills, scoreDeltas || {}, changes || {}, y, m, contentW, ph)

  // ── Bill Intelligence section ─────────────────────────────────────────────────
  y = checkPageBreak(doc, y, 12, ph)
  y = drawSectionLabel(doc, y, m, contentW, 'Bill Intelligence')

  if (bills.length === 0) {
    y = checkPageBreak(doc, y, 12, ph)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.muted)
    doc.text('No bills are currently tracked. Add bills from the Search page to see them here.', m, y)
    y += 8
  } else {
    const groups = groupBills(bills)
    const showGroupHeaders = groups.length > 1

    groups.forEach(group => {
      if (showGroupHeaders) y = drawGroupHeader(doc, group, y, m, contentW, ph)
      group.bills.forEach(tracked => {
        y = drawExpandedBillCard(doc, tracked, scoreDeltas || {}, changes || {}, y, m, contentW, ph, billNotes || [], fiscalHistory)
      })
      y += 2
    })
  }

  // ── Per-page footer + continuation header ────────────────────────────────────
  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)

    // Continuation header — pages 2+
    if (p > 1) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8.5)
      doc.setTextColor(...P.primary)
      doc.text('VECTOR | WA', m, 13)
      if (tagLabel) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7)
        doc.setTextColor(...P.muted)
        doc.text('Tag: ' + tagLabel, pw - m, 13, { align: 'right' })
      }
      doc.setDrawColor(...P.neutralLt)
      doc.setLineWidth(0.2)
      doc.line(m, 17, pw - m, 17)
    }

    // Methodology block — last page only, above footer
    if (p === pageCount) {
      const methY = ph - 27   // PDF-W2: raised 3mm with the footer to clear the data-sources line
      doc.setDrawColor(...P.neutralLt)
      doc.setLineWidth(0.15)
      doc.line(m, methY, pw - m, methY)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...P.neutral)

      let calibBlurb = 'Trajectory scores (0-99) calibrated against 8,062 bills across 3 WA biennia (2021-2026). 75+ = 84% became law.'
      if (cohortStats?.ok && cohortStats.total > 0 && cohortStats.biennia?.length > 0) {
        const n = cohortStats.total.toLocaleString()
        const bCount = cohortStats.biennia.length
        const firstYear = cohortStats.biennia[0].split('-')[0]
        const lastParts = cohortStats.biennia[cohortStats.biennia.length - 1].split('-')
        const lastYear  = lastParts[lastParts.length - 1]
        calibBlurb = 'Trajectory scores (0-99) calibrated against ' + n + ' bills across ' + bCount + ' WA biennia (' + firstYear + '-' + lastYear + '). 75+ = 84% became law.'
      }
      doc.text(calibBlurb, m, methY + 3.5)
      doc.text('Signal tiers: HIGH (75+), MODERATE (60-74), LOW (45-59), VERY LOW (<45).', m, methY + 7)
    }

    // Footer — every page
    const fy = ph - 15   // PDF-W2: raised 3mm to fit the data-sources attribution line
    doc.setDrawColor(...P.neutralLt)
    doc.setLineWidth(0.3)
    doc.line(m, fy, pw - m, fy)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...P.muted)
    doc.text('Generated ' + (date || ''), m, fy + 4)
    if (pageCount > 1) {
      doc.setFontSize(6.5)
      doc.text('Page ' + p + ' of ' + pageCount, pw / 2, fy + 4, { align: 'center' })
    }
    // PDF-W2: data-sources attribution -- matches member + single-bill briefs
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(5.5)
    doc.setTextColor(...P.neutralLt)
    doc.text(
      'Data: Washington State Legislature · leg.wa.gov · Washington Secretary of State · WA roll-call voting records',
      m, fy + 8
    )
  }

  // ── Save ──────────────────────────────────────────────────────────────────────
  const safeName = (tagLabel || 'portfolio').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()
  const safeDate = new Date().toISOString().slice(0, 10)
  const filename  = safeName + '-brief-' + safeDate + '.pdf'
  doc.save(filename)
  return filename
}
