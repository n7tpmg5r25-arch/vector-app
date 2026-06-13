/**
 * Vector | WA — Public Bill Brief PDF Generator
 *
 * T150 (2026-05-27): Full rewrite — lobbyist-first, one-page US letter.
 * T151 (2026-05-27): C-suite refinements — affected callout, recommendation,
 *   probability-led score, hearing countdown, plain-English labels.
 * T152 (2026-05-27): Memo-style redesign — all UI card boxes removed.
 * T153 (2026-05-27): UI/UX formatting audit — 14 fixes.
 *   Problems resolved:
 *   - Every section was a roundedRect card with a brass accent bar — looked
 *     like a mobile app screenshot, not a briefing document. All boxes gone.
 *   - Score circle + raw number (74) means nothing to a non-insider. Replaced
 *     with large tier word (HIGH / MODERATE / LIMITED) + "Score 74" annotation.
 *   - RECOMMENDATION row removed — a blank write-line signals incomplete doc.
 *   - Status pill + score block were two consecutive cards saying the same
 *     thing. Merged into one STATUS & TRAJECTORY section.
 *   - WHO IS AFFECTED box promoted to inline text line under bill title.
 *   - Key Signals chips (colored rounded boxes) → plain text rows with
 *     drawn triangle indicators.
 *   - Floor vote pills → plain text rows.
 *   - Sponsor + Committee side-by-side cards → two-column text block.
 *   - Fiscal note "Large" → full three-line intelligence block using
 *     fiscal_referral, double_referral, has_local_impact, previous_size,
 *     and the calibrated law-rate implications for each tier.
 *
 * Visual grammar (T152):
 *   Structure = drawSectionLabel() (brass ALL-CAPS + rule) only.
 *   No roundedRect with stroke. No fill+draw ('FD'). No colored accent bars.
 *   Light fills ('F') only where genuinely needed — none in this build.
 *
 * Information hierarchy:
 *   Bill identity · Affects inline
 *   STATUS & TRAJECTORY · SPONSOR / COMMITTEE
 *   WHAT IT DOES · KEY SIGNALS
 *   FLOOR VOTE · COMPANION · FISCAL NOTE · STAGE HISTORY
 *
 * Fiscal size semantics (sync-v2.9 calibration, 8,062 bills, 3 bienniums):
 *   large  = note + fiscal_referral + double_referral → 44.6% law rate
 *   small  = note only, no referral                  → 28.8% law rate
 *   none   = no fiscal note                          → 16.2% law rate
 *   medium = note + fiscal_referral (no double)      →  1.3% law rate
 *
 * jsPDF built-in fonts (Helvetica) support Windows-1252 only.
 * Use doc.triangle() for directional glyphs. No arrow Unicode.
 * T148 discipline: setFont() + setFontSize() before EVERY splitTextToSize()
 * and every getTextWidth() call.
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

// Canonical v1.2 palette alias
const P = VECTOR_PALETTE

const VECTOR_DOMAIN = 'vectorwa' + '.' + 'com'

// Party dot colors — match bill detail page prime-sponsor dot
const PARTY_COLOR = {
  D: [90, 90, 90],
  R: [90, 90, 90],
  I: [90, 90, 90],
  L: [90, 90, 90],
}

// Sponsor-tier plain-English labels (T151)
const SPONSOR_TIER_LABEL = { 1: 'Majority Leadership', 2: 'Senior Member', 3: 'Rank-and-file' }

// Fiscal strategic copy keyed by effective tier.
// Calibrated to actual law rates from sync-v2.9 (8,062 bills, 2,155 LAW):
//   large  (note + fiscal_referral + double_referral): 44.6%  — POSITIVE
//   small  (note only, no referral):                   28.8%
//   medium (note + fiscal_referral, no double_referral): 1.3% — FRICTION
const FISCAL_STRATEGY = {
  large:         'Priority legislation — double-referred to fiscal committees. 45% historical passage rate.',
  medium:        'Referred to a single fiscal committee — additional scrutiny. Low historical advance rate.',
  small_ref:     'Fiscal note on file with committee referral — watch for additional fiscal review.',
  small:         'Fiscal note on file — limited impact, no committee referral required.',
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

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

  if (cl === 'LAW')            return 'Signed into law'
  if (cl === 'DEAD')           return 'Did not advance — session ended'
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

/**
 * One-sentence read on the score. Leads with the historical pass rate %
 * so the first word a decision-maker sees is a probability, not a label.
 */
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
  if (score >= TIER_HIGH)     return '84% historical pass rate — strong forward momentum.'
  if (score >= TIER_MODERATE) return 'Viable path to passage — moderate momentum, active committee work required.'
  if (score >= TIER_LOW)      return 'Limited movement — needs a sponsor push or scheduled hearing to gain ground.'
  return 'Very limited momentum — most bills in this band do not advance this session.'
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
 * Compact session context line for the header right column.
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
  // #13: Day N of session removed — not actionable; cutoff countdown is
  const cutoffs = getSessionCutoffs().filter(c => !c.passed).slice(0, 1)
  const parts = []
  if (cutoffs.length > 0) {
    const c = cutoffs[0]
    parts.push(c.label + ': ' + formatSessionDate(c.date) + ' (' + c.daysLeft + ' days)')
  }
  return parts.join('  ·  ')
}

