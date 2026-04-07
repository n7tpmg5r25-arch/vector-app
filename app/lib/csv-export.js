/**
 * Vector | WA — CSV Export Utility
 * Generates and downloads CSV files from bill data.
 * Used by search and hearings pages.
 */

const SESSION_FALLBACK = '2025-2026'

/**
 * Convert an array of objects to a CSV string.
 * Handles commas, quotes, and newlines in values.
 */
function toCSV(rows, columns) {
  const header = columns.map(c => c.label).join(',')
  const body = rows.map(row =>
    columns.map(c => {
      let val = c.accessor(row)
      if (val == null) val = ''
      val = String(val).replace(/"/g, '""')
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        val = `"${val}"`
      }
      return val
    }).join(',')
  ).join('\n')
  return header + '\n' + body
}

/**
 * Trigger a CSV download in the browser.
 */
function downloadCSV(csvString, filename) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

/**
 * Export search results as CSV.
 * @param {Array} bills - Array of bill objects from Supabase
 * @param {string} session - Session string like '2025-2026'
 */
export function exportSearchCSV(bills, session) {
  const s = session || SESSION_FALLBACK
  const year = s.split('-')[0]
  const columns = [
    { label: 'Bill', accessor: b => `${b.chamber === 'House' ? 'HB' : 'SB'} ${b.bill_number}` },
    { label: 'Title', accessor: b => b.title || '' },
    { label: 'Score', accessor: b => b.final_score ?? '' },
    { label: 'Stage', accessor: b => {
      const stages = ['', 'Introduced', 'Committee', 'Floor', 'Opp. Chamber', 'Conference', 'Signed']
      return stages[b.stage] || 'Unknown'
    }},
    { label: 'Category', accessor: b => b.category || '' },
    { label: 'Chamber', accessor: b => b.chamber || '' },
    { label: 'Sponsor', accessor: b => b.prime_sponsor || '' },
    { label: 'Party', accessor: b => b.prime_party || '' },
    { label: 'Committee', accessor: b => b.committee_name || '' },
    { label: 'Committee Passed', accessor: b => b.committee_passed ? 'Yes' : 'No' },
    { label: 'Public Hearing', accessor: b => b.has_public_hearing ? 'Yes' : 'No' },
    { label: 'Hearing Date', accessor: b => b.hearing_date || '' },
    { label: 'leg.wa.gov', accessor: b => `https://app.leg.wa.gov/billsummary?BillNumber=${b.bill_number}&Year=${year}` },
  ]
  const csv = toCSV(bills, columns)
  const dateStr = new Date().toISOString().slice(0, 10)
  downloadCSV(csv, `Vector_WA_Bills_${dateStr}.csv`)
}

/**
 * Export hearings data as CSV.
 * @param {Array} bills - Array of bill objects with hearing data
 * @param {string} session - Session string
 */
export function exportHearingsCSV(bills, session) {
  const s = session || SESSION_FALLBACK
  const year = s.split('-')[0]
  const columns = [
    { label: 'Bill', accessor: b => `${b.chamber === 'House' ? 'HB' : 'SB'} ${b.bill_number}` },
    { label: 'Title', accessor: b => b.title || '' },
    { label: 'Score', accessor: b => b.final_score ?? '' },
    { label: 'Hearing Date', accessor: b => b.hearing_date || '' },
    { label: 'Committee', accessor: b => b.committee_name || '' },
    { label: 'Chamber', accessor: b => b.chamber || '' },
    { label: 'Sponsor', accessor: b => b.prime_sponsor || '' },
    { label: 'Party', accessor: b => b.prime_party || '' },
    { label: 'Committee Passed', accessor: b => b.committee_passed ? 'Yes' : 'No' },
    { label: 'leg.wa.gov', accessor: b => `https://app.leg.wa.gov/billsummary?BillNumber=${b.bill_number}&Year=${year}` },
  ]
  const csv = toCSV(bills, columns)
  const dateStr = new Date().toISOString().slice(0, 10)
  downloadCSV(csv, `Vector_WA_Hearings_${dateStr}.csv`)
}
