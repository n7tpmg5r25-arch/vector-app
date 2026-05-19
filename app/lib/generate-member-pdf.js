/**
 * Vector | WA — Member Baseball Card PDF Generator
 *
 * Thread 112: single-page portrait briefing document for pre-meeting
 * preparation. C-suite ready. Designed to be printed, folded, and handed
 * to a chief of staff.
 *
 * Layout (Letter 215.9 x 279.4mm, 16mm margins):
 *   1. Header band — Vector | WA logo + vectorwa.com + generated date
 *   2. Identity block — photo (left 45mm) + name / district / contact (right)
 *   3. Committee assignments — chairs flagged with star
 *   4. Vector | WA Intelligence — tier / bills / laws / pass rate / scores
 *   5. Top 5 bills this session by trajectory score
 *   6. Footer — confidential briefing stamp + date
 *
 * Uses pdf-shared.js helpers for the palette and logo SVG repaint so the
 * header stays in sync with the bill brief generator.
 *
 * jsPDF built-in fonts (Helvetica/Courier) support Windows-1252 characters
 * only. No Unicode box-drawing, Greek, or arrows in PDF text.
 */

import jsPDF from 'jspdf'
import {
  VECTOR_PALETTE,
  loadImageAsBase64,
  loadSvgWithFillSwap,
  getScoreColor,
} from './pdf-shared'

// ── Shorthand alias ──────────────────────────────────────────────────────────
const P = VECTOR_PALETTE

// ── Constants ────────────────────────────────────────────────────────────────
const VECTOR_DOMAIN = 'vectorwa' + '.' + 'com'

// Tier labels — must stay in sync with app/lib/members-scoring.js TIER_LABELS
const TIER_TEXT = {
  1: 'TIER 1 — MAJORITY LEADERSHIP',
  2: 'TIER 2 — SENIOR MEMBER',
  3: 'TIER 3 — MEMBER',
  4: 'TIER 4 — MINORITY',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Prefix for the full-name line: "REP. Jane Doe" / "SEN. Jane Doe". */
function chamberPrefix(chamber) {
  return chamber === 'Senate' ? 'SEN.' : 'REP.'
}

/** Plain-English party name. */
function partyName(party) {
  if (party === 'D') return 'Democrat'
  if (party === 'R') return 'Republican'
  if (party === 'L') return 'Libertarian'
  return party || 'Unknown'
}

/** Safe string truncation with ellipsis. */
function trunc(str, maxLen) {
  if (!str) return ''
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str
}

/**
 * Wrap text to multiple lines given a max pixel width equivalent in mm.
 * jsPDF exposes doc.splitTextToSize(text, maxWidth) for this.
 */
function wrapText(doc, text, maxW) {
  return doc.splitTextToSize(text || '', maxW)
}

/** Bill number prefix from chamber. */
function billLabel(bill) {
  const prefix = (bill.chamber || bill.prime_sponsor_chamber || 'House') === 'Senate' ? 'SB' : 'HB'
  return prefix + ' ' + (bill.bill_number || '')
}

// ── Section 1 — Header band ──────────────────────────────────────────────────
// Mirrors drawHeaderBand in generate-public-pdf.js; uses shared loadSvgWithFillSwap.

async function drawHeader(doc, y, m, pw, generatedAt) {
  const logoH = 22
  const logoW = logoH * (895 / 500) // ~39.4mm — matches SVG aspect ratio

  let logoDrawn = false
  try {
    const dataUrl = await loadSvgWithFillSwap('/logos/vector-wa-primary.svg', {
      '#ebeae4': '#0e1014',
    })
    if (dataUrl) {
      doc.addImage(dataUrl, 'PNG', m, y - 1, logoW, logoH)
      logoDrawn = true
    }
  } catch (_) {
    // Swallow — fall through to text fallback
  }

  if (!logoDrawn) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(...P.primary)
    doc.text('VECTOR | WA', m, y + 12)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text('WASHINGTON STATE LEGISLATIVE INTELLIGENCE', m, y + 18)
  }

  // Right: domain + date
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...P.accent)
  doc.text(VECTOR_DOMAIN, pw - m, y + 6, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.muted)
  const stamp = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
  doc.text('Generated ' + stamp, pw - m, y + 12, { align: 'right' })

  // Separator line under header
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, y + logoH + 1, pw - m, y + logoH + 1)

  return y + logoH + 5
}