/**
 * Parse AI summary into { heading, body } sections.
 * ALL-CAPS phrases (4–40 chars) detected as section headings.
 * Markdown ## and ** markers stripped.
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
 * Build chronological stage events from snapshots.
 * Returns [] when fewer than 3 transitions exist.
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

// ── Section label helper (matches generate-member-pdf.js exactly) ─────────────

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

async function drawHeader(doc, y, m, pw, contentW, generatedAt) {
  // Neutral export header - date + time stamp only, no logo or brand.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  const stamp = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  }) + '  ·  ' + generatedAt.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  })
  doc.text('Generated ' + stamp, m, y + 4)

  const ctxLine = getSessionContextLine()
  if (ctxLine) {
    doc.setFontSize(6.5)
    doc.text(ctxLine, pw - m, y + 4, { align: 'right' })
  }

  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, y + 7, pw - m, y + 7)

  return y + 12
}

// ── Section 2 — Bill identity + inline Affects ────────────────────────────────

/**
 * T152: WHO IS AFFECTED is now a single inline text line directly under the
 * bill title — "Affects: [one-line body]" in brass/muted type. No box.
 * The box from T151 was visually consistent with the web app, not a memo.
 */
function drawBillIdentity(doc, y, m, contentW, bill) {
  // Bill number — brass bold helvetica
  doc.setFont('helvetica', 'bold')
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
  doc.setFontSize(12)
  doc.setTextColor(...P.primary)
  const titleLines = doc.splitTextToSize(getBillTitle(bill), contentW)
  const shownLines = titleLines.slice(0, 2)
  shownLines.forEach((line, i) => doc.text(line, m, y + 12.5 + i * 5.5))
  const titleBottom = y + 12.5 + shownLines.length * 5.5

  // Category · chamber meta row
  const metaParts = [bill.category, bill.chamber].filter(Boolean)
  let cur = titleBottom
  if (metaParts.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text(metaParts.join('  ·  '), m, cur + 3.5)
    cur = cur + 8
  } else {
    cur = cur + 6   // #6: was 3 — visually tight before Affects line
  }

  // Inline affects line — "Affects: [one sentence]"
  // Replaces the T151 rounded-box callout. Same data, no visual chrome.
  const sections    = structureSummary(bill.custom_summary || bill.ai_summary || '')
  const affectedSec = sections.find(s => s.heading && /AFFECTED|IMPACT/i.test(s.heading))
  // PDF-B1: fallback to first sentence of summary when no AFFECTED/IMPACT heading
  const affectsBody = affectedSec?.body || (() => {
    const firstSec = sections.find(s => s.body)
    if (!firstSec?.body) return null
    const firstSentence = firstSec.body.split(/(?<=[.!?])\s/)[0]
    return (firstSentence && firstSentence.length > 20) ? firstSentence : null
  })()
  if (affectsBody) {
    // Font MUST be set before getTextWidth (T148)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.accent)
    doc.text('Affects:', m, cur)
    const labW = doc.getTextWidth('Affects:')

    // Font MUST be set before splitTextToSize (T148)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    const affW     = contentW - labW - 3
    // A4 (ER-B3): wrap the Affects body to up to 3 lines instead of clipping to
    // one. A printed brief must carry the full "who's affected" line; the T153
    // one-line clip hid content (and once hid a hallucination). Title rows
    // elsewhere stay uniform-truncated -- this prose block wraps with a hanging
    // indent under the label.
    const affAll   = doc.splitTextToSize(affectsBody, affW)
    const affLines = affAll.slice(0, 3)
    if (affAll.length > 3) {
      affLines[2] = (affLines[2] || '').trim().replace(/[.,;]?\s*$/, '') + '…'
    }
    affLines.forEach((line, i) => doc.text(String(line).trim(), m + labW + 2, cur + i * 4))
    cur = cur + 6 + (affLines.length - 1) * 4
  }

  return cur + 2
}

