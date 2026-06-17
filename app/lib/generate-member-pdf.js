/**
 * Vector | WA — Member Brief PDF Generator
 *
 * T147 (2026-05-25): Full C-suite quality rewrite.
 *
 * What changed vs. Thread 112/113/115:
 *  - Logo reduced (logoH 22 → 14) — was dominating the header
 *  - "CONFIDENTIAL BRIEFING" removed — wrong framing for a shareable brief
 *  - "VECTOR | WA INTELLIGENCE" section label removed — brand already in header
 *  - Vector mention in footer removed — logo + domain in header is sufficient
 *  - Priority chip styling flipped to light (surface bg, brass border) — the
 *    previous dark panels were designed for the UI dark theme; on white paper
 *    they printed as blobs
 *  - AI attribution tag added under bio summary
 *  - leadership_role from bio surfaced in identity block
 *  - Electoral margin (from legislator_elections) added as one-liner in identity
 *  - Official leg.wa.gov profile URL added (constructable from chamber + name)
 *  - "Legislative Building · Olympia, WA 98504" removed — filler everyone knows
 *  - TIER double-dash (--) → middle dot (·) — professional punctuation
 *  - Bill stage + outcome tag + upcoming hearing date added to each top-bill row
 *  - Prime-sponsored-only disclosure footnote added to top bills section
 *  - Committee roles (CHAIR / V.CHAIR) from legislator_committee_seats shown
 *  - Stage funnel (full-width compact bars) added as new section
 *  - "Session" stat replaced with "Yrs Served" (from bio.first_elected_year)
 *  - "Hearings" stat replaced with "Attendance" (from roll-call sample)
 *  - Party cohesion % added to stats grid
 *  - Score context footnote added under stats
 *  - HIGH-tier category grouping added in Legislative Focus
 *  - Photo height 60 → 50mm (header space reclaimed)
 *
 * Extended signature:
 *   generateMemberPdf(member, memberBills, session, bio, extras)
 *   extras: { committeeSeats, elections, memberVotes, partyBucketsByRcId }
 *
 * All extras are optional — sections degrade gracefully when absent.
 */

import jsPDF from 'jspdf'
import {
  VECTOR_PALETTE,
  loadImageAsBase64,
  loadSvgWithFillSwap,
  getScoreColor,
} from './pdf-shared'

const P = VECTOR_PALETTE
const VECTOR_DOMAIN = 'vectorwa.com'

// T147: middle dot replaces double-dash (professional punctuation on print)
// PDF-M2: 'TIER N · ...' removed — internal jargon. Plain English majority/minority.
const TIER_TEXT = {
  1: 'Majority Leadership',
  2: 'Senior Majority Member',
  3: 'Majority Member',
  4: 'Minority Member',
}

// Stage index → display label (WA actual stage values: 1 / 3 / 4 / 6)
const STAGE_LABELS = ['', 'Introduced', 'Committee', 'Passed Committee', 'Passed Floor', 'Conference', 'Signed']

// ── Pure helpers ─────────────────────────────────────────────────────────────

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
  const prefix = (bill.chamber || 'House') === 'Senate' ? 'SB' : 'HB'
  return prefix + ' ' + (bill.bill_number || '')
}

/** Constructable from member fields — no new DB fetch needed. */
function memberProfileUrl(member) {
  const lastName = (member.name || '').trim().split(/\s+/).pop()
  if (member.chamber === 'Senate') return `leg.wa.gov/Senate/Senators/Pages/${lastName}.aspx`
  return `leg.wa.gov/House/Representatives/Pages/${lastName}.aspx`
}

/** One-line electoral summary for the identity block. */
function electionLine(elections) {
  if (!elections || elections.length === 0) return null
  const r = elections[0]
  if (r.unopposed) return `${r.election_year} general · Unopposed`
  if (r.vote_pct != null) {
    return `${r.election_year} general · ${r.vote_pct}%` +
      (r.margin_pct != null ? ` (+${r.margin_pct}pt margin)` : '') +
      (r.opponent_name ? ` vs. ${r.opponent_name}` : '')
  }
  return null
}

/** Seat-safety classification from most-recent general election margin. */
function seatSafetyTag(elections) {
  if (!elections || !elections.length) return null
  const r = elections[0]
  if (r.unopposed) return { text: 'UNCONTESTED', color: [...P.accent] }
  if (r.margin_pct == null) return null
  if (r.margin_pct >= 15) return { text: 'SAFE SEAT', color: [...P.primary] }
  if (r.margin_pct >= 5)  return { text: 'COMPETITIVE SEAT', color: [...P.muted] }
  return { text: 'VULNERABLE SEAT', color: [...P.danger] }
}

