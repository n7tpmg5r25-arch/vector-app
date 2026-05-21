/**
 * Vector | WA — Member Baseball Card PDF Generator
 * Thread 113: Added drawBackground() and drawLegislativeFocus() sections
 *
 * Call generateMemberPdf(member, memberBills, session, bio) where bio
 * is a row from the legislator_bios table (may be null — sections degrade gracefully).
 */

import jsPDF from 'jspdf'
import {
  VECTOR_PALETTE,
  loadImageAsBase64,
  loadSvgWithFillSwap,
  getScoreColor,
} from './pdf-shared'

const P = VECTOR_PALETTE
const VECTOR_DOMAIN = 'vectorwa' + '.' + 'com'

const TIER_TEXT = {
  1: 'TIER 1 -- MAJORITY LEADERSHIP',
  2: 'TIER 2 -- SENIOR MEMBER',
  3: 'TIER 3 -- MEMBER',
  4: 'TIER 4 -- MINORITY',
}

function chamberPrefix(chamber) {
  return chamber === 'Senate' ? 'SEN.' : 'REP.'
}

function partyName(party) {
  if (party === 'D') return 'Democrat'
  if (party === 'R') return 'Republican'
  if (party === 'L') return 'Libertarian'
  return party || 'Unknown'
}

function trunc(str, maxLen) {
  if (!str) return ''
  return str.length > maxLen ? str.slice(0, maxLen - 1) + '...' : str
}

function wrapText(doc, text, maxW) {
  return doc.splitTextToSize(text || '', maxW)
}

function billLabel(bill) {
  const prefix = (bill.chamber || bill.prime_sponsor_chamber || 'House') === 'Senate' ? 'SB' : 'HB'
  return prefix + ' ' + (bill.bill_number || '')
}

// ── Section 1 — Header band ──────────────────────────────────────────────────

async function drawHeader(doc, y, m, pw, generatedAt) {
  const logoH = 22
  const logoW = logoH * (895 / 500)

  let logoDrawn = false
  try {
    const dataUrl = await loadSvgWithFillSwap('/logos/vector-wa-primary.svg', {
      '#ebeae4': '#0e1014',
    })
    if (dataUrl) {
      doc.addImage(dataUrl, 'PNG', m, y - 1, logoW, logoH)
      logoDrawn = true
    }
  } catch (_) {}

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

  let photoDrawn = false
  if (member.member_id) {
    try {
      const photoData = await loadImageAsBase64('/api/member-photo/' + member.member_id)
      if (photoData) {
        doc.addImage(photoData, 'JPEG', photoX, y, photoW, photoH)
        photoDrawn = true
      }
    } catch (_) {}
  }

  if (!photoDrawn) {
    doc.setFillColor(...P.surface)
    doc.setDrawColor(...P.neutralLt)
    doc.setLineWidth(0.3)
    doc.rect(photoX, y, photoW, photoH, 'FD')
    const initials = (member.name || '').split(' ').map(n => n[0]).slice(-2).join('')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...P.muted)
    doc.text(initials, photoX + photoW / 2, y + photoH / 2 + 4, { align: 'center' })
  }

  const partyRgb = member.party === 'D' ? [77, 154, 255]
    : member.party === 'R' ? [239, 68, 68]
    : [...P.neutralLt]
  doc.setFillColor(...partyRgb)
  doc.rect(photoX, y, 1.5, photoH, 'F')

  let ty = y + 5

  const fullName = chamberPrefix(member.chamber) + ' ' + (member.name || '').toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...P.primary)
  const nameLines = wrapText(doc, fullName, textW)
  doc.text(nameLines, textX, ty)
  ty += nameLines.length * 7 + 1

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

  if (member.is_chair || member.tier <= 2) {
    const roleLabel = member.is_chair ? 'Committee Chair'
      : member.tier === 1 ? 'Majority Leadership'
      : 'Senior Member'
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.accent)
    doc.text(roleLabel, textX, ty)
    ty += 5
  }

  ty += 3

  if (member.phone) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...P.primary)
    doc.text(member.phone, textX, ty)
    ty += 5
  }

  if (member.email) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.muted)
    doc.text(trunc(member.email, 45), textX, ty)
    ty += 5
  }

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...P.muted)
  doc.text('Legislative Building  ·  Olympia, WA 98504', textX, ty)

  return Math.max(y + photoH, ty) + 6
}

// ── Section label helper ─────────────────────────────────────────────────────

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

// ── Section 2.5 — Background (Thread 113) ────────────────────────────────────