// ── Section 3 — Status & Trajectory (merged, typography only) ────────────────

/**
 * T152: Was two separate box sections (drawStatusPill + drawScoreBlock).
 * Now a single typeset block. No roundedRect, no circle, no raw score as hero.
 *
 * Layout:
 *   STATUS & TRAJECTORY  ──────────────────────────────
 *   [Stage]  ·  [cutoff / date]          9pt bold
 *
 *   HIGH  Score 74                       13pt bold tier · 7pt muted annotation
 *   [one-liner prose]                    8.5pt normal, ≤2 lines
 */
function drawStatusAndScore(doc, y, m, contentW, bill) {
  y += 2   // breathing room before section label
  y = drawSectionLabel(doc, y, m, contentW, 'Status & Trajectory')

  const score      = bill.final_score || 0
  const cl         = (bill.confidence_label || '').toUpperCase()
  const isTerminal = cl === 'LAW' || cl === 'DEAD' || cl === 'PASSED_CHAMBER'
  const interim    = isInterimPeriod()

  // ── Status line ─────────────────────────────────────────────────────────
  const stageLine   = getStagePlainText(bill)
  const statusParts = [stageLine]
  if (!isTerminal && !interim) {
    if (bill.days_to_cutoff != null && bill.days_to_cutoff > 0) {
      statusParts.push(bill.days_to_cutoff + ' days to cutoff')
    }
  } else {
    const dateLbl = getRecentActionDate(bill)
    if (dateLbl) statusParts.push(dateLbl)
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...P.primary)
  doc.text(statusParts.join('  ·  '), m, y)
  y += 7

  // ── Tier word ─────────────────────────────────────────────────────────────
  const color   = getOutcomeColor(bill, P)
  const tierLbl = isTerminal
    ? (cl === 'LAW' ? 'SIGNED INTO LAW' : cl === 'DEAD' ? 'DID NOT ADVANCE' : 'PASSED CHAMBER')
    : ((getScoreTierLabel(score) || 'VERY LOW')).toUpperCase()

  // #1: 11pt (was 13pt) — title is now dominant at 12pt; color differentiates tier
  // #10: raw score annotation removed — number is noise without scale context
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...color)
  doc.text(tierLbl, m, y)
  // #2: y += 8 (was 5) — 11pt descender is ~4mm; was colliding with one-liner
  y += 8

  // ── One-liner ────────────────────────────────────────────────────────────
  const oneLiner = getScoreOneLiner(bill, score)
  // Font MUST be set before splitTextToSize (T148 discipline)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(oneLiner, contentW)
  lines.slice(0, 2).forEach(line => {
    doc.text(line, m, y)
    y += 4.5
  })

  return y + 4
}

// ── Section 4 — Sponsor / Committee (two-column text, no boxes) ───────────────

