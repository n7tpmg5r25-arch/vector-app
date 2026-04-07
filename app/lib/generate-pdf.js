/**
 * Vector | WA — Client PDF Intelligence Brief Generator (v2 — Step 6.17)
 *
 * Generates a branded Post & Policy / Vector WA report PDF.
 * v2 enhancements:
 *   - Bills grouped by client_tag
 *   - Score trend column (7-day sparkline text: +3, -2, etc.)
 *   - Hearing date column
 *   - Pass probability in plain language
 *   - Improved summary stats per group
 *
 * Uses jsPDF + jspdf-autotable (must be installed: npm install jspdf jspdf-autotable)
 */

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const STAGE_LABELS = ['', 'Introduced', 'Committee', 'Floor Vote', 'Opp. Chamber', 'Conference', 'Signed into Law']
const STAGE_SHORT  = ['', 'Intro', 'Cmte', 'Floor', 'Opp.Ch.', 'Conf.', 'Signed']

// Brand colors (RGB)
const NAVY  = [10, 22, 40]
const TEAL  = [0, 163, 150]
const GOLD  = [180, 142, 62]
const GRAY  = [120, 130, 145]
const LGRAY = [200, 210, 220]
const WHITE = [255, 255, 255]

/**
 * Loads an image from a URL and returns a base64 data URL.
 * Returns null if the image can't be loaded (e.g. missing file).
 */
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

/** Plain-language pass probability */
function passProbLabel(pp) {
  const pct = Math.round((pp || 0) * 100)
  if (pct >= 80) return `${pct}% \u2014 very likely to pass`
  if (pct >= 40) return `${pct}% \u2014 good chance`
  if (pct >= 10) return `${pct}% \u2014 moderate odds`
  if (pct >= 1)  return `${pct}% \u2014 uphill battle`
  return `${pct}% \u2014 very unlikely`
}

/** Format hearing date short */
function fmtDate(dateStr) {
  if (!dateStr) return '\u2014'
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch { return '\u2014' }
}

/** Ensure new page if needed */
function ensureSpace(doc, y, needed) {
  const ph = doc.internal.pageSize.getHeight()
  if (y + needed > ph - 20) {
    doc.addPage()
    return 20
  }
  return y
}

