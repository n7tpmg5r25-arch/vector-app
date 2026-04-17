import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/calendar/watchlist.ics?token=<supabase_access_token>
 *
 * Returns an iCalendar feed of upcoming hearings for the user's watchlist.
 * Designed for webcal:// subscription — calendar apps poll this URL.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return new Response('Missing token parameter', { status: 401 })
    }

    // Verify the token and get user
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) {
      return new Response('Invalid or expired token', { status: 401 })
    }

    // Fetch user's tracked bills with hearing data
    const { data: tracked } = await supabase
      .from('tracked_bills')
      .select(`
        bill_id, tag,
        bills (
          bill_id, bill_number, title, final_score, chamber,
          committee_name, hearing_date, has_public_hearing, session
        )
      `)
      .eq('user_id', user.id)

    const items = (tracked || [])
      .filter(t => t.bills && t.bills.hearing_date)

    // Build iCal
    const events = items.map(t => {
      const b = t.bills
      const billLabel = `${b.chamber === 'House' ? 'HB' : 'SB'} ${b.bill_number}`
      const year = (b.session || '2025-2026').split('-')[0]
      const legUrl = `https://app.leg.wa.gov/billsummary?BillNumber=${b.bill_number}&Year=${year}`
      const uid = `watchlist-${b.bill_id}@vectorwa`

      const icalDate = b.hearing_date.includes('T')
        ? b.hearing_date.replace(/[-:]/g, '').split('.')[0]
        : b.hearing_date.replace(/-/g, '')
      const isAllDay = !b.hearing_date.includes('T')

      let event = 'BEGIN:VEVENT\r\n'
      event += `UID:${uid}\r\n`
      event += `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z\r\n`

      if (isAllDay) {
        event += `DTSTART;VALUE=DATE:${icalDate}\r\n`
        event += `DTEND;VALUE=DATE:${icalDate}\r\n`
      } else {
        event += `DTSTART:${icalDate}\r\n`
        const endDate = new Date(b.hearing_date)
        endDate.setHours(endDate.getHours() + 2)
        event += `DTEND:${endDate.toISOString().replace(/[-:]/g, '').split('.')[0]}\r\n`
      }

      const desc = escapeIcal(`${b.title || 'Legislative hearing'}\\nCommittee: ${b.committee_name || 'TBD'}\\nScore: ${b.final_score ?? 'N/A'}${t.tag ? '\\nTag: ' + t.tag : ''}\\n\\n${legUrl}`)

      event += `SUMMARY:${escapeIcal(`WA Hearing: ${billLabel}`)}\r\n`
      event += `DESCRIPTION:${desc}\r\n`
      event += `LOCATION:${escapeIcal("John L. O'Brien Building, Olympia WA")}\r\n`
      event += 'END:VEVENT\r\n'
      return event
    }).join('')

    let cal = 'BEGIN:VCALENDAR\r\n'
    cal += 'VERSION:2.0\r\n'
    cal += 'PRODID:-//Vector WA//Shorepine Civic Tech//EN\r\n'
    cal += 'CALSCALE:GREGORIAN\r\n'
    cal += 'METHOD:PUBLISH\r\n'
    cal += 'X-WR-CALNAME:Vector WA — My Watchlist Hearings\r\n'
    cal += 'REFRESH-INTERVAL;VALUE=DURATION:PT15M\r\n'
    cal += 'X-PUBLISHED-TTL:PT15M\r\n'
    cal += events
    cal += 'END:VCALENDAR\r\n'

    return new Response(cal, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'inline; filename="watchlist.ics"',
        'Cache-Control': 'public, max-age=900',
      },
    })
  } catch (err) {
    console.error('calendar/watchlist.ics error:', err)
    return new Response('Server error', { status: 500 })
  }
}

function escapeIcal(str) {
  if (!str) return ''
  return str.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}