/**
 * T152: Was two side-by-side rounded cards with brass accent bars.
 * Now a two-column text block under a drawSectionLabel rule.
 * Structure = typography; no borders, no fills.
 */
function drawSponsorCommittee(doc, y, m, contentW, bill) {
  y += 2   // breathing room before section label
  y = drawSectionLabel(doc, y, m, contentW, 'Sponsor / Committee')

  const colW  = (contentW - 8) / 2
  const rightX = m + colW + 8

  // #8: inline column sub-labels so first-time readers know which column is which
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6.5)
  doc.setTextColor(...P.muted)
  doc.text('SPONSOR', m, y)
  doc.text('COMMITTEE', rightX, y)
  y += 4

  // ── Left column — Sponsor ────────────────────────────────────────────────

  const name      = bill.prime_sponsor || '—'
  const partyChar = ((bill.prime_party || bill.sponsor_party || '')).charAt(0).toUpperCase()

  // Name — font set before splitTextToSize + getTextWidth (T148)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...P.primary)
  const nameLines = doc.splitTextToSize(name, colW - 10)
  const nameLine0 = nameLines[0] || name
  doc.text(nameLine0, m, y)

  // Party char inline after name
  if (PARTY_COLOR[partyChar] && name !== '—') {
    // Font set before getTextWidth (T148)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    const nameW = doc.getTextWidth(nameLine0)
    doc.setFontSize(8.5)
    doc.setTextColor(...PARTY_COLOR[partyChar])
    doc.text(' (' + partyChar + ')', m + nameW, y)
  }

  // Meta: district · tier · chair · bipartisan
  const sponsorMeta = [
    bill.sponsor_district ? 'Dist. ' + bill.sponsor_district : null,
    SPONSOR_TIER_LABEL[bill.sponsor_tier] || null,
    (bill.sponsor_is_chair || bill.is_committee_chair) ? 'Committee Chair' : null,
    bill.bipartisan ? 'Bipartisan' : null,
  ].filter(Boolean)

  if (sponsorMeta.length) {
    // Font set before splitTextToSize (T148)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    const metaStr   = sponsorMeta.join('  ·  ')
    const metaLines = doc.splitTextToSize(metaStr, colW - 4)
    doc.text(metaLines[0] || metaStr, m, y + 5)
  }

  // ── Right column — Committee ──────────────────────────────────────────────

  // Font set before splitTextToSize (T148)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...P.primary)
  const cmteName  = bill.committee_name || 'No committee assigned'
  const cmteLines = doc.splitTextToSize(cmteName, colW - 4)
  doc.text(cmteLines[0] || cmteName, rightX, y)

  // Chair + hearing countdown
  const cmteMeta = []
  if (bill.committee_chair) cmteMeta.push('Chair: ' + bill.committee_chair)
  if (bill.hearing_date) {
    try {
      const hDate   = new Date(bill.hearing_date)
      const daysOut = Math.ceil((hDate - new Date()) / 86400000)
      const dateStr = hDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const suffix  = daysOut > 0
        ? ' (' + daysOut + ' day' + (daysOut === 1 ? '' : 's') + ')'
        : daysOut === 0 ? ' (today)' : ''
      cmteMeta.push('Hearing ' + dateStr + suffix)
    } catch (e) {}
  }

  if (cmteMeta.length) {
    // Font set before splitTextToSize (T148)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    const cmteStr   = cmteMeta.join('  ·  ')
    const cmteLines2 = doc.splitTextToSize(cmteStr, colW - 4)
    doc.text(cmteLines2[0] || cmteStr, rightX, y + 5)
  }

  return y + 12   // sub-labels added 4mm above, so total block height stays ~same
}

// ── Section 5 — What the bill does ───────────────────────────────────────────

/**
 * EXECUTIVE SUMMARY only (≤3 lines). WHO IS AFFECTED now inline in
 * drawBillIdentity (T152). AI attribution in footer.
 * No surrounding box — prose flows directly under the section rule.
 */