export async function generateClientPDF({ clientName, date, bills, scoreDeltas, changes }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()   // 210
  const ph = doc.internal.pageSize.getHeight()   // 297
  const m  = 18  // margin
  let y = 16

  /* ━━━━━━━━━━━━━━━━ HEADER (with logo) ━━━━━━━━━━━━━━━━ */

  const logoData = await loadImageAsBase64('/logo.png')

  if (logoData) {
    const logoH = 22
    const logoW = logoH * 0.82
    doc.addImage(logoData, 'PNG', m, y - 4, logoW, logoH)

    const textX = m + logoW + 4

    doc.setFont('times', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(...NAVY)
    doc.text('POST & POLICY', textX, y + 5)

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
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(1.2)
    doc.line(m, y, pw - m, y)
    y += 8

    doc.setFont('times', 'bold')
    doc.setFontSize(22)
    doc.setTextColor(...NAVY)
    doc.text('POST & POLICY', m, y)
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
  y += 8

  /* ━━━━━━━━━━━━━━━━ CLIENT INFO ━━━━━━━━━━━━━━━━ */

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...NAVY)
  doc.text(clientName ? `Prepared for: ${clientName}` : 'Full Portfolio Report', m, y)
  y += 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(date, m, y)
  doc.text('Session: 2025\u20132026 (Interim)', m + 55, y)
  y += 10

  /* ━━━━━━━━━━━━━━━━ SUMMARY STATS ━━━━━━━━━━━━━━━━ */

  const allScores = bills.map(b => b.bills?.final_score || 0)
  const avg       = allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0
  const highCount = allScores.filter(s => s >= 50).length
  const atRisk    = allScores.filter(s => s < 25).length
  const withHearings = bills.filter(b => b.bills?.has_public_hearing).length

  // Summary box
  doc.setFillColor(245, 248, 252)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, pw - 2 * m, 22, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...NAVY)
  doc.text('PORTFOLIO SUMMARY', m + 4, y + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(60, 60, 60)
  const statsLine1 = `Bills Tracked: ${bills.length}    \u2502    Avg Score: ${avg}    \u2502    High Trajectory (50+): ${highCount}    \u2502    At Risk (<25): ${atRisk}`
  doc.text(statsLine1, m + 4, y + 12)

  // Outlook label
  const outlookText = avg >= 55 ? 'Very Strong' : avg >= 45 ? 'Strong Outlook' : avg >= 35 ? 'Building Momentum' : avg >= 25 ? 'Watch Closely' : 'High Risk'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...TEAL)
  doc.text(`Portfolio Outlook: ${outlookText}    \u2502    Hearings: ${withHearings}`, m + 4, y + 18)

  y += 28

  /* ━━━━━━━━━━━━━━━━ CHANGES SINCE LAST VISIT ━━━━━━━━━━━━━━━━ */

  const changedBills = bills.filter(b => changes[b.bill_id])
  if (changedBills.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...TEAL)
    doc.text('\u25cf  RECENT CHANGES', m, y)
    y += 5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)

    changedBills.slice(0, 8).forEach(({ bill_id, bills: bill }) => {
      y = ensureSpace(doc, y, 6)
      const c = changes[bill_id]
      const label = `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}`
      let desc = []
      if (c.scoreDiff !== 0) desc.push(`Score ${c.oldScore} \u2192 ${c.newScore} (${c.scoreDiff > 0 ? '+' : ''}${c.scoreDiff})`)
      if (c.stageChanged) desc.push(`Stage ${STAGE_SHORT[c.oldStage] || '?'} \u2192 ${STAGE_SHORT[c.newStage] || '?'}`)

      doc.setTextColor(...NAVY)
      doc.setFont('helvetica', 'bold')
      doc.text(label, m + 2, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 60, 60)
      doc.text(desc.join('  |  '), m + 22, y)
      y += 4.5
    })
    if (changedBills.length > 8) {
      doc.setTextColor(...GRAY)
      doc.text(`+ ${changedBills.length - 8} more changes`, m + 2, y)
      y += 4.5
    }
    y += 4
  }

  /* ━━━━━━━━━━━━━━━━ BILL TABLE (grouped by client tag) ━━━━━━━━━━━━━━━━ */

  // Group bills by client_tag
  const groups = {}
  bills.forEach(b => {
    const tag = b.client_tag || 'General'
    if (!groups[tag]) groups[tag] = []
    groups[tag].push(b)
  })

  // Sort groups: named clients first (alphabetical), then 'General' last
  const sortedGroupKeys = Object.keys(groups).sort((a, b) => {
    if (a === 'General') return 1
    if (b === 'General') return -1
    return a.localeCompare(b)
  })

  for (const groupName of sortedGroupKeys) {
    const groupBills = groups[groupName]

    y = ensureSpace(doc, y, 20)

    // Group header
    if (sortedGroupKeys.length > 1 || groupName !== 'General') {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10)
      doc.setTextColor(...NAVY)
      doc.text(groupName === 'General' ? 'UNTAGGED BILLS' : groupName.toUpperCase(), m, y)

      // Group mini-stats
      const gScores = groupBills.map(b => b.bills?.final_score || 0)
      const gAvg = gScores.length ? Math.round(gScores.reduce((a, b) => a + b, 0) / gScores.length) : 0
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(...GRAY)
      doc.text(`${groupBills.length} bills \u2502 avg ${gAvg}`, pw - m, y, { align: 'right' })
      y += 3
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor(...NAVY)
      doc.text('TRACKED LEGISLATION', m, y)
      y += 3
    }

    const tableData = groupBills.map(({ bill_id, bills: bill }) => {
      const delta = scoreDeltas[bill_id]
      const deltaStr = delta ? (delta > 0 ? `+${delta}` : `${delta}`) : '\u2014'
      const titleTrunc = (bill.title || '').length > 48
        ? (bill.title || '').slice(0, 48) + '\u2026'
        : (bill.title || '')

      return [
        `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}`,
        titleTrunc,
        String(bill.final_score || 0),
        deltaStr,
        STAGE_SHORT[bill.stage] || 'Intro',
        passProbLabel(bill.pass_probability),
        fmtDate(bill.hearing_date),
      ]
    })

    autoTable(doc, {
      startY: y,
      head: [['Bill', 'Title', 'Score', '\u0394', 'Stage', 'Pass Probability', 'Hearing']],
      body: tableData,
      margin: { left: m, right: m },
      styles: {
        fontSize: 7,
        cellPadding: 2,
        textColor: [40, 40, 40],
        lineColor: LGRAY,
        lineWidth: 0.15,
        font: 'helvetica',
      },
      headStyles: {
        fillColor: NAVY,
        textColor: WHITE,
        fontStyle: 'bold',
        fontSize: 7,
      },
      columnStyles: {
        0: { cellWidth: 18, fontStyle: 'bold', font: 'courier' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 12, halign: 'center' },
        3: { cellWidth: 10, halign: 'center' },
        4: { cellWidth: 14 },
        5: { cellWidth: 34, fontSize: 6.5 },
        6: { cellWidth: 16, fontSize: 6.5 },
      },
      alternateRowStyles: { fillColor: [248, 250, 253] },
      didParseCell: function (data) {
        if (data.section !== 'body') return
        const col = data.column.index
        const val = data.cell.raw

        // Color-code score column
        if (col === 2) {
          const s = parseInt(val)
          if (s >= 60)      data.cell.styles.textColor = [0, 150, 135]
          else if (s >= 45) data.cell.styles.textColor = [170, 130, 50]
          else if (s < 25)  data.cell.styles.textColor = [200, 55, 55]
        }
        // Color-code delta column
        if (col === 3) {
          if (typeof val === 'string' && val.startsWith('+')) {
            data.cell.styles.textColor = [0, 150, 135]
            data.cell.styles.fontStyle = 'bold'
          } else if (typeof val === 'string' && val.startsWith('-')) {
            data.cell.styles.textColor = [200, 55, 55]
            data.cell.styles.fontStyle = 'bold'
          }
        }
        // Color-code pass probability
        if (col === 5) {
          if (val.includes('very likely'))   data.cell.styles.textColor = [0, 150, 135]
          else if (val.includes('good'))     data.cell.styles.textColor = [0, 150, 135]
          else if (val.includes('moderate')) data.cell.styles.textColor = [170, 130, 50]
          else if (val.includes('uphill'))   data.cell.styles.textColor = [200, 100, 55]
          else if (val.includes('unlikely')) data.cell.styles.textColor = [200, 55, 55]
        }
      },
    })

    y = doc.lastAutoTable.finalY + 8
  }

  /* ━━━━━━━━━━━━━━━━ METHODOLOGY NOTE ━━━━━━━━━━━━━━━━ */

  y = ensureSpace(doc, y, 35)

  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.2)
  doc.line(m, y, pw - m, y)
  y += 6

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...NAVY)
  doc.text('METHODOLOGY', m, y)
  y += 4

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  const lines = [
    'Trajectory scores (0\u201399) are generated by Vector WA\u2019s proprietary scoring engine analyzing five signals: committee activity,',
    'sponsor strength, legislative momentum, fiscal impact, and historical category pass rates. Each signal is independently weighted',
    'and combined with X-Factor multipliers for exceptional circumstances (e.g., emergency clauses, governor requests).',
    '',
    'Scores are calibrated against verified 2025\u20132026 session outcomes. Pass probability reflects the historical rate of bills in',
    'the same score range becoming law. Score changes (\u0394) reflect movement since the previous daily snapshot.',
  ]
  lines.forEach(line => {
    doc.text(line, m, y)
    y += 3.2
  })

  /* ━━━━━━━━━━━━━━━━ FOOTER (on every page) ━━━━━━━━━━━━━━━━ */

  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    const fy = ph - 12
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.4)
    doc.line(m, fy, pw - m, fy)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text('\u00a9 Post & Policy  \u2502  Vector | WA  \u2502  Legislative Intelligence', m, fy + 5)
    doc.text(`CONFIDENTIAL  \u2502  Page ${p} of ${totalPages}`, pw - m, fy + 5, { align: 'right' })
  }

  /* ━━━━━━━━━━━━━━━━ SAVE ━━━━━━━━━━━━━━━━ */

  const safeName = (clientName || 'Portfolio').replace(/[^a-zA-Z0-9]/g, '_')
  const safeDate = date.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = `Vector_WA_Brief_${safeName}_${safeDate}.pdf`

  doc.save(filename)
  return filename
}