function drawBackground(doc, y, m, contentW, bio) {
  if (!bio) return y

  const { education, occupation, family, first_elected_year } = bio

  // Build the three display lines — skip any that have no data
  const lines = []

  // Education line: "Georgetown University — B.S.F.S.  |  UW — M.P.A."
  if (education && education.length > 0) {
    const edLine = education.slice(0, 2).map(e => {
      const parts = [e.school, e.degree && e.field ? `${e.degree} ${e.field}` : (e.degree || e.field)]
      return parts.filter(Boolean).join(' — ')
    }).join('  |  ')
    if (edLine.trim()) lines.push({ text: edLine, icon: null })
  }

  // Career line: "Planner  ·  City Council  ·  State Senator since 2014"
  if (occupation && occupation.length > 0) {
    let careerLine = occupation.slice(0, 4).join('  ·  ')
    if (first_elected_year) careerLine += `  ·  Legislature since ${first_elected_year}`
    lines.push({ text: careerLine, icon: null })
  } else if (first_elected_year) {
    lines.push({ text: `Legislature since ${first_elected_year}`, icon: null })
  }

  // Family line
  if (family) {
    lines.push({ text: family, icon: null })
  }

  if (!lines.length) return y

  y = drawSectionLabel(doc, y, m, contentW, 'Background')

  for (const { text } of lines) {
    const wrapped = wrapText(doc, trunc(text, 140), contentW)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.primary)
    doc.text(wrapped.slice(0, 2), m, y)
    y += wrapped.slice(0, 2).length * 4.5
  }

  return y + 4
}

// ── Section 3 — Committee assignments ───────────────────────────────────────

function drawCommittees(doc, y, m, contentW, pw, member) {
  y = drawSectionLabel(doc, y, m, contentW, 'Committee Assignments')

  const committees = member.committees || []

  if (!committees.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...P.muted)
    doc.text('No committee assignments on record', m, y)
    return y + 8
  }

  committees.forEach((cmte, idx) => {
    if (!cmte || !cmte.trim()) return

    const isChairRow = idx === 0 && !!member.is_chair

    if (isChairRow) {
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...P.accent)
    } else {
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...P.primary)
    }
    doc.setFontSize(9)

    const prefix = isChairRow ? '* ' : '  '
    const lines = wrapText(doc, prefix + cmte, contentW - 2)
    doc.text(lines, m, y)
    y += lines.length * 4.5
  })

  return y + 4
}

// ── Section 4 — Vector | WA Intelligence ────────────────────────────────────

function drawIntelligence(doc, y, m, contentW, pw, member, session) {
  const sessionLabel = session
    ? 'VECTOR | WA INTELLIGENCE  --  ' + session
    : 'VECTOR | WA INTELLIGENCE'

  y = drawSectionLabel(doc, y, m, contentW, sessionLabel)

  doc.setFillColor(...P.surface)
  doc.rect(m, y - 2, contentW, 9, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...P.accent)
  doc.text(TIER_TEXT[member.tier] || TIER_TEXT[3], m + 2, y + 4)
  y += 11

  const statW = contentW / 4
  const rows = [
    [
      { label: 'Bills Sponsored', value: String(member.bill_count || 0) },
      { label: 'Laws Passed',     value: String(member.laws_passed || 0) },
      { label: 'Pass Rate',       value: (member.pass_rate || 0) + '%' },
      { label: 'Hearings',        value: String(member.hearing_count || 0) },
    ],
    [
      { label: 'Avg Score',    value: String(member.avg_score || 0) },
      { label: 'Top Score',    value: String(member.top_score || 0) },
      { label: 'Cmte Passes', value: String(member.committee_passes || 0) },
      { label: 'Session',     value: (session || '').replace('-', '/') },
    ],
  ]

  rows.forEach(row => {
    row.forEach(({ label, value }, i) => {
      const sx = m + i * statW
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      doc.setTextColor(...P.muted)
      doc.text(label.toUpperCase(), sx + 1, y)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...P.primary)
      doc.text(value, sx + 1, y + 5)
    })
    y += 11
  })

  return y + 3
}

// ── Section 5 — Top bills ────────────────────────────────────────────────────

function drawTopBills(doc, y, m, contentW, pw, memberBills, session) {
  y = drawSectionLabel(doc, y, m, contentW, 'Top Bills This Session')

  let bills = (memberBills || [])
    .filter(b => !session || b.session === session)
    .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
    .slice(0, 5)

  if (!bills.length) {
    bills = [...(memberBills || [])]
      .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
      .slice(0, 5)
  }

  if (!bills.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...P.muted)
    doc.text('No sponsored bills on record', m, y)
    return y + 8
  }

  const numColW = 14
  const titleW  = contentW - numColW - 14

  bills.forEach(bill => {
    const score    = bill.final_score || 0
    const scoreRgb = getScoreColor(score)
    const label    = billLabel(bill)
    const title    = trunc(bill.title || bill.committee_name || 'Untitled', 80)

    doc.setFont('courier', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.accent)
    doc.text(label, m, y + 3)

    const titleLines = wrapText(doc, title, titleW)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.primary)
    doc.text(titleLines.slice(0, 2), m + numColW, y + 3)

    const circleR = 3.5
    const scoreX  = m + contentW - circleR - 1
    const scoreY  = y + 3
    doc.setFillColor(...scoreRgb)
    doc.circle(scoreX, scoreY - circleR + 1, circleR, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...P.white)
    doc.text(String(score), scoreX, scoreY + 0.5, { align: 'center' })

    y += Math.max(5.5, Math.min(titleLines.length, 2) * 4.5) + 1.5
  })

  return y + 3
}

