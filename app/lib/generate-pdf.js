/**
 * Vector | WA — Client PDF Intelligence Brief Generator
 *
 * Generates a branded Post & Policy / Vector WA report PDF.
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

export async function generateClientPDF({ clientName, date, bills, scoreDeltas, changes }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()   // 210
  const ph = doc.internal.pageSize.getHeight()   // 297
  const m  = 20  // margin
  let y = 16

  /* ━━━━━━━━━━━━━━━━ HEADER (with logo) ━━━━━━━━━━━━━━━━ */

  // Try to load logo from public folder
  const logoData = await loadImageAsBase64('/logo.png')

  if (logoData) {
    // Logo on the left (scaled to ~22mm tall)
    const logoH = 22
    const logoW = logoH * 0.82  // approximate aspect ratio of the V logo
    doc.addImage(logoData, 'PNG', m, y - 4, logoW, logoH)

    // Brand text to the right of logo
    const textX = m + logoW + 4

    doc.setFont('times', 'bold')
    doc.setFontSize(18)
    doc.setTextColor(...NAVY)
    doc.text('POST & POLICY', textX, y + 5)

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...TEAL)
    doc.text('VECTOR | WA', textX, y + 11)

    // Report type (right-aligned)
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

  // Summary box
  doc.setFillColor(245, 248, 252)
  doc.setDrawColor(...LGRAY)
  doc.setLineWidth(0.2)
  doc.roundedRect(m, y, pw - 2 * m, 16, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...NAVY)
  doc.text('PORTFOLIO SUMMARY', m + 4, y + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(60, 60, 60)
  const statsText = `Bills Tracked: ${bills.length}    \u2502    Avg Score: ${avg}    \u2502    High Trajectory (50+): ${highCount}    \u2502    At Risk (<25): ${atRisk}`
  doc.text(statsText, m + 4, y + 12)
  y += 22

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

    changedBills.forEach(({ bill_id, bills: bill }) => {
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
    y += 4
  }

  /* ━━━━━━━━━━━━━━━━ BILL TABLE ━━━━━━━━━━━━━━━━ */

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...NAVY)
  doc.text('TRACKED LEGISLATION', m, y)
  y += 3

  const tableData = bills.map(({ bill_id, bills: bill, client_tag }) => {
    const delta = scoreDeltas[bill_id]
    const deltaStr = delta ? (delta > 0 ? `+${delta}` : `${delta}`) : '\u2014'
    const titleTrunc = (bill.title || '').length > 55
      ? (bill.title || '').slice(0, 55) + '\u2026'
      : (bill.title || '')

    return [
      `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}`,
      titleTrunc,
      String(bill.final_score || 0),
      deltaStr,
      STAGE_LABELS[bill.stage] || 'Introduced',
      bill.confidence_label || '\u2014',
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Bill', 'Title', 'Score', '\u0394', 'Stage', 'Signal']],
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
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 26 },
      5: { cellWidth: 22 },
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
      // Color-code signal strength
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

  /* ━━━━━━━━━━━━━━━━ METHODOLOGY NOTE ━━━━━━━━━━━━━━━━ */

  // Check if we need a new page
  if (y > ph - 55) {
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
  const lines = [
    'Trajectory scores (0\u201399) are generated by Vector WA\u2019s proprietary scoring engine analyzing five signals: committee activity,',
    'sponsor strength, legislative momentum, fiscal impact, and historical category pass rates. Each signal is independently weighted',
    'and combined with X-Factor multipliers for exceptional circumstances (e.g., emergency clauses, governor requests).',
    '',
    'Scores are calibrated against verified 2025\u20132026 session outcomes (196 signed into law out of 3,411 total bills).',
    'Historical pass rates by score bucket: 75\u2013100 = 69.4%, 60\u201375 = 1.3%, below 60 = <1%.',
    'Score changes (\u0394) reflect movement since the previous daily snapshot.',
  ]
  lines.forEach(line => {
    doc.text(line, m, y)
    y += 3.2
  })

  /* ━━━━━━━━━━━━━━━━ FOOTER ━━━━━━━━━━━━━━━━ */

  const fy = ph - 12
  doc.setDrawColor(...TEAL)
  doc.setLineWidth(0.4)
  doc.line(m, fy, pw - m, fy)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7)
  doc.setTextColor(...GRAY)
  doc.text('\u00a9 Post & Policy  \u2502  Vector | WA  \u2502  Legislative Intelligence', m, fy + 5)
  doc.text('CONFIDENTIAL', pw - m, fy + 5, { align: 'right' })

  /* ━━━━━━━━━━━━━━━━ SAVE ━━━━━━━━━━━━━━━━ */

  const safeName = (clientName || 'Portfolio').replace(/[^a-zA-Z0-9]/g, '_')
  const safeDate = date.replace(/[^a-zA-Z0-9]/g, '_')
  const filename = `Vector_WA_Brief_${safeName}_${safeDate}.pdf`

  doc.save(filename)
  return filename
}