function drawWhatItDoes(doc, y, m, contentW, bill, ph) {
  const sections = structureSummary(bill.custom_summary || bill.ai_summary || '')

  // Executive summary — skip AFFECTED/IMPACT (already surfaced inline above title)
  const execSec = sections.find(s => s.heading && /EXECUTIVE|SUMMARY/i.test(s.heading))
    || sections.find(s => !s.heading && !/AFFECTED|IMPACT/i.test(s.heading || ''))
    || sections.find(s => !s.heading)
    || sections[0]

  y = checkPageBreak(doc, y, 20, ph)
  y += 2
  y = drawSectionLabel(doc, y, m, contentW, 'What the bill does')

  // #3: empty-state fallback — brief still looks intentional, not broken
  if (!execSec?.body) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text('Summary not yet available.', m, y)
    return y + 7
  }

  // Font MUST be set before splitTextToSize (T148 discipline)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(execSec.body, contentW)
  lines.slice(0, 3).forEach(line => {
    y = checkPageBreak(doc, y, 4.5, ph)
    doc.text(line, m, y)
    y += 4.3
  })

  return y + 3
}

// ── Section 6 — Key Signals (text rows with drawn triangles, no chips) ────────

/**
 * T152: Was three colored rounded chip boxes. Now plain text rows.
 * Triangle indicator drawn via doc.triangle() (CP1252-safe).
 * Delta % right-aligned in tier color.
 */
function drawKeySignals(doc, y, m, contentW, scoreFeatures, ph) {
  const positives = (scoreFeatures || []).filter(f => f.pos).sort((a, b) => b.d - a.d).slice(0, 2)
  const negatives = (scoreFeatures || []).filter(f => !f.pos).sort((a, b) => a.d - b.d).slice(0, 1)
  const top = [...positives, ...negatives].slice(0, 3)

  y = checkPageBreak(doc, y, 14, ph)
  y += 2
  y = drawSectionLabel(doc, y, m, contentW, 'Key Signals')

  // #3 + #4: show empty state when no signals; threshold was < 2 (suppressed lone signals)
  if (top.length < 1) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text('Signals not yet computed for this bill.', m, y)
    return y + 7
  }

  const rowH = 5
  top.forEach(f => {
    const isPos    = f.pos
    const deltaPct = (f.d > 0 ? '+' : '') + Math.round(f.d * 100) + '%'

    // Triangle indicator — drawn, not Unicode (CP1252-safe)
    // #9: triCY = y-1.4 (mid cap-height for 8pt ~2.8mm); triR = 1.5 (was 1.8, top poked above cap line)
    const triCX = m + 3
    const triCY = y - 1.4
    const triR  = 1.5
    doc.setFillColor(...(isPos ? P.accent : P.danger))
    if (isPos) {
      // Up triangle: top point up, base down
      doc.triangle(triCX - triR, triCY + triR, triCX + triR, triCY + triR, triCX, triCY - triR, 'F')
    } else {
      // Down triangle: base up, point down
      doc.triangle(triCX - triR, triCY - triR, triCX + triR, triCY - triR, triCX, triCY + triR, 'F')
    }

    // Signal label — normal weight, primary color
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.primary)
    doc.text(f.l || '', m + 8, y)

    // Delta % right-aligned, bold, tier color
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...(isPos ? P.accent : P.danger))
    doc.text(deltaPct, m + contentW, y, { align: 'right' })

    y += rowH
  })

  // PDF-B1: footnote explains delta % is score model impact, not passage probability
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...P.muted)
  doc.text('Signal values show score model impact — not passage probability.', m, y + 1)
  y += 4

  return y + 3
}

// ── Section 7 — Floor votes (plain text rows, no pill boxes) ─────────────────

/**
 * T152: Was rounded pill boxes with brass/red accent bars.
 * Now: "House  ·  62-36  ·  Passed  ·  April 14       D 53-0  R 9-36"
 */