// ── Section 2 — Identity block ───────────────────────────────────────────────

async function drawIdentity(doc, y, m, pw, contentW, member) {
  const photoW = 45
  const photoH = 60
  const photoX = m
  const textX  = m + photoW + 6
  const textW  = contentW - photoW - 6

  // --- Left column: photo ---
  let photoDrawn = false
  if (member.member_id) {
    try {
      const photoUrl = '/api/member-photo/' + member.member_id
      const photoData = await loadImageAsBase64(photoUrl)
      if (photoData) {
        doc.addImage(photoData, 'JPEG', photoX, y, photoW, photoH)
        photoDrawn = true
      }
    } catch (_) {
      // Swallow — fall to placeholder
    }
  }

  if (!photoDrawn) {
    // Placeholder: filled rect + initials
    doc.setFillColor(...P.surface)
    doc.setDrawColor(...P.neutralLt)
    doc.setLineWidth(0.3)
    doc.rect(photoX, y, photoW, photoH, 'FD')
    const initials = (member.name || '')
      .split(' ')
      .map(n => n[0])
      .slice(-2)
      .join('')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...P.muted)
    doc.text(initials, photoX + photoW / 2, y + photoH / 2 + 4, { align: 'center' })
  }

  // Party-color side bar on photo
  const partyRgb = member.party === 'D' ? [77, 154, 255]
    : member.party === 'R' ? [239, 68, 68]
    : P.neutralLt
  doc.setFillColor(...partyRgb)
  doc.rect(photoX, y, 1.5, photoH, 'F')

  // --- Right column: identity text ---
  let ty = y + 5

  // Name (large, bold)
  const fullName = chamberPrefix(member.chamber) + ' ' + (member.name || '').toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...P.primary)
  const nameLines = wrapText(doc, fullName, textW)
  doc.text(nameLines, textX, ty)
  ty += nameLines.length * 7 + 1

  // District · Chamber · Party
  const districtLine = [
    member.district ? 'District ' + member.district : null,
    member.chamber || null,
    partyName(member.party),
  ].filter(Boolean).join(' · ')

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...P.muted)
  doc.text(districtLine, textX, ty)
  ty += 5

  // Role label (tier 1 or is_chair)
  const tierText = TIER_TEXT[member.tier] || TIER_TEXT[3]
  const tierShort = member.tier === 1 ? 'Majority Leadership'
    : member.tier === 2 ? 'Senior Member'
    : member.tier === 4 ? 'Minority'
    : null

  if (member.is_chair || member.tier <= 2) {
    const roleLabel = member.is_chair ? 'Committee Chair'
      : tierShort || ''
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.accent)
    doc.text(roleLabel, textX, ty)
    ty += 5
  }

  ty += 3 // spacer

  // Phone
  if (member.phone) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...P.primary)
    doc.text(member.phone, textX, ty)
    ty += 5
  }

  // Email
  if (member.email) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.muted)
    doc.text(trunc(member.email, 45), textX, ty)
    ty += 5
  }

  // Office line (always shown — WA Leg offices are public record)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...P.muted)
  doc.text('Legislative Building  ·  Olympia, WA 98504', textX, ty)
  ty += 4

  // Advance y past the taller of the two columns
  return Math.max(y + photoH, ty) + 6
}

// ── Section 3 — Committee assignments ───────────────────────────────────────