/**
 * Return an upcoming hearing date string if the bill's hearing_date is in
 * the future and within 60 days. Returns null otherwise.
 */
function getUpcomingHearing(bill) {
  if (!bill.hearing_date) return null
  const hd  = new Date(bill.hearing_date)
  const now = new Date()
  const in60 = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000)
  if (hd <= now || hd > in60) return null
  return hd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Returns 'SIGNED', 'DEAD', or null based on bill confidence_label / outcome. */
function outcomeTag(bill) {
  const cl = (bill.confidence_label || '').toUpperCase()
  if (cl === 'LAW' || bill.outcome_passed_law) return 'SIGNED'
  if (cl === 'DEAD') return 'DEAD'
  return null
}

/** Group HIGH-tier bills (score ≥ 75) by category, sorted by count. */
function highTierCats(memberBills) {
  const high = (memberBills || []).filter(b => (b.final_score || 0) >= 75)
  if (!high.length) return []
  const cats = {}
  for (const b of high) {
    const c = (b.category && b.category.trim()) || 'Other'
    cats[c] = (cats[c] || 0) + 1
  }
  return Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 4)
}

/**
 * Compute attendance rate and party cohesion from the memberVotes sample.
 * Uses the same algorithm as the Overview tab in members/page.js.
 * All values are null when the sample is too small or data is absent.
 */
function computeVotingStats(memberVotes, partyBucketsByRcId, memberParty) {
  const oppParty = memberParty === 'D' ? 'R' : memberParty === 'R' ? 'D' : null
  let participated = 0, missed = 0, contested = 0, crossed = 0

  for (const v of (memberVotes || [])) {
    const vote = (v.member_vote || '').toUpperCase()
    if (vote === 'YEA' || vote === 'NAY') participated++
    else if (vote === 'EXCUSED' || vote === 'ABSENT') missed++

    if (oppParty && (vote === 'YEA' || vote === 'NAY') && partyBucketsByRcId) {
      const b = partyBucketsByRcId[v.roll_call_id]
      if (!b) continue
      const dMaj = b.yesD > b.noD ? 'YEA' : 'NAY'
      const rMaj = b.yesR > b.noR ? 'YEA' : 'NAY'
      if (dMaj === rMaj) continue   // unanimous — not contested
      contested++
      const oppMaj = oppParty === 'D' ? dMaj : rMaj
      if (vote === oppMaj) crossed++
    }
  }

  const sampleN       = participated + missed
  const attendancePct = sampleN > 0 ? Math.round((participated / sampleN) * 100) : null
  const crossPct      = contested >= 5 ? Math.round((crossed / contested) * 100) : null
  const cohesionPct   = crossPct !== null ? 100 - crossPct : null

  return { attendancePct, cohesionPct, sampleN, contested }
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

// ── Section 1 — Header ───────────────────────────────────────────────────────

async function drawHeader(doc, y, m, pw, generatedAt) {
  // T147: reduced from 22 → 14mm — previous size dominated the header
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

  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, y + 7, pw - m, y + 7)

  return y + 12
}

// ── Section 2 — Identity ─────────────────────────────────────────────────────

