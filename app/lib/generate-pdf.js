/**
 * Vector | WA — Client PDF Intelligence Brief Generator
 *
 * Generates a branded Post & Policy / Vector WA report PDF.
 * Uses jsPDF + jspdf-autotable (must be installed: npm install jspdf jspdf-autotable)
 *
 * NOTE: jsPDF built-in fonts (Helvetica/Times/Courier) only support Windows-1252 characters.
 * Do NOT use Unicode symbols like box-drawing, Greek letters, or arrows — use ASCII equivalents.
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

/**
 * Get a display-ready title for a bill.
 * Falls back to committee name or bill number if title is missing or looks wrong.
 */
function getBillTitle(bill) {
  const title = (bill.title || '').trim()
  // If title is empty, or is ALL CAPS with no legislative keywords (likely a person name from bad data)
  if (!title) {
    return bill.committee_name || 'Bill ' + bill.bill_number
  }
  if (title === title.toUpperCase() && title.length < 40 && !/RELAT|CONCERN|PROVID|CREAT|AMEND|REPEAL/.test(title)) {
    return bill.committee_name || 'Bill ' + bill.bill_number
  }
  return title
}

export async function generateClientPDF({ clientName, date, bills, scoreDeltas, changes }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()   // 210
  const ph = doc.internal.pageSize.getHeight()   // 297
  const m  = 20  // margin
  const contentW = pw - 2 * m  // usable width
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
    // Fallback: text-only header
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

  /* ================================================================
     CLIENT INFO
     ================================================================ */

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...NAVY)
  doc.text(clientName ? 'Prepared for: ' + clientName : 'Full Portfolio Report', m, y)
  y += 6

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...GRAY)
  doc.text(date, m, y)
  doc.text('Session: 2025-2026 (Interim)', m + 55, y)
  y += 10

  /* ================================================================
     SUMMARY STATS — individual stat blocks (not one long string)
     ================================================================ */

  const allScores = bills.map(b => b.bills?.final_score || 0)
  const avg       = allScores.length ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length) : 0
  const highCount = allScores.filter(s => s >= 50).length
  const atRisk    = allScores.filter(s => s < 25).length

  // Summary box
  doc.setFillColor(245, 248, 252)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, contentW, 18, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...NAVY)
  doc.text('PORTFOLIO SUMMARY', m + 4, y + 5.5)

  // Stat blocks — evenly spaced across the box
  const stats = [
    { label: 'Bills Tracked', value: String(bills.length) },
    { label: 'Avg Score', value: String(avg) },
    { label: 'High Trajectory (50+)', value: String(highCount) },
    { label: 'At Risk (<25)', value: String(atRisk) },
  ]

  const statStartX = m + 4
  const statSpacing = (contentW - 8) / stats.length
  const statY = y + 14

  stats.forEach((stat, i) => {
    const sx = statStartX + i * statSpacing
    // Value — large bold number
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...NAVY)
    doc.text(stat.value, sx, statY)
    // Label — small gray text next to the number
    const valueWidth = doc.getTextWidth(stat.value)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text(stat.label, sx + valueWidth + 2, statY)
  })

  y += 24

  /* ================================================================
     CHANGES SINCE LAST VISIT
     ================================================================ */

  const changedBills = bills.filter(b => changes[b.bill_id])
  if (changedBills.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...TEAL)
    doc.text('RECENT CHANGES', m, y)
    y += 5

    changedBills.forEach(({ bill_id, bills: bill }) => {
      const c = changes[bill_id]
      const label = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
      let desc = []
      if (c.scoreDiff !== 0) desc.push('Score ' + c.oldScore + ' -> ' + c.newScore + ' (' + (c.scoreDiff > 0 ? '+' : '') + c.scoreDiff + ')')
      if (c.stageChanged) desc.push('Stage ' + (STAGE_SHORT[c.oldStage] || '?') + ' -> ' + (STAGE_SHORT[c.newStage] || '?'))

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...NAVY)
      doc.text(label, m + 2, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(60, 60, 60)
      doc.text(desc.join('   |   '), m + 22, y)
      y += 4.5
    })
    y += 4
  }

  /* ================================================================
     BILL TABLE
     ================================================================ */

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...NAVY)
  doc.text('TRACKED LEGISLATION', m, y)
  y += 3

  const tableData = bills.map(({ bill_id, bills: bill, client_tag }) => {
    const delta = scoreDeltas[bill_id]
    const deltaStr = delta ? (delta > 0 ? '+' + delta : String(delta)) : '--'
    const title = getBillTitle(bill)
    const titleTrunc = title.length > 55 ? title.slice(0, 55) + '...' : title

    return [
      (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number,
      titleTrunc,
      String(bill.final_score || 0),
      deltaStr,
      STAGE_LABELS[bill.stage] || 'Introduced',
      bill.confidence_label || '--',
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Bill', 'Title', 'Score', 'Chg', 'Stage', 'Confidence']],
    body: tableData,
    margin: { left: m, right: m },
    styles: {
      fontSize: 7.5,
      cellPadding: 2.5,
      textColor: [40, 40, 40],
      lineColor: LGRAY,
      lineWidth: 0.15,
      font: 'helvetica',
    },
    headStyles: {
      fillColor: NAVY,
      textColor: WHITE,
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { cellWidth: 20, fontStyle: 'bold', font: 'courier' },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 14, halign: 'center' },
      3: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 26 },
      5: { cellWidth: 24 },
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
      // Color-code confidence
      if (col === 5) {
        if (val === 'HIGH')           data.cell.styles.textColor = [0, 150, 135]
        else if (val === 'MODERATE')  data.cell.styles.textColor = [170, 130, 50]
        else if (val === 'LOW')       data.cell.styles.textColor = [200, 55, 55]
        else if (val === 'VERY LOW')  data.cell.styles.textColor = [150, 150, 150]
      }
    },
  })

  // autoTable() returns undefined — finalY is on doc.lastAutoTable
  y = doc.lastAutoTable.finalY + 10

  /* ================================================================
     METHODOLOGY NOTE
     ================================================================ */

  // Check if we need a new page for methodology + footer
  if (y > ph - 60) {
    doc.addPage()
    y = 20
  }

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

  // Use splitTextToSize for proper word-wrapping within margins
  const methodText =
    'Trajectory scores (0-99) are generated by Vector WA\'s proprietary scoring engine analyzing ' +
    'five signals: committee activity, sponsor strength, legislative momentum, fiscal impact, and ' +
    'historical category pass rates. Each signal is independently weighted and combined with ' +
    'X-Factor multipliers for exceptional circumstances (e.g., emergency clauses, governor requests).' +
    '\n\n' +
    'Scores are calibrated against verified 2025-2026 session outcomes. Confidence labels reflect ' +
    'calibrated pass probability: HIGH (>10%), MODERATE (1-10%), LOW (<1%), VERY LOW (<0.1%). ' +
    'Score changes (Chg column) reflect movement since the previous daily snapshot.'

  const wrappedLines = doc.splitTextToSize(methodText, contentW)
  wrappedLines.forEach(line => {
    // If we'd run into the footer, start a new page
    if (y > ph - 18) {
      doc.addPage()
      y = 20
    }
    doc.text(line, m, y)
    y += 3.2
  })

  /* ================================================================
     FOOTER (on every page)
     ================================================================ */

  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)

    const fy = ph - 12
    doc.setDrawColor(...TEAL)
    doc.setLineWidth(0.4)
    doc.line(m, fy, pw - m, fy)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(...GRAY)
    doc.text('Post & Policy  |  Vector | WA  |  Legislative Intelligence', m, fy + 5)
    doc.text('CONFIDENTIAL', pw - m, fy + 5, { align: 'right' })

    // Page number (if multi-page)
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