function drawFloorVotes(doc, y, m, contentW, rollCalls, partyBucketsByRcId, ph) {
  // Floor votes section always renders header so the brief looks complete
  y = checkPageBreak(doc, y, 14, ph)
  y += 2
  y = drawSectionLabel(doc, y, m, contentW, 'Floor Vote')

  if (!rollCalls || !rollCalls.length) {
    // #3: empty-state fallback — no silent disappearance
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text('No floor votes on record.', m, y)
    return y + 7
  }

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

  votes.forEach(rc => {
    const passed = (rc.result || '').toLowerCase() === 'passed'
    let dateLbl = ''
    try { dateLbl = formatSessionDate(rc.vote_date) } catch (e) {}
    if (dateLbl === 'session dates TBD') dateLbl = ''

    // Main vote line
    const lineParts = [
      rc.chamber || '',
      (rc.yeas || 0) + '-' + (rc.nays || 0),
      passed ? 'Passed' : 'Failed',
    ]
    if (dateLbl) lineParts.push(dateLbl)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...(passed ? P.primary : P.danger))
    doc.text(lineParts.join('  ·  '), m, y)

    // Party breakdown right-aligned in muted
    const pb = partyBucketsByRcId && rc.id ? partyBucketsByRcId[rc.id] : null
    if (pb) {
      const pbParts = []
      if ((pb.yesD || 0) + (pb.noD || 0) > 0) pbParts.push('D ' + (pb.yesD || 0) + '-' + (pb.noD || 0))
      if ((pb.yesR || 0) + (pb.noR || 0) > 0) pbParts.push('R ' + (pb.yesR || 0) + '-' + (pb.noR || 0))
      if (pbParts.length) {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(7.5)
        doc.setTextColor(...P.muted)
        doc.text(pbParts.join('  '), m + contentW, y, { align: 'right' })
      }
    }

    y += 5.5
  })

  return y + 2
}

// ── Section 8 — Companion bill (conditional) ─────────────────────────────────

function drawCompanion(doc, y, m, contentW, bill, ph) {
  if (!bill.companion_bill) return y
  y = checkPageBreak(doc, y, 12, ph)
  y += 2
  y = drawSectionLabel(doc, y, m, contentW, 'Companion Bill')

  // #12: type-safe — companion_bill may be a string or an object
  const compLabel = typeof bill.companion_bill === 'string'
    ? bill.companion_bill
    : (bill.companion_bill?.label || bill.companion_bill?.bill_number || String(bill.companion_bill))
  const parts = [compLabel]
  if (bill.companion_score != null) {
    // PDF-B1: show tier label so score is legible to a non-insider
    const compTierLbl = getScoreTierLabel(bill.companion_score)
    parts.push(compTierLbl ? compTierLbl + ' (' + bill.companion_score + ')' : 'Score ' + bill.companion_score)
  }
  const stateLbl = companionStateLabel(bill.companion_state)
  if (stateLbl) parts.push(stateLbl)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  doc.text(parts.join('  ·  '), m, y)
  return y + 6
}

// ── Section 9 — Fiscal note (full intelligence upgrade) ───────────────────────

/**
 * T152: Was a single word ("Large"). Now a three-line intelligence block.
 *
 * Line 1: Size label + scope — "Large impact  ·  State + local government"
 * Line 2: Strategic implication — derived from size + fiscal_referral +
 *         double_referral flags, calibrated against actual law rates.
 * Line 3: Change history + date — "Updated from Small  ·  Filed May 14"
 *
 * Size semantics are counter-intuitive without context:
 *   "large" is the BEST signal (44.6% law rate = priority/double-referred)
 *   "medium" is the WORST signal (1.3% law rate = single fiscal committee)
 * The strategic line makes this legible for a non-insider reader.
 */
