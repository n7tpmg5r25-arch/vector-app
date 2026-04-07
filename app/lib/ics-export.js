/**
 * Vector | WA — iCalendar (.ics) Export Utility
 * Generates .ics files for hearing calendar integration.
 */

/**
 * Format a date string to iCal DTSTART format (date only, no timezone issues).
 * Input: '2027-02-15' or '2027-02-15T10:00:00'
 * Output: '20270215' (all-day) or '20270215T100000' (with time)
 */
function toICalDate(dateStr) {
  if (!dateStr) return null
  // If it includes a time component
  if (dateStr.includes('T')) {
    return dateStr.replace(/[-:]/g, '').split('.')[0]
  }
  // Date only -> all-day event
  return dateStr.replace(/-/g, '')
}

/**
 * Escape special characters for iCal text fields.
 */
function escapeIcal(str) {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

/**
 * Generate a UID for an iCal event.
 */
function generateUID(prefix) {
  const rand = Math.random().toString(36).substring(2, 10)
  const ts = Date.now().toString(36)
  return `${prefix}-${ts}-${rand}@vectorwa`
}

/**
 * Build a single VEVENT block.
 * @param {Object} opts
 * @param {string} opts.date - Hearing date (YYYY-MM-DD or ISO)
 * @param {string} opts.summary - Event title
 * @param {string} opts.description - Event description
 * @param {string} opts.location - Hearing room/location
 * @param {string} opts.uid - Unique ID
 */
function buildVEvent({ date, summary, description, location, uid }) {
  const icalDate = toICalDate(date)
  if (!icalDate) return ''

  const isAllDay = !date.includes('T')
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'

  let event = 'BEGIN:VEVENT\r\n'
  event += `UID:${uid || generateUID('hearing')}\r\n`
  event += `DTSTAMP:${now}\r\n`

  if (isAllDay) {
    event += `DTSTART;VALUE=DATE:${icalDate}\r\n`
    event += `DTEND;VALUE=DATE:${icalDate}\r\n`
  } else {
    event += `DTSTART:${icalDate}\r\n`
    // Default 2-hour hearing
    const endDate = new Date(date)
    endDate.setHours(endDate.getHours() + 2)
    const endStr = endDate.toISOString().replace(/[-:]/g, '').split('.')[0]
    event += `DTEND:${endStr}\r\n`
  }

  event += `SUMMARY:${escapeIcal(summary)}\r\n`
  if (description) event += `DESCRIPTION:${escapeIcal(description)}\r\n`
  if (location) event += `LOCATION:${escapeIcal(location)}\r\n`
  event += 'END:VEVENT\r\n'
  return event
}

/**
 * Wrap VEVENT blocks in a VCALENDAR.
 */
function wrapCalendar(events) {
  let cal = 'BEGIN:VCALENDAR\r\n'
  cal += 'VERSION:2.0\r\n'
  cal += 'PRODID:-//Vector WA//Post & Policy//EN\r\n'
  cal += 'CALSCALE:GREGORIAN\r\n'
  cal += 'METHOD:PUBLISH\r\n'
  cal += 'X-WR-CALNAME:Vector WA Hearings\r\n'
  cal += events
  cal += 'END:VCALENDAR\r\n'
  return cal
}

/**
 * Trigger an .ics file download.
 */
function downloadICS(icsString, filename) {
  const blob = new Blob([icsString], { type: 'text/calendar;charset=utf-8' })
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
 * Export a single hearing as .ics.
 * @param {Object} bill - Bill object with hearing data
 * @param {string} session - Session string for leg.wa.gov link
 */
export function exportSingleHearingICS(bill, session) {
  const year = (session || '2025-2026').split('-')[0]
  const billLabel = `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}`
  const legUrl = `https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${year}`

  const event = buildVEvent({
    date: bill.hearing_date,
    summary: `WA Hearing: ${billLabel}`,
    description: `${bill.title || 'Legislative hearing'}\\n\\nCommittee: ${bill.committee_name || 'TBD'}\\nScore: ${bill.final_score ?? 'N/A'}\\n\\n${legUrl}`,
    location: bill.location || 'John L. O\'Brien Building, Olympia WA',
    uid: generateUID(`hearing-${bill.bill_id}`),
  })

  const ics = wrapCalendar(event)
  downloadICS(ics, `WA_Hearing_${billLabel.replace(/\s/g, '_')}.ics`)
}

/**
 * Export all hearings as a single .ics file.
 * @param {Array} bills - Array of bill objects with hearing_date
 * @param {string} session - Session string
 */
export function exportAllHearingsICS(bills, session) {
  const year = (session || '2025-2026').split('-')[0]
  const withDates = bills.filter(b => b.hearing_date)

  if (withDates.length === 0) return

  const events = withDates.map(bill => {
    const billLabel = `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}`
    const legUrl = `https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${year}`
    return buildVEvent({
      date: bill.hearing_date,
      summary: `WA Hearing: ${billLabel}`,
      description: `${bill.title || 'Legislative hearing'}\\n\\nCommittee: ${bill.committee_name || 'TBD'}\\nScore: ${bill.final_score ?? 'N/A'}\\n\\n${legUrl}`,
      location: bill.location || 'John L. O\'Brien Building, Olympia WA',
      uid: generateUID(`hearing-${bill.bill_id}`),
    })
  }).join('')

  const ics = wrapCalendar(events)
  const dateStr = new Date().toISOString().slice(0, 10)
  downloadICS(ics, `Vector_WA_All_Hearings_${dateStr}.ics`)
}
