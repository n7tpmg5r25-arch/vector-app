/**
 * Shorepine-branded HTML email template for Vector | WA
 * Phase 9: Alerting & Notifications
 *
 * Shared by send-alerts and weekly-digest edge functions.
 * Follows Shorepine Government Relations brand guide v4.6 — email uses Shorepine firm palette
 * (Forest + Brass + Parchment), NOT the dark Vector | WA app palette.
 */

// ── Brand colors (brand guide v1.1 §14 — print palette) ──────────
const COLORS = {
  parchment:   '#f5f0e6',
  forestDeep:  '#1a4a2e',
  forestText:  '#1a2e1a',
  brass:       '#b8975a',
  brassLight:  '#d4b47a',
  white:       '#ffffff',
  slate:       '#4a5060',
  cardBorder:  '#e0d8c8',
  mutedText:   '#6b7280',
  successGreen:'#2d6b45',
  alertAmber:  '#c47a30',
  deadGray:    '#8a8070',
};

// ── Event type badges ──────────────────────────────────────
const EVENT_BADGES: Record<string, { label: string; color: string }> = {
  outcome_change:              { label: 'Outcome Change',    color: COLORS.successGreen },
  imminent_hearing:            { label: 'Hearing Scheduled', color: COLORS.brass },
  rules_pull:                  { label: 'Rules Pull',        color: COLORS.alertAmber },
  amendment_posted:            { label: 'Amendment Filed',   color: COLORS.brass },
  fiscal_note_change:          { label: 'Fiscal Note',       color: COLORS.alertAmber },
  // Phase 11.2
  hearing_scheduled:           { label: 'Hearing Scheduled', color: COLORS.brass },
  committee_meeting_scheduled: { label: 'Committee Meeting', color: COLORS.forestDeep },
};

// ── Shared wrapper ─────────────────────────────────────────