function drawFiscalNote(doc, y, m, contentW, fiscalNote, bill, ph) {
  const size = fiscalNote ? (fiscalNote.size || fiscalNote.new_size) : bill.fiscal_note_size
  // PDF-B1: always render section — knowing there is NO fiscal note is actionable
  if (!size || size === 'none') {
    y = checkPageBreak(doc, y, 10, ph)
    y += 2
    y = drawSectionLabel(doc, y, m, contentW, 'Fiscal Note')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text('No fiscal note on file.', m, y)
    return y + 7
  }

  y = checkPageBreak(doc, y, 22, ph)
  y += 2
  y = drawSectionLabel(doc, y, m, contentW, 'Fiscal Note')

  // ── Line 1: Size label + scope ────────────────────────────────────────────
  const sizeLabelMap = { large: 'Large impact', medium: 'Moderate impact', small: 'Small impact' }
  const sizeLabel = sizeLabelMap[size] || 'Fiscal note on file'
  const hasLocal  = fiscalNote?.has_local_impact
  const scopePart = hasLocal ? 'State + local government' : 'State general fund'

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.primary)
  doc.text(sizeLabel + '  ·  ' + scopePart, m, y)
  y += 5

  // ── Line 2: Strategic implication ────────────────────────────────────────
  // Derive tier from size + referral flags (mirrors sync-v2.9 classification)
  const fRef = bill.fiscal_referral
  let strategyKey = null
  if (size === 'large')  strategyKey = 'large'
  else if (size === 'medium') strategyKey = 'medium'
  else if (size === 'small')  strategyKey = fRef ? 'small_ref' : 'small'

  if (strategyKey && FISCAL_STRATEGY[strategyKey]) {
    // Font MUST be set before splitTextToSize (T148 discipline)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    const stLines = doc.splitTextToSize(FISCAL_STRATEGY[strategyKey], contentW)
    stLines.slice(0, 2).forEach(line => {
      doc.text(line, m, y)
      y += 4.3
    })
  }

  // ── Line 3: Change history + date ────────────────────────────────────────
  const metaParts = []
  const prevSize  = fiscalNote?.previous_size
  if (prevSize && prevSize !== size && prevSize !== 'none') {
    const fromLbl = prevSize.charAt(0).toUpperCase() + prevSize.slice(1)
    const toLbl   = size.charAt(0).toUpperCase() + size.slice(1)
    metaParts.push('Updated from ' + fromLbl + ' to ' + toLbl)
  }
  const updated = fiscalNote
    ? (fiscalNote.detected_date || fiscalNote.updated_at)
    : bill.fiscal_note_updated_at
  if (updated) {
    let dateStr = ''
    try { dateStr = formatSessionDate(updated) } catch (e) { dateStr = String(updated).slice(0, 10) }
    if (dateStr && dateStr !== 'session dates TBD') metaParts.push('Filed ' + dateStr)
  }

  if (metaParts.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...P.muted)
    doc.text(metaParts.join('  ·  '), m, y)
    y += 4
  }

  return y + 3
}

// ── Section 10 — Stage timeline (conditional, 3+ transitions only) ────────────

function drawTimeline(doc, y, m, contentW, snapshots, ph) {
  const events = buildBillTimeline(snapshots)
  if (events.length < 3) return y

  y = checkPageBreak(doc, y, 12, ph)
  y += 2
  y = drawSectionLabel(doc, y, m, contentW, 'Stage History')

  const parts = events.map(e => {
    try {
      const d = new Date(e.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      return e.label + ' ' + d
    } catch { return e.label }
  })

  // Font MUST be set before splitTextToSize (T148 discipline)
  // #7: use middle dot (CP1252 \xB7) consistent with rest of doc; > read as comparison operator
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.primary)
  const lines = doc.splitTextToSize(parts.join('  \xB7  '), contentW)
  lines.slice(0, 2).forEach(line => {
    y = checkPageBreak(doc, y, 4.5, ph)
    doc.text(line, m, y)
    y += 4.3
  })
  return y + 2
}

// ── Footer ────────────────────────────────────────────────────────────────────