function drawSection(doc, y, m, contentW, pw, label) {
  // DM Mono-style label: small caps, brass, letter-spaced
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...P.accent)
  doc.text(label.toUpperCase(), m, y)
  y += 1.5

  // Thin brass separator line
  doc.setDrawColor(...P.accent)
  doc.setLineWidth(0.4)
  doc.line(m, y, m + contentW, y)

  return y + 4
}

function drawCommittees(doc, y, m, contentW, pw, member) {
  y = drawSection(doc, y, m, contentW, pw, 'Committee Assignments')

  const rawCommittees = member.committees || []

  if (!rawCommittees.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...P.muted)
    doc.text('No committee assignments on record', m, y)
    return y + 8
  }

  // Chairs first (star prefix), then regular members (dot prefix)
  // The committees field is a string array of names; is_chair is a
  // single flag — we mark the first committee as chaired when is_chair===true
  const committees = [...rawCommittees]

  let first = true
  for (const cmte of committees) {
    if (!cmte || !cmte.trim()) continue
    const prefix = (first && member.is_chair) ? '★ ' : '  '
    first = false

    const lines = wrapText(doc, prefix + cmte, contentW - 2)
    doc.setFont('helvetica', first ? 'bold' : 'normal')
    doc.setFontSize(9)
    doc.setTextColor(
      (committees.indexOf(cmte) === 0 && member.is_chair)
        ? P.accent
        : P.primary
    )
    // Italic for chair row, normal for rest
    if (committees.indexOf(cmte) === 0 && member.is_chair) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...P.accent)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...P.primary)
    }
    doc.text(lines, m, y)
    y += lines.length * 4.5
  }

  return y + 4
}

// ── Section 4 — Vector | WA Intelligence ────────────────────────────────────

function drawIntelligence(doc, y, m, contentW, pw, member, session) {
  const sessionLabel = session
    ? 'VECTOR | WA INTELLIGENCE  —  ' + session
    : 'VECTOR | WA INTELLIGENCE'

  y = drawSection(doc, y, m, contentW, pw, sessionLabel)

  // Tier band — full-width, brass-tinted surface
  const tierText = TIER_TEXT[member.tier] || TIER_TEXT[3]
  doc.setFillColor(...P.surface)
  doc.rect(m, y - 2, contentW, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...P.accent)
  doc.text(tierText, m + 2, y + 4)
  y += 11

  // Stat grid: two rows, 4 cols each
  const statW = contentW / 4

  const row1 = [
    { label: 'Bills Sponsored', value: String(member.bill_count || 0) },
    { label: 'Laws Passed',     value: String(member.laws_passed || 0) },
    { label: 'Pass Rate',       value: (member.pass_rate || 0) + '%' },
    { label: 'Hearings',        value: String(member.hearing_count || 0) },
  ]

  const row2 = [
    { label: 'Avg Score',  value: String(member.avg_score || 0) },
    { label: 'Top Score',  value: String(member.top_score || 0) },
    { label: 'Cmte Passes', value: String(member.committee_passes || 0) },
    { label: 'Session',    value: (session || '').replace('-', '–') },
  ]

  for (const row of [row1, row2]) {
    for (let i = 0; i < row.length; i++) {
      const sx = m + i * statW
      const { label, value } = row[i]

      // Label above in small caps muted
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...P.muted)
      doc.text(label.toUpperCase(), sx + 1, y)

      // Value in bold primary
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...P.primary)
      doc.text(value, sx + 1, y + 5)
    }
    y += 11
  }

  return y + 3
}

// ── Section 5 — Top bills ────────────────────────────────────────────────────

function drawTopBills(doc, y, m, contentW, pw, memberBills, session) {
  y = drawSection(doc, y, m, contentW, pw, 'Top Bills This Session')

  // Filter to current session, sort by score desc, take top 5
  const sessionBills = (memberBills || [])
    .filter(b => !session || (b.session === session))
    .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
    .slice(0, 5)

  if (!sessionBills.length) {
    // Fall back to top 5 across all sessions
    const allBills = [...(memberBills || [])]
      .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
      .slice(0, 5)

    if (!allBills.length) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...P.muted)
      doc.text('No sponsored bills on record', m, y)
      return y + 8
    }

    return renderBillRows(doc, y, m, contentW, allBills)
  }

  return renderBillRows(doc, y, m, contentW, sessionBills)
}