async function drawIdentity(doc, y, m, pw, contentW, member, bio, elections) {
  const photoW = 38
  const photoH = 50   // T147: reduced from 60 to reclaim vertical space
  const photoX = m
  const textX  = m + photoW + 7
  const textW  = contentW - photoW - 7

  // Photo
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
    doc.setFontSize(18)
    doc.setTextColor(...P.muted)
    doc.text(initials, photoX + photoW / 2, y + photoH / 2 + 4, { align: 'center' })
  }

  // Party color bar on left edge of photo
  const partyRgb = member.party === 'D' ? [90, 90, 90]
    : member.party === 'R' ? [90, 90, 90]
    : [...P.neutralLt]
  doc.setFillColor(...partyRgb)
  doc.rect(photoX, y, 1.5, photoH, 'F')

  let ty = y + 4

  // Name
  const fullName = chamberPrefix(member.chamber) + ' ' + (member.name || '').toUpperCase()
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...P.primary)
  const nameLines = wrapText(doc, fullName, textW)
  doc.text(nameLines, textX, ty)
  ty += nameLines.length * 6.5 + 1

  // District · Chamber · Party
  const districtLine = [
    member.district ? 'District ' + member.district : null,
    member.chamber  || null,
    partyName(member.party),
  ].filter(Boolean).join(' · ')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...P.muted)
  doc.text(districtLine, textX, ty)
  ty += 4.5

  // Leadership role — from bio.leadership_role if populated (named position);
  // falls back to tier-derived label for chairs / senior members.
  // PDF-M2: always show a role line — previously tier 3/4 members showed nothing
  {
    let roleLabel = bio?.leadership_role || null
    if (!roleLabel) {
      if (member.is_chair)        roleLabel = 'Committee Chair'
      else if (member.tier === 1) roleLabel = 'Majority Leadership'
      else if (member.tier === 2) roleLabel = 'Senior Majority Member'
      else if (member.tier === 3) roleLabel = 'Majority Member'
      else                        roleLabel = 'Minority Member'
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.accent)
    doc.text(roleLabel, textX, ty)
    ty += 4.5
  }

  // Electoral margin — one muted line, high signal for engagement strategy
  const elLine = electionLine(elections)
  if (elLine) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.muted)
    doc.text(trunc(elLine, 70), textX, ty)
    ty += 4

    // PDF-M1: seat-safety label — converts raw margin to plain-English signal
    const safetyTag = seatSafetyTag(elections)
    if (safetyTag) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...safetyTag.color)
      doc.text(safetyTag.text, textX, ty)
      ty += 3.5
    }
  }

  ty += 1.5

  // Phone — primary contact for a lobbyist
  if (member.phone) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...P.primary)
    doc.text(member.phone, textX, ty)
    ty += 4.5
  }

  // Email
  if (member.email) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...P.muted)
    doc.text(trunc(member.email, 55), textX, ty)
    ty += 4.5
  }

  // Official profile URL — constructable, no new data needed, replaces
  // the removed "Legislative Building · Olympia, WA 98504" filler line
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...P.accent)
  doc.text(memberProfileUrl(member), textX, ty)

  return Math.max(y + photoH, ty + 4) + 5
}

// ── Section 3 — Legislative Focus ────────────────────────────────────────────

function drawLegislativeFocus(doc, y, m, contentW, bio, memberBills) {
  if (!bio) return y

  const priorities = bio.priorities || []
  const summary    = bio.bio_summary || null

  // PDF-M2: also check occupation — data-sparse members may have occupation but no priorities/summary
  if (!priorities.length && !summary && !bio?.occupation?.length) return y

  y = drawSectionLabel(doc, y, m, contentW, 'Legislative Focus')

  // Priority chips — T147: light styling for print.
  // Previous version used dark fill (26,24,18) and dark bg band — designed
  // for the UI dark theme, printed as blobs on white paper. Flipped to
  // surface fill + brass border + dark text for clean print output.
  if (priorities.length > 0) {
    const chipH    = 5.5
    const chipPadX = 4
    const chipGap  = 3
    let cx = m
    // T147c: use chipRowY as chip TOP (not text baseline) so chip rects render
    // entirely below the section rule line. Previous baseline approach caused
    // chip tops to sit 0.5mm above the rule, visually cutting through it.
    let chipRowY = y

    doc.setFontSize(7.5)
    doc.setFont('helvetica', 'bold')

    for (const p of priorities.slice(0, 4)) {  // T148: cap 4 (was 6) — keeps chips in 1 row
      const label = p.toUpperCase()
      const chipW = doc.getTextWidth(label) + chipPadX * 2

      if (cx + chipW > m + contentW) {
        cx       = m
        chipRowY += chipH + 2
      }

      doc.setFillColor(...P.surface)      // off-white fill — reads on paper
      doc.setDrawColor(...P.accent)       // brass border
      doc.setLineWidth(0.5)
      doc.roundedRect(cx, chipRowY, chipW, chipH, 1.2, 1.2, 'FD')
      doc.setTextColor(...P.primary)      // dark text
      doc.text(label, cx + chipPadX, chipRowY + chipH - 1.5)
      cx += chipW + chipGap
    }
    y = chipRowY + chipH + 2
  }

  // PDF-M2: build bio text — summary first; fallback to occupation when absent or short
  const bioText = (() => {
    if (summary && summary.length > 60) return summary
    const occLine = bio?.occupation?.length ? bio.occupation.slice(0, 2).join(', ') : null
    if (summary && occLine) return summary.replace(/\.?$/, '.') + ' ' + occLine + '.'
    if (occLine) return occLine + '.'
    return summary || null
  })()
  if (bioText) {
    y += 2
    // T148: font MUST be set before wrapText — same metric-match requirement as drawTopBills
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const wrapped = wrapText(doc, bioText, contentW)
    doc.setTextColor(...P.muted)
    const summaryLines = wrapped.slice(0, 3)
    doc.text(summaryLines, m, y)
    y += summaryLines.length * 4
  }

  return y + 2
}