function drawFooter(doc, ph, m, pw, bill, generatedAt) {
  const fy    = ph - 13
  const stamp = generatedAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
  const line1 = 'Generated ' + stamp
  const line2 = 'Not legal advice  ·  Summary contains AI-generated content'

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
 * Signature unchanged from T32 — call site in bill/[id]/page.js requires
 * no modification. Legacy params retained for backwards compatibility;
 * T150–T152 layout does not use recentRollCall, partyBuckets, or companion.
 *
 * @param {Object} input
 * @param {Object} input.bill                   Bills row from Supabase.
 * @param {Array<{l,d,pos}>} [input.scoreFeatures]  latestSnap.xf_factors.
 * @param {Array}  [input.rollCalls]             Roll-call rows; latest per chamber used.
 * @param {Object} [input.partyBucketsByRcId]    Map id -> {yesD,yesR,noD,noR}.
 * @param {Object} [input.recentRollCall]        Legacy compat — not used.
 * @param {Object} [input.partyBuckets]          Legacy compat — not used.
 * @param {Array}  [input.recentAmendments]      Legacy compat — not used.
 * @param {Array}  [input.snapshots]             Stage history for timeline.
 * @param {Object} [input.companion]             Reserved — not used.
 * @param {Object} [input.fiscalNote]            fiscal_note_history row (most recent).
 * @param {Date}   [input.generatedAt]           Render timestamp; defaults to now.
 * @returns {Promise<string>} Filename of the saved PDF.
 */
export async function generatePublicBriefPDF({
  bill,
  scoreFeatures      = [],
  rollCalls          = null,
  partyBucketsByRcId = null,
  recentRollCall     = null,    // legacy compat
  partyBuckets       = null,    // legacy compat
  recentAmendments   = [],      // legacy compat
  snapshots          = null,
  companion          = null,    // reserved
  fiscalNote         = null,
  generatedAt        = new Date(),
  output             = 'save',  // ER4 (F8): 'save' = download (default); 'blob' = return bytes for share sheet
} = {}) {
  if (!bill) throw new Error('generatePublicBriefPDF: bill is required')

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const m  = 16
  const contentW = pw - 2 * m
  let y = 14

  // ── Render pipeline ──────────────────────────────────────────────────────

  // Header: logo, domain, generated date, session context
  y = await drawHeader(doc, y, m, pw, contentW, generatedAt)

  // Bill identity: number · session · title · category · inline Affects
  y = drawBillIdentity(doc, y, m, contentW, bill)

  // Status & Trajectory: stage · tier word · one-liner (merged, no boxes)
  y = drawStatusAndScore(doc, y, m, contentW, bill)

  // Sponsor / Committee: two-column text block (no cards)
  y = drawSponsorCommittee(doc, y, m, contentW, bill)

  // What it does: executive summary prose (no surrounding box)
  y = drawWhatItDoes(doc, y, m, contentW, bill, ph)

  // Key Signals: text rows with drawn triangles (no chips)
  y = drawKeySignals(doc, y, m, contentW, scoreFeatures, ph)

  // Conditional: each section self-guards with checkPageBreak
  y = drawFloorVotes(doc, y, m, contentW, Array.isArray(rollCalls) ? rollCalls : [], partyBucketsByRcId || {}, ph)
  y = drawCompanion(doc, y, m, contentW, bill, ph)
  y = drawFiscalNote(doc, y, m, contentW, fiscalNote, bill, ph)
  y = drawTimeline(doc, y, m, contentW, snapshots, ph)

  // ─────────────────────────────────────────────────────────────────────────

  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    drawFooter(doc, ph, m, pw, bill, generatedAt)
  }

  const safeBill = ((bill.chamber === 'House' ? 'HB' : 'SB') + '-' + (bill.bill_number || '')).replace(/[^a-zA-Z0-9-]/g, '-')
  const safeDate = generatedAt.toISOString().slice(0, 10)
  const filename  = safeBill + '-brief-' + safeDate + '.pdf'
  // ER4 (F8): additive output option. Rendering above is unchanged; this only
  // chooses delivery — return the finished bytes as a Blob for the share sheet,
  // or save() to download (default, byte-for-byte the legacy behavior).
  if (output === 'blob') return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return filename
}