function renderBillRows(doc, y, m, contentW, bills) {
  const scoreColW = 14
  const numColW   = 14
  const titleW    = contentW - numColW - scoreColW - 4

  for (const bill of bills) {
    const score = bill.final_score || 0
    const scoreRgb = getScoreColor(score)
    const label  = billLabel(bill)
    const title  = trunc(bill.title || bill.committee_name || 'Untitled', 80)

    // Bill number — DM Mono style via courier
    doc.setFont('courier', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.accent)
    doc.text(label, m, y + 3)

    // Title — truncated, normal weight
    const titleLines = wrapText(doc, title, titleW)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.primary)
    doc.text(titleLines.slice(0, 2), m + numColW, y + 3)

    // Score badge — filled circle + number, right-aligned
    const scoreX = m + contentW - 2
    const scoreY = y + 3
    const circleR = 3.5
    doc.setFillColor(...scoreRgb)
    doc.circle(scoreX - circleR - 0.5, scoreY - circleR + 1, circleR, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...P.white)
    doc.text(String(score), scoreX - circleR - 0.5, scoreY + 0.5, { align: 'center' })

    const rowH = Math.max(5.5, titleLines.slice(0, 2).length * 4.5)
    y += rowH + 1.5
  }

  return y + 3
}

// ── Footer ───────────────────────────────────────────────────────────────────

function drawFooter(doc, m, pw, ph, generatedAt) {
  const fy = ph - 14

  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, fy - 2, pw - m, fy - 2)

  const stamp = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text(
    'Vector | WA  ·  Washington State Legislative Intelligence',
    m, fy + 3
  )
  doc.text(
    'CONFIDENTIAL BRIEFING  ·  Generated ' + stamp,
    pw - m, fy + 3, { align: 'right' }
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a single-page member "baseball card" PDF and trigger download.
 *
 * @param {Object} member       Member object from v_member_stats_by_session:
 *                              { name, party, chamber, district, member_id,
 *                                phone, email, is_chair, tier, committees,
 *                                bill_count, laws_passed, pass_rate, avg_score,
 *                                top_score, hearing_count, committee_passes }
 * @param {Array}  memberBills  Bill objects: { bill_number, title, final_score,
 *                              chamber, session }
 * @param {string} session      e.g. '2025-2026'
 * @returns {Promise<void>}     Triggers browser download.
 */
export async function generateMemberPdf(member, memberBills, session) {
  if (!member) throw new Error('generateMemberPdf: member is required')

  const generatedAt = new Date()

  // Letter size — 215.9 x 279.4mm
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const m  = 16
  const contentW = pw - 2 * m
  let y = 14

  // 1. Header band
  y = await drawHeader(doc, y, m, pw, generatedAt)

  // 2. Identity block (photo + name + contact)
  y = await drawIdentity(doc, y, m, pw, contentW, member)

  // 3. Committee assignments
  y = drawCommittees(doc, y, m, contentW, pw, member)

  // 4. Vector | WA Intelligence metrics
  y = drawIntelligence(doc, y, m, contentW, pw, member, session)

  // 5. Top bills this session
  y = drawTopBills(doc, y, m, contentW, pw, memberBills, session)

  // 6. Footer (pinned to bottom — drawn last, doesn't advance y)
  drawFooter(doc, m, pw, ph, generatedAt)

  // Build filename: abbarno-member-card-2025-2026.pdf
  const lastName = (member.name || 'member')
    .split(' ')
    .pop()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
  const sessionSlug = (session || 'wa').replace('/', '-').replace(/\s/g, '-')
  const filename = `${lastName}-member-card-${sessionSlug}.pdf`

  doc.save(filename)
}