// ── Section 4 — Top Bills ────────────────────────────────────────────────────

function drawTopBills(doc, y, m, contentW, pw, memberBills, session) {
  // PDF-M3: resolve bills before drawing section label -- avoids contradiction with stats
  let bills = (memberBills || [])
    .filter(b => !session || b.session === session)
    .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
    .slice(0, 5)
  const usedFallback = !bills.length
  if (usedFallback) {
    bills = [...(memberBills || [])]
      .sort((a, b) => (b.final_score || 0) - (a.final_score || 0))
      .slice(0, 5)
  }
  if (!bills.length) return y   // skip section entirely

  const sectionTitle = usedFallback ? 'Top Bills (All Sessions)' : 'Top Bills This Session'
  y = drawSectionLabel(doc, y, m, contentW, sectionTitle)

  const circleR = 4.2   // PDF-M1: 3.5 → 4.2 for print readability
  const numColW = 16
  // T147c: padding increased from +4 → +10 to guarantee a clean gap between
  // the title text right edge and the score circle left edge. Previous 3mm gap
  // was too tight — jsPDF font metrics occasionally over-ran it.
  const titleW  = contentW - numColW - (circleR * 2 + 14)  // PDF-M1: gap for larger circle

  for (const bill of bills) {
    const score      = bill.final_score || 0
    const scoreRgb   = getScoreColor(score)
    const label      = billLabel(bill)
    const title      = trunc(bill.title || 'Untitled', 70)

    // T148: font MUST be set before wrapText so splitTextToSize uses the same
    // metrics as the actual render. Previous order (split → then setFont) caused
    // split at wrong size → single kept line wider than titleW → bleeds into
    // score circle ("names extend into numbers" regression from T147b).
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    const titleLines = wrapText(doc, title, titleW)
    const titleShown = titleLines.slice(0, 1)
    const titleH     = titleShown.length * 4.5

    // Bill number
    doc.setFont('courier', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...P.accent)
    doc.text(label, m, y + 4)

    // Title (font already set above for correct wrap; just set color)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.primary)
    doc.text(titleShown, m + numColW, y + 4)

    // Score circle
    const scoreX = m + contentW - circleR - 1
    const scoreY = y + 3.5
    doc.setFillColor(...scoreRgb)
    doc.circle(scoreX, scoreY, circleR, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)  // PDF-M1: 6.5 → 8 for print readability
    doc.setTextColor(...P.white)
    doc.text(String(score), scoreX, scoreY + 1.5, { align: 'center' })

    // Sub-row: stage · outcome · upcoming hearing
    const subY     = y + 4 + titleH
    const stageStr = STAGE_LABELS[bill.stage] || ''
    const outcome  = outcomeTag(bill)
    const hearing  = getUpcomingHearing(bill)
    const subParts = [stageStr, outcome, hearing ? 'Hearing ' + hearing : null].filter(Boolean)

    if (subParts.length > 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6.5)
      let sx = m + numColW
      subParts.forEach((part, i) => {
        const isSigned  = part === 'SIGNED'
        const isDead    = part === 'DEAD'
        const isHearing = part.startsWith('Hearing')
        doc.setTextColor(
          ...(isSigned  ? P.accent  :
              isDead    ? P.danger  :
              isHearing ? P.tierMod :
              P.muted)
        )
        doc.text(part, sx, subY)
        const partW = doc.getTextWidth(part)
        if (i < subParts.length - 1) {
          doc.setTextColor(...P.neutralLt)
          doc.text(' ·', sx + partW, subY)
          sx += partW + doc.getTextWidth(' · ')
        }
      })
      y = subY + 2   // T148: tightened from 3
    } else {
      y = subY + 1   // T148: tightened from 1.5
    }
  }

  // Prime-sponsored-only disclosure
  y += 1
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...P.neutralLt)
  doc.text('Prime-sponsored bills only. Co-sponsorships not shown.', m, y)

  return y + 5
}