export function wrapEmail(subject: string, bodyHtml: string, unsubscribeUrl?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:${COLORS.parchment}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:${COLORS.forestText}; line-height:1.6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${COLORS.parchment};">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

        <!-- Header -->
        <tr><td style="background-color:${COLORS.forestDeep}; padding:20px 28px; border-radius:8px 8px 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:18px; font-weight:700; color:${COLORS.brass}; letter-spacing:2px;">VECTOR | WA</td>
              <td align="right" style="font-size:12px; color:${COLORS.brassLight};">Shorepine Government Relations</td>
            </tr>
          </table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background-color:${COLORS.white}; padding:28px; border-left:1px solid ${COLORS.cardBorder}; border-right:1px solid ${COLORS.cardBorder};">
          ${bodyHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:${COLORS.parchment}; padding:20px 28px; border:1px solid ${COLORS.cardBorder}; border-top:none; border-radius:0 0 8px 8px;">
          <p style="margin:0 0 8px; font-size:12px; color:${COLORS.slate};">
            Shorepine Government Relations &middot; Olympia, WA<br>
            Vector | WA &middot; legislative intelligence for Washington State
          </p>
          ${unsubscribeUrl
            ? `<p style="margin:0; font-size:11px; color:${COLORS.mutedText};"><a href="${unsubscribeUrl}" style="color:${COLORS.mutedText}; text-decoration:underline;">Manage notification preferences</a></p>`
            : ''}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Alert batch email ──────────────────────────────────────

interface AlertEvent {
  event_type: string;
  event_data: Record<string, unknown>;
  bill_number?: string;
  bill_title?: string;
  bill_id?: string;
  // Phase 11.2: joined from committee_meetings
  meeting?: {
    committee_name?: string | null;
    chamber?: string | null;
    meeting_date?: string | null;
    meeting_time?: string | null;
    location?: string | null;
    meeting_type?: string | null;
    agenda_url?: string | null;
    is_joint?: boolean | null;
  } | null;
}

// Phase 11.2 — format a meeting datetime as "Thu 10am" / "Thu 10:30am"
function formatMeetingWhen(date?: string | null, time?: string | null): string {
  if (!date) return '';
  const d = new Date(date + 'T00:00:00');
  const day = d.toLocaleDateString('en-US', { weekday: 'short' });
  if (!time) return day;
  const [hRaw, mRaw] = time.split(':').map(Number);
  const h = hRaw % 12 || 12;
  const ampm = hRaw >= 12 ? 'pm' : 'am';
  const mm = mRaw ? `:${String(mRaw).padStart(2, '0')}` : '';
  return `${day} ${h}${mm}${ampm}`;
}

// Phase 11.2 — specific subject for single-hearing alert
export function buildHearingSubject(evt: AlertEvent): string | null {
  if (evt.event_type !== 'hearing_scheduled') return null;
  const d = (evt.event_data || {}) as Record<string, string>;
  const m = evt.meeting || {};
  const billNum = evt.bill_number || d.bill_number || '';
  const committee = m.committee_name || d.committee_name || '';
  const when = formatMeetingWhen(
    m.meeting_date || d.meeting_date,
    m.meeting_time || d.meeting_time,
  );
  if (!billNum || !committee) return null;
  const whenPart = when ? ` (${when})` : '';
  return `New hearing: ${billNum} — ${committee}${whenPart}`;
}

export function buildAlertEmail(events: AlertEvent[], appUrl: string): { subject: string; html: string } {
  const count = events.length;
  const subject = `Vector | WA — ${count} update${count !== 1 ? 's' : ''} on your tracked bills`;

  const cards = events.map(evt => {
    const badge = EVENT_BADGES[evt.event_type] || { label: evt.event_type, color: COLORS.slate };
    const d = (evt.event_data || {}) as Record<string, string>;
    const m = evt.meeting || {};
    const billNum = evt.bill_number || d.bill_number || '';
    const title = evt.bill_title || '';
    const description = describeEvent(evt);

    // Phase 11.2 — meeting events render a richer card with committee / time /
    // location / agenda link. Link target: bill detail if bill_id present,
    // otherwise committee slug page is not known here so fall back to /committees.
    const isMeetingEvent = evt.event_type === 'hearing_scheduled' || evt.event_type === 'committee_meeting_scheduled';
    const billLink = evt.bill_id
      ? `${appUrl}/app/bill/${encodeURIComponent(evt.bill_id)}`
      : `${appUrl}/app/committees`;

    const headerText = billNum
      ? `${billNum}${title ? ` — ${truncate(title, 60)}` : ''}`
      : (m.committee_name || d.committee_name || 'Committee meeting');

    let metaHtml = '';
    if (isMeetingEvent) {
      const when = formatMeetingWhen(
        m.meeting_date || d.meeting_date,
        m.meeting_time || d.meeting_time,
      );
      const committee = m.committee_name || d.committee_name || '';
      const mtype = m.meeting_type || d.meeting_type || '';
      const location = m.location || d.location || '';
      const agenda = m.agenda_url || d.agenda_url || '';
      const joint = (m.is_joint || d.is_joint) ? ' · <strong>Joint</strong>' : '';
      const bits = [
        committee ? `<strong>${committee}</strong>` : '',
        when,
        mtype,
        location,
      ].filter(Boolean).join(' · ');
      metaHtml = `
        <p style="margin:8px 0 0; font-size:13px; color:${COLORS.slate};">${bits}${joint}</p>
        ${agenda ? `<p style="margin:6px 0 0; font-size:12px;"><a href="${agenda}" style="color:${COLORS.forestDeep}; text-decoration:underline;">View agenda</a></p>` : ''}
      `;
    }

    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px; border:1px solid ${COLORS.cardBorder}; border-left:4px solid ${badge.color}; border-radius:4px;">
        <tr><td style="padding:16px;">
          <p style="margin:0 0 6px;">
            <span style="display:inline-block; background-color:${badge.color}; color:${COLORS.white}; font-size:11px; font-weight:600; padding:2px 8px; border-radius:3px; letter-spacing:0.5px; text-transform:uppercase;">${badge.label}</span>
          </p>
          <p style="margin:0 0 4px; font-size:15px; font-weight:600; color:${COLORS.forestDeep};">
            <a href="${billLink}" style="color:${COLORS.forestDeep}; text-decoration:none;">${headerText}</a>
          </p>
          <p style="margin:0; font-size:14px; color:${COLORS.forestText};">${description}</p>
          ${metaHtml}
        </td></tr>
      </table>`;
  }).join('');

  const bodyHtml = `
    <h2 style="margin:0 0 4px; font-size:20px; font-weight:700; color:${COLORS.forestDeep};">Bill Alerts</h2>
    <p style="margin:0 0 20px; font-size:14px; color:${COLORS.mutedText};">${count} update${count !== 1 ? 's' : ''} detected on your watched bills</p>
    ${cards}
    <p style="margin:16px 0 0; text-align:center;">
      <a href="${appUrl}/app/watchlist" style="display:inline-block; background-color:${COLORS.brass}; color:${COLORS.white}; font-size:14px; font-weight:600; padding:10px 24px; border-radius:6px; text-decoration:none;">View Watchlist</a>
    </p>`;

  return { subject, html: wrapEmail(subject, bodyHtml) };
}

// ── Weekly digest email ────────────────────────────────────

interface DigestData {
  dateRange: string;
  totalTracked: number;
  activeCount: number;
  passedCount: number;
  deadCount: number;
  carriedCount: number;
  movements: DigestMovement[];
  alertsFired: number;
  upcoming: DigestUpcoming[];
  sessionContext: string;
}

interface DigestMovement {
  bill_number: string;
  bill_id: string;
  title: string;
  tag?: string;
  change: string;
}

interface DigestUpcoming {
  bill_number: string;
  bill_id: string;
  description: string;
}

export function buildDigestEmail(data: DigestData, appUrl: string): { subject: string; html: string } {
  const subject = `Vector | WA — Weekly Digest (${data.dateRange})`;

  // Portfolio summary
  const summaryHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px; background-color:${COLORS.parchment}; border-radius:6px;">
      <tr>
        <td style="padding:16px; text-align:center; width:25%;">
          <p style="margin:0; font-size:24px; font-weight:700; color:${COLORS.forestDeep};">${data.totalTracked}</p>
          <p style="margin:2px 0 0; font-size:11px; color:${COLORS.mutedText}; text-transform:uppercase; letter-spacing:0.5px;">Tracked</p>
        </td>
        <td style="padding:16px; text-align:center; width:25%;">
          <p style="margin:0; font-size:24px; font-weight:700; color:${COLORS.successGreen};">${data.passedCount}</p>
          <p style="margin:2px 0 0; font-size:11px; color:${COLORS.mutedText}; text-transform:uppercase; letter-spacing:0.5px;">Passed</p>
        </td>
        <td style="padding:16px; text-align:center; width:25%;">
          <p style="margin:0; font-size:24px; font-weight:700; color:${COLORS.brass};">${data.activeCount}</p>
          <p style="margin:2px 0 0; font-size:11px; color:${COLORS.mutedText}; text-transform:uppercase; letter-spacing:0.5px;">Active</p>
        </td>
        <td style="padding:16px; text-align:center; width:25%;">
          <p style="margin:0; font-size:24px; font-weight:700; color:${COLORS.deadGray};">${data.deadCount}</p>
          <p style="margin:2px 0 0; font-size:11px; color:${COLORS.mutedText}; text-transform:uppercase; letter-spacing:0.5px;">Dead</p>
        </td>
      </tr>
    </table>`;

  // Movements section
  let movementsHtml = '';
  if (data.movements.length > 0) {
    const rows = data.movements.map(m => {
      const billLink = `${appUrl}/app/bill/${encodeURIComponent(m.bill_id)}`;
      const tagBadge = m.tag
        ? `<span style="display:inline-block; background-color:${COLORS.parchment}; color:${COLORS.slate}; font-size:10px; padding:1px 6px; border-radius:3px; margin-left:6px;">${m.tag}</span>`
        : '';
      return `
        <tr>
          <td style="padding:8px 12px; border-bottom:1px solid ${COLORS.cardBorder};">
            <a href="${billLink}" style="color:${COLORS.forestDeep}; text-decoration:none; font-weight:600; font-size:13px;">${m.bill_number}</a>${tagBadge}
            <br><span style="font-size:12px; color:${COLORS.mutedText};">${truncate(m.title, 50)}</span>
          </td>
          <td style="padding:8px 12px; border-bottom:1px solid ${COLORS.cardBorder}; font-size:13px; color:${COLORS.forestText}; text-align:right; white-space:nowrap;">${m.change}</td>
        </tr>`;
    }).join('');

    movementsHtml = `
      <h3 style="margin:20px 0 8px; font-size:16px; font-weight:700; color:${COLORS.forestDeep};">Notable Movement This Week</h3>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.cardBorder}; border-radius:4px;">
        ${rows}
      </table>`;
  } else {
    movementsHtml = `
      <h3 style="margin:20px 0 8px; font-size:16px; font-weight:700; color:${COLORS.forestDeep};">Notable Movement This Week</h3>
      <p style="font-size:14px; color:${COLORS.mutedText};">No significant changes to your tracked bills this week.</p>`;
  }

  // Alerts summary
  const alertsHtml = data.alertsFired > 0
    ? `<p style="margin:16px 0 0; font-size:13px; color:${COLORS.mutedText};">${data.alertsFired} per-event alert${data.alertsFired !== 1 ? 's' : ''} were sent this week.</p>`
    : '';

  // Upcoming section
  let upcomingHtml = '';
  if (data.upcoming.length > 0) {
    const items = data.upcoming.map(u => {
      const link = `${appUrl}/app/bill/${encodeURIComponent(u.bill_id)}`;
      return `<li style="margin-bottom:6px; font-size:13px;"><a href="${link}" style="color:${COLORS.forestDeep}; font-weight:600; text-decoration:none;">${u.bill_number}</a> — ${u.description}</li>`;
    }).join('');
    upcomingHtml = `
      <h3 style="margin:20px 0 8px; font-size:16px; font-weight:700; color:${COLORS.forestDeep};">Upcoming</h3>
      <ul style="margin:0; padding-left:20px;">${items}</ul>`;
  }

  // Session context bar
  const contextHtml = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
      <tr><td style="padding:10px 16px; background-color:${COLORS.forestDeep}; border-radius:4px; text-align:center;">
        <p style="margin:0; font-size:12px; color:${COLORS.brassLight}; letter-spacing:0.5px;">${data.sessionContext}</p>
      </td></tr>
    </table>`;

  const bodyHtml = `
    <h2 style="margin:0 0 4px; font-size:20px; font-weight:700; color:${COLORS.forestDeep};">Weekly Intelligence Digest</h2>
    <p style="margin:0 0 16px; font-size:14px; color:${COLORS.mutedText};">${data.dateRange}</p>
    ${summaryHtml}
    ${movementsHtml}
    ${alertsHtml}
    ${upcomingHtml}
    ${contextHtml}
    <p style="margin:20px 0 0; text-align:center;">
      <a href="${appUrl}/app/watchlist" style="display:inline-block; background-color:${COLORS.brass}; color:${COLORS.white}; font-size:14px; font-weight:600; padding:10px 24px; border-radius:6px; text-decoration:none;">Open Vector | WA</a>
    </p>`;

  return { subject, html: wrapEmail(subject, bodyHtml) };
}

// ── Test email ─────────────────────────────────────────────

export function buildTestEmail(): { subject: string; html: string } {
  const subject = 'Vector | WA — Test Email';
  const bodyHtml = `
    <h2 style="margin:0 0 8px; font-size:20px; font-weight:700; color:${COLORS.forestDeep};">Test Email</h2>
    <p style="margin:0 0 16px; font-size:14px; color:${COLORS.forestText};">
      This confirms your Vector | WA email notifications are working correctly.
      You will receive alerts and weekly digests at this address.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${COLORS.cardBorder}; border-left:4px solid ${COLORS.successGreen}; border-radius:4px;">
      <tr><td style="padding:16px;">
        <p style="margin:0; font-size:14px; color:${COLORS.forestText};">
          <strong style="color:${COLORS.successGreen};">Connected.</strong> Email delivery is working.
        </p>
      </td></tr>
    </table>`;

  return { subject, html: wrapEmail(subject, bodyHtml) };
}

// ── Helpers ────────────────────────────────────────────────

function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function describeEvent(evt: AlertEvent): string {
  const d = evt.event_data as Record<string, string>;
  switch (evt.event_type) {
    case 'outcome_change': {
      const to = d.to || 'unknown';
      if (to === 'LAW') return `Signed into law.`;
      if (to === 'DEAD') return `Did not advance — session ended.`;
      if (to === 'PASSED_CHAMBER') return `Passed one chamber, carried over to next session.`;
      return `Outcome changed to ${to}.`;
    }
    case 'imminent_hearing':
      return `Hearing scheduled${d.hearing_date ? ` for ${d.hearing_date}` : ''}${d.committee ? ` in ${d.committee}` : ''}.`;
    case 'rules_pull':
      return `Pulled from Rules Committee for floor action.`;
    case 'amendment_posted': {
      const count = d.count || '1';
      return `${count} new amendment${count !== '1' ? 's' : ''} filed.`;
    }
    case 'fiscal_note_change':
      return d.note || `Fiscal note status changed to ${d.new_size || 'unknown'}.`;
    case 'hearing_scheduled': {
      const itemType = d.item_type || 'Hearing';
      return `${itemType} scheduled on your watchlist bill.`;
    }
    case 'committee_meeting_scheduled': {
      return `New meeting scheduled on a committee you follow.`;
    }
    default:
      return `${evt.event_type} detected.`;
  }
}
