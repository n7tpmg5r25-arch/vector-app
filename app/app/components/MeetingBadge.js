'use client'
/**
 * Vector | WA — MeetingBadge (Phase 11.1)
 *
 * Small inline badge showing the next upcoming hearing/meeting for a bill.
 * Used on watchlist rows and bill detail page.
 *
 * Usage: <MeetingBadge billId={bill.bill_id} />
 *
 * Self-fetching so parent components don't need to know about the schema.
 * For watchlist rendering performance, parents may pre-fetch meetings and
 * pass `meeting` prop directly to skip the query.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar } from 'lucide-react'
import { createBrowserClient } from '../../lib/supabase'

function fmtDayTime(dateStr, timeStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24))

  let dayLabel
  if (diffDays === 0) dayLabel = 'today'
  else if (diffDays === 1) dayLabel = 'tomorrow'
  else if (diffDays > 1 && diffDays < 7) dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' })
  else dayLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (timeStr) {
    const [h, m] = timeStr.split(':').map(Number)
    const hr12 = h % 12 || 12
    const ampm = h >= 12 ? 'pm' : 'am'
    const timeLabel = `${hr12}${m ? ':' + String(m).padStart(2, '0') : ''}${ampm}`
    return `${dayLabel} ${timeLabel}`
  }
  return dayLabel
}

export default function MeetingBadge({ billId, meeting: propMeeting, compact = false }) {
  const router = useRouter()
  const supabase = createBrowserClient()
  const [meeting, setMeeting] = useState(propMeeting || null)
  const [loaded, setLoaded] = useState(!!propMeeting)

  useEffect(() => {
    if (propMeeting || !billId) { setLoaded(true); return }
    let mounted = true
    async function load() {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('meeting_agenda_items')
        .select('meeting_id, committee_meetings!inner(id, committee_name, meeting_date, meeting_time, chamber, is_joint)')
        .eq('bill_id', billId)
        .gte('committee_meetings.meeting_date', today)
        .order('committee_meetings(meeting_date)', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (mounted) {
        setMeeting(data?.committee_meetings || null)
        setLoaded(true)
      }
    }
    load()
    return () => { mounted = false }
  }, [billId])

  if (!loaded || !meeting) return null

  const label = fmtDayTime(meeting.meeting_date, meeting.meeting_time)
  // Truncate long committee names for the badge
  const cmte = meeting.committee_name || 'Committee'
  const cmteShort = cmte.length > 22 ? cmte.slice(0, 20) + '…' : cmte

  return (
    <span
      onClick={(e) => {
        e.stopPropagation()
        // Link to the committees page filtered view; future: /meetings/[id]
        router.push('/committees')
      }}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: compact ? '1px 6px' : '2px 8px',
        borderRadius: 8,
        fontSize: compact ? 9 : 10,
        fontWeight: 500,
        background: 'rgba(184,151,90,0.08)',
        color: 'var(--gold)',
        border: '1px solid rgba(184,151,90,0.3)',
        fontFamily: 'var(--font-mono)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
      title={`${meeting.meeting_type || 'Meeting'} — ${cmte} (${meeting.chamber}${meeting.is_joint ? ', Joint' : ''})`}
    >
      <Calendar size={compact ? 9 : 10} aria-hidden="true" /> Hearing {label} — {cmteShort}
    </span>
  )
}