// ── Section 5 — Committee Assignments ────────────────────────────────────────

function drawCommittees(doc, y, m, contentW, committeeSeats, member) {
  y = drawSectionLabel(doc, y, m, contentW, 'Committees')

  // Use rich seat data (with roles) if available; fall back to flat string array
  const seats = committeeSeats && committeeSeats.length > 0
    ? committeeSeats
    : (member.committees || []).map(c => ({ committee_name: c, role: null }))

  if (!seats.length) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...P.muted)
    doc.text('No committee assignments on record', m, y)
    return y + 8
  }

  // T147b: cap at 5 seats to prevent right column overflow for senior senators
  const MAX_SEATS   = 5
  const visibleSeats = seats.slice(0, MAX_SEATS)
  const hiddenCount  = seats.length - MAX_SEATS

  for (const seat of visibleSeats) {
    const name    = typeof seat === 'string' ? seat : (seat.committee_name || '')
    const role    = typeof seat === 'string' ? null : (seat.role || null)
    const isChair = role === 'chair'
    const isVice  = role === 'vice_chair'

    doc.setFont('helvetica', isChair ? 'bold' : 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(...(isChair ? P.accent : P.primary))

    const lines = wrapText(doc, name, contentW - (isChair || isVice ? 14 : 0))
    doc.text(lines.slice(0, 2), m, y)

    if (isChair) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(6)
      doc.setTextColor(...P.accent)
      doc.text('CHAIR', m + contentW, y, { align: 'right' })
    } else if (isVice) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...P.muted)
      doc.text('VICE CHAIR', m + contentW, y, { align: 'right' })
    }

    y += lines.slice(0, 2).length * 4.5 + 0.5
  }

  if (hiddenCount > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...P.neutralLt)
    doc.text(`+${hiddenCount} more committee${hiddenCount > 1 ? 's' : ''}`, m, y)
    y += 4
  }

  return y + 4
}

// ── Section 5.5 — Background ─────────────────────────────────────────────────

function drawBackground(doc, y, m, contentW, bio) {
  if (!bio) return y

  // T149: family excluded — family members are private individuals.
  // Matches MemberBioSection.js hasBg definition: education + career + first_elected_year only.
  const { education, occupation, first_elected_year } = bio
  const lines = []

  if (education && education.length > 0) {
    const edLine = education.slice(0, 2).map(e => {
      const parts = [e.school, e.degree && e.field ? `${e.degree} ${e.field}` : (e.degree || e.field)]
      return parts.filter(Boolean).join(' — ')
    }).join('  |  ')
    if (edLine.trim()) lines.push(edLine)
  }

  if (occupation && occupation.length > 0) {
    let careerLine = occupation.slice(0, 3).join('  ·  ')
    if (first_elected_year) careerLine += `  ·  Since ${first_elected_year}`
    lines.push(careerLine)
  } else if (first_elected_year) {
    lines.push(`Legislature since ${first_elected_year}`)
  }

  if (!lines.length) return y

  y = drawSectionLabel(doc, y, m, contentW, 'Background')

  for (const text of lines) {
    // T148: font set before wrapText so split metrics match render metrics
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    const wrapped = wrapText(doc, trunc(text, 120), contentW)
    doc.setTextColor(...P.primary)
    doc.text(wrapped.slice(0, 2), m, y)
    y += wrapped.slice(0, 2).length * 4.5
  }

  return y + 3
}

// ── Section 6 — Bill Pipeline (Stage Funnel) ─────────────────────────────────