// ── Section 5.5 — Legislative Focus (Thread 113) ────────────────────────────

function drawLegislativeFocus(doc, y, m, contentW, bio) {
  if (!bio) return y

  const priorities = bio.priorities || []
  const summary    = bio.bio_summary || null

  if (!priorities.length && !summary) return y

  y = drawSectionLabel(doc, y, m, contentW, 'Legislative Focus')

  // Priority chips — small pill labels across the page
  if (priorities.length > 0) {
    const chipH    = 5.5
    const chipPadX = 4
    const chipGap  = 3
    let cx         = m

    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')

    // Brass-tinted band behind the priority chips row
    doc.setFillColor(26, 24, 18)
    doc.rect(m - 2, y - chipH - 1, contentW + 4, chipH + 4, 'F')

    for (const p of priorities.slice(0, 6)) {
      const label = p.toUpperCase()
      const chipW = doc.getTextWidth(label) + chipPadX * 2

      // Wrap to next line if overflow
      if (cx + chipW > m + contentW) {
        cx  = m
        y  += chipH + 2
      }

      // Chip background
      doc.setFillColor(28, 32, 42)   // dark surface
      doc.setDrawColor(...P.accent)
      doc.setLineWidth(0.4)
      doc.roundedRect(cx, y - chipH + 1, chipW, chipH, 1.2, 1.2, 'FD')

      // Chip label
      doc.setTextColor(...P.accent)
      doc.text(label, cx + chipPadX, y - 0.5)

      cx += chipW + chipGap
    }

    y += chipH + 2
  }

  // Bio summary below chips (if fits)
  if (summary) {
    y += 2
    const wrapped = wrapText(doc, summary, contentW)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text(wrapped.slice(0, 4), m, y)
    y += wrapped.slice(0, 4).length * 4
  }

  return y + 4
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
  doc.text('Vector | WA  ·  Washington State Legislative Intelligence', m, fy + 3)
  doc.text('CONFIDENTIAL BRIEFING  ·  Generated ' + stamp, pw - m, fy + 3, { align: 'right' })
}

// ── Main export ──────────────────────────────────────────────────────────────

// bio param is a row from legislator_bios table (nullable)
export async function generateMemberPdf(member, memberBills, session, bio = null) {
  if (!member) throw new Error('generateMemberPdf: member is required')

  const generatedAt = new Date()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const m  = 16
  const contentW = pw - 2 * m
  let y = 14

  y = await drawHeader(doc, y, m, pw, generatedAt)
  y = await drawIdentity(doc, y, m, pw, contentW, member)
  y = drawLegislativeFocus(doc, y, m, contentW, bio)    // Thread 115: moved to position 3

  // ── Two-column lower body (Thread 115) ───────────────────────────────────
  const colSplit = 0.60         // left col = 60%, right = 38%, gap = 2%
  const leftW    = contentW * colSplit - 2
  const rightW   = contentW * (1 - colSplit - 0.02)
  const rightX   = m + contentW * (colSplit + 0.02)

  const yCol  = y
  const yLeft = drawTopBills(doc, yCol, m, leftW, pw, memberBills, session)

  let yRight = drawCommittees(doc, yCol, rightX, rightW, pw, member)
  yRight     = drawBackground(doc, yRight, rightX, rightW, bio)

  // Vertical separator between columns
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.2)
  const sepX = m + contentW * colSplit
  doc.line(sepX, yCol - 2, sepX, Math.max(yLeft, yRight) + 2)

  y = Math.max(yLeft, yRight) + 4
  // ─────────────────────────────────────────────────────────────────────────

  y = drawIntelligence(doc, y, m, contentW, pw, member, session)
  drawFooter(doc, m, pw, ph, generatedAt)

  const lastName = (member.name || 'member')
    .split(' ').pop().toLowerCase().replace(/[^a-z0-9]/g, '')
  const sessionSlug = (session || 'wa').replace('/', '-').replace(/\s/g, '-')

  doc.save(`${lastName}-member-card-${sessionSlug}.pdf`)
}