function drawStageFunnel(doc, y, m, contentW, memberBills) {
  const bills = (memberBills || [])
  if (!bills.length) return y

  const stages = [
    { label: 'Introduced',       min: 1, color: [...P.neutralLt] },
    { label: 'Passed Committee', min: 3, color: [58, 122, 138]   },
    { label: 'Passed Floor',     min: 4, color: [...P.tierMod]   },
    { label: 'Signed',           min: 6, color: [...P.accent]    },
  ].map(s => ({
    ...s,
    count: bills.filter(b => (b.stage || 0) >= s.min).length,
  }))

  const total = stages[0].count || 0
  if (!total) return y

  y = drawSectionLabel(doc, y, m, contentW, 'Bill Pipeline')

  const colW = (contentW - 6) / stages.length
  const barH = 4

  stages.forEach((s, i) => {
    const sx  = m + i * (colW + 2)
    const pct = total > 0 ? Math.round((s.count / total) * 100) : 0
    const barW = colW

    // Track
    doc.setFillColor(...P.surface)
    doc.rect(sx, y, barW, barH, 'F')
    // Fill
    if (pct > 0) {
      doc.setFillColor(...s.color)
      doc.rect(sx, y, barW * (pct / 100), barH, 'F')
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6)
    doc.setTextColor(...P.muted)
    doc.text(s.label, sx, y + barH + 3.5)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...P.primary)
    doc.text(`${s.count}`, sx, y + barH + 9)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(6.5)
    doc.setTextColor(...P.muted)
    doc.text(`(${pct}%)`, sx + doc.getTextWidth(`${s.count}`) + 1.5, y + barH + 9)
  })

  return y + barH + 14
}

// ── Section 7 — Legislative Record (Stats) ───────────────────────────────────

function drawIntelligence(doc, y, m, contentW, member, session, bio, votingStats) {
  // T147: renamed from "VECTOR | WA INTELLIGENCE" — brand already in header
  const sectionLabel = session
    ? 'LEGISLATIVE RECORD  ·  ' + session
    : 'LEGISLATIVE RECORD'

  y = drawSectionLabel(doc, y, m, contentW, sectionLabel)

  // Tier chip
  doc.setFillColor(...P.surface)
  doc.rect(m, y - 2, contentW, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...P.accent)
  // T147: double-dash (--) replaced with middle dot (·) in TIER_TEXT constant
  doc.text(TIER_TEXT[member.tier] || TIER_TEXT[3], m + 2, y + 3.5)
  y += 11

  // Years served from bio.first_elected_year
  const yrsVal = bio?.first_elected_year
    ? String(new Date().getFullYear() - bio.first_elected_year) + ' yrs'
    : null

  // PDF-M2: dynamic stat pool — suppress any stat without real data.
  // C-suite documents must never show a labeled field with a dash.
  const STAT_COLS = 4
  const statW = contentW / STAT_COLS
  const statPool = [
    { label: 'Laws Enacted',    value: String(member.laws_passed     || 0) },
    // PDF-M3: law rate -- footnote says signed into law, now the math matches
    { label: 'Success Rate',    value: (member.bill_count > 0 && member.laws_passed != null ? Math.round((member.laws_passed / member.bill_count) * 100) : (member.pass_rate || 0)) + '%' },
    { label: 'Bills Sponsored', value: String(member.bill_count      || 0) },
    { label: 'Bills Advanced',  value: String(member.committee_passes || 0) },
    { label: 'Top Bill Score',  value: String(member.top_score       || 0) },
    yrsVal ? { label: 'Yrs Served',      value: yrsVal }                          : null,
    votingStats?.cohesionPct   != null ? { label: 'Party-Line Votes', value: votingStats.cohesionPct   + '%' } : null,
    votingStats?.attendancePct != null ? { label: 'Floor Attendance', value: votingStats.attendancePct + '%' } : null,
  ].filter(Boolean)

  for (let ri = 0; ri < statPool.length; ri += STAT_COLS) {
    const row = statPool.slice(ri, ri + STAT_COLS)
    row.forEach(({ label, value }, i) => {
      const sx = m + i * statW
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(6)
      doc.setTextColor(...P.muted)
      doc.text(label.toUpperCase(), sx + 1, y)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(11)
      doc.setTextColor(...P.primary)
      doc.text(value, sx + 1, y + 5.5)
    })
    y += 10.5
  }

  // Context footnotes — give an external reader enough to interpret the numbers
  y += 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...P.neutralLt)
  doc.text('Top Bill Score: likelihood of passage for the member\'s strongest bill (0-100 scale).', m, y)
  y += 3.5
  doc.text('Success Rate: bills signed into law as a share of total bills sponsored this session.', m, y)
  y += 3.5
  if (votingStats?.sampleN) {
    doc.text(
      `Party-Line Votes + Floor Attendance based on ${votingStats.sampleN} most-recent roll calls.`,
      m, y
    )
    y += 3.5
  }

  return y + 2
}

// ── Footer ───────────────────────────────────────────────────────────────────

function drawFooter(doc, m, pw, ph, generatedAt) {
  const fy = ph - 15   // PDF-M3: raised 3mm to fit data sources line
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.3)
  doc.line(m, fy - 2, pw - m, fy - 2)

  const stamp = generatedAt.toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...P.muted)
  doc.text('Generated ' + stamp, m, fy + 3)

  // PDF-M3: data attribution
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(5.5)
  doc.setTextColor(...P.neutralLt)
  doc.text(
    'Data: Washington State Legislature · leg.wa.gov · Washington Secretary of State · WA roll-call voting records',
    m, fy + 8
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

/**
 * @param {object}   member       — row from v_member_stats_by_session
 * @param {object[]} memberBills  — bills where prime_sponsor = member.name
 * @param {string}   session      — e.g. '2025-2026'
 * @param {object}   bio          — row from legislator_bios (nullable)
 * @param {object}   extras       — optional enrichment data:
 *   committeeSeats     {committee_name, role}[] from legislator_committee_seats
 *   elections          {election_year, vote_pct, margin_pct, ...}[] from legislator_elections
 *   memberVotes        stitched vote rows from loadMemberVotes
 *   partyBucketsByRcId {[rcId]: {yesD,yesR,noD,noR}} from loadMemberVotes
 */
export async function generateMemberPdf(member, memberBills, session, bio = null, extras = {}) {
  if (!member) throw new Error('generateMemberPdf: member is required')

  const {
    committeeSeats     = [],
    elections          = [],
    memberVotes        = [],
    partyBucketsByRcId = {},
    output             = 'save',  // ER4 (F8): 'save' = download (default); 'blob' = return bytes for share sheet
  } = extras

  const votingStats = computeVotingStats(memberVotes, partyBucketsByRcId, member.party)

  const generatedAt = new Date()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const pw = doc.internal.pageSize.getWidth()
  const ph = doc.internal.pageSize.getHeight()
  const m  = 16
  const contentW = pw - 2 * m
  let y = 14

  // ── Render pipeline ───────────────────────────────────────────────────────
  y = await drawHeader(doc, y, m, pw, generatedAt)
  y = await drawIdentity(doc, y, m, pw, contentW, member, bio, elections)
  y = drawLegislativeFocus(doc, y, m, contentW, bio, memberBills)

  // Two-column: Top Bills (left 58%) | Committees + Background (right 40%)
  const colSplit = 0.58
  const leftW    = contentW * colSplit - 2
  const rightW   = contentW * (1 - colSplit - 0.02)
  const rightX   = m + contentW * (colSplit + 0.02)

  const yCol  = y
  const yLeft = drawTopBills(doc, yCol, m, leftW, pw, memberBills, session)

  let yRight = drawCommittees(doc, yCol, rightX, rightW, committeeSeats, member)
  yRight     = drawBackground(doc, yRight, rightX, rightW, bio)

  // Column separator
  doc.setDrawColor(...P.neutralLt)
  doc.setLineWidth(0.2)
  const sepX = m + contentW * colSplit
  doc.line(sepX, yCol - 2, sepX, Math.max(yLeft, yRight) + 2)

  y = Math.max(yLeft, yRight) + 5

  // PDF-M3: single-page guarantee -- never addPage(). Skip funnel if cramped.
  // Footer rule at ph-17. Budget: funnel ~25mm + intelligence ~52mm = 77mm.
  const footerRule = ph - 20   // 3mm buffer above footer rule
  const INTEL_H    = 54
  const FUNNEL_H   = 25

  if (y + FUNNEL_H + INTEL_H <= footerRule) {
    y = drawStageFunnel(doc, y, m, contentW, memberBills)
    y = drawIntelligence(doc, y, m, contentW, member, session, bio, votingStats)
  } else if (y + INTEL_H <= footerRule) {
    y = drawIntelligence(doc, y, m, contentW, member, session, bio, votingStats)
  } else {
    y = footerRule - INTEL_H
    y = drawIntelligence(doc, y, m, contentW, member, session, bio, votingStats)
  }

  drawFooter(doc, m, pw, ph, generatedAt)
  // ─────────────────────────────────────────────────────────────────────────

  const nameSlug    = (member.name || 'member').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const safeDate    = generatedAt.toISOString().slice(0, 10)
  const filename    = `member-${nameSlug}-${safeDate}.pdf`
  // ER4 (F8): additive output option — rendering unchanged, delivery only.
  if (output === 'blob') return { blob: doc.output('blob'), filename }
  doc.save(filename)
  return filename
}
