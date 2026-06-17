import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Vector | WA send-alerts.
//
// CANONICAL DEPLOYED SOURCE. Edge functions deploy via Supabase MCP, not git
// (per CLAUDE.md). This file is the SELF-CONTAINED, inline source of the live
// function (currently v15) and is kept byte-for-byte in sync with the deployed
// copy so a redeploy from this repo cannot regress production. It deliberately
// does NOT import ../_shared/email-template.ts — that shared file is retained
// for reference only and is no longer the deploy source (see its header).
//
// v15 (Thread RADAR-AUDIT, 2026-06-14):
//   - LINK FIX (C1): dropped the dead "/app" prefix from every in-app link.
//     vectorwa.com serves routes at /bill/[id], /watchlist, /radar, /committees,
//     /settings (no /app segment, no basePath/rewrite) so the old links 404'd.
//   - UNSUBSCRIBE (H3): footer "Manage notification preferences" link to
//     /settings + a one-click List-Unsubscribe header (deliverability/compliance).
//   - BRAND (H2): palette moved off the retired Shorepine Forest/Parchment to
//     Vector | WA v1.2 — Dark-Neutral chrome (#0e1014) + Brass accent on a light
//     neutral background (kept light for deliverability). Functional badge colors
//     (success/amber) are semantic and unchanged.
//
// v12 (R2): adds the 'radar_match' event type (term-centric Radar block).
// v13 (R4): radar_match carries event_data.match_reason ('new_bill' |
//   'material_change').
// v14 (R6): adds match_reason='new_language' with a quoted snippet of the added
//   text. 'fulltext'-scope matches still arrive as 'new_bill'. All snippet/
//   title/term text is HTML-escaped before it enters the markup.

const COLORS = {
  parchment:   '#f4f4f5',
  forestDeep:  '#0e1014',
  forestText:  '#1b1d24',
  brass:       '#b8975a',
  brassLight:  '#d4b47a',
  white:       '#ffffff',
  slate:       '#4a5060',
  cardBorder:  '#e3e3e6',
  mutedText:   '#6b7280',
  successGreen:'#2d6b45',
  alertAmber:  '#c47a30',
  deadGray:    '#8a8070',
};

const EVENT_BADGES: Record<string, { label: string; color: string }> = {
  outcome_change:              { label: 'Outcome Change',    color: COLORS.successGreen },
  imminent_hearing:            { label: 'Hearing Scheduled', color: COLORS.brass },
  rules_pull:                  { label: 'Rules Pull',        color: COLORS.alertAmber },
  amendment_posted:            { label: 'Amendment Filed',   color: COLORS.brass },
  fiscal_note_change:          { label: 'Fiscal Note',       color: COLORS.alertAmber },
  hearing_scheduled:           { label: 'Hearing Scheduled', color: COLORS.brass },
  committee_meeting_scheduled: { label: 'Committee Meeting', color: COLORS.slate },
  radar_match:                 { label: 'Radar Match',       color: COLORS.brass },
};

function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapEmail(subject: string, bodyHtml: string, unsubscribeUrl?: string): string {
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
        <tr><td style="background-color:${COLORS.forestDeep}; padding:20px 28px; border-radius:8px 8px 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:18px; font-weight:700; color:${COLORS.brass}; letter-spacing:2px;">VECTOR | WA</td>
              <td align="right" style="font-size:12px; color:${COLORS.brassLight};">Legislative intelligence &middot; Olympia, WA</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="background-color:${COLORS.white}; padding:28px; border-left:1px solid ${COLORS.cardBorder}; border-right:1px solid ${COLORS.cardBorder};">
          ${bodyHtml}
        </td></tr>
        <tr><td style="background-color:${COLORS.parchment}; padding:20px 28px; border:1px solid ${COLORS.cardBorder}; border-top:none; border-radius:0 0 8px 8px;">
          <p style="margin:0 0 8px; font-size:12px; color:${COLORS.slate};">
            Vector | WA &middot; Olympia, WA<br>
            Legislative intelligence for Washington State
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

interface AlertEvent {
  event_type: string;
  event_data: Record<string, unknown>;
  bill_number?: string;
  bill_title?: string;
  bill_id?: string;
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

function buildHearingSubject(evt: AlertEvent): string | null {
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

function radarReason(evt: AlertEvent): string {
  const r = ((evt.event_data || {}) as Record<string, string>).match_reason;
  return r || 'new_bill';
}

function renderRadarGroup(events: AlertEvent[], appUrl: string, reason: string): string {
  const groups = new Map<string, { label: string; client: string | null; bills: { billNum: string; title: string; billId?: string; snippet?: string | null }[] }>();
  for (const evt of events) {
    const d = (evt.event_data || {}) as Record<string, string>;
    const key = String(d.term_id ?? d.term_label ?? 'term');
    let g = groups.get(key);
    if (!g) {
      g = { label: d.term_label || 'Radar term', client: d.client_label || null, bills: [] };
      groups.set(key, g);
    }
    g.bills.push({
      billNum: evt.bill_number || d.bill_number || '',
      title: evt.bill_title || d.bill_title || '',
      billId: evt.bill_id,
      snippet: (d.snippet as string) || null,
    });
  }

  const isChange = reason === 'material_change';
  const isLang = reason === 'new_language';
  const accent = isChange ? COLORS.alertAmber : COLORS.brass;
  const billCount = events.length;
  const termCount = groups.size;

  const groupHtml = [...groups.values()].map(g => {
    const chip = g.client
      ? `<span style="display:inline-block; background-color:${COLORS.parchment}; color:${COLORS.slate}; font-size:11px; font-weight:600; padding:2px 8px; border-radius:3px; margin-left:8px;">${escapeHtml(g.client)}</span>`
      : '';
    let note = '';
    if (isChange) {
      note = `<p style="margin:0 0 10px; font-size:13px; color:${COLORS.alertAmber};">Language changed on ${g.bills.length} bill${g.bills.length !== 1 ? 's' : ''} matching this term — review the latest version.</p>`;
    } else if (isLang) {
      note = `<p style="margin:0 0 10px; font-size:13px; color:${COLORS.slate};">New language was added to ${g.bills.length} bill${g.bills.length !== 1 ? 's' : ''} matching this term:</p>`;
    }
    const items = g.bills.map(b => {
      const link = b.billId
        ? `${appUrl}/bill/${encodeURIComponent(b.billId)}`
        : `${appUrl}/radar`;
      const label = `${escapeHtml(b.billNum)}${b.title ? ` — ${escapeHtml(truncate(b.title, 60))}` : ''}`;
      const quote = (isLang && b.snippet)
        ? `<p style="margin:6px 0 0; padding:8px 12px; background-color:${COLORS.parchment}; border-left:3px solid ${accent}; font-size:13px; color:${COLORS.forestText}; font-style:italic; line-height:1.5;">&ldquo;${escapeHtml(truncate(b.snippet, 240))}&rdquo;</p>`
        : '';
      return `<li style="margin:0 0 ${isLang ? '12' : '6'}px;"><a href="${link}" style="color:${COLORS.forestDeep}; text-decoration:none; font-size:14px;">${label}</a>${quote}</li>`;
    }).join('');
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:16px; border:1px solid ${COLORS.cardBorder}; border-left:4px solid ${accent}; border-radius:4px;">
        <tr><td style="padding:16px;">
          <p style="margin:0 0 10px; font-size:15px; font-weight:600; color:${COLORS.forestDeep};">${escapeHtml(g.label)}${chip}</p>
          ${note}
          <ul style="margin:0; padding-left:18px;">${items}</ul>
        </td></tr>
      </table>`;
  }).join('');

  let heading: string;
  let intro: string;
  if (isChange) {
    heading = `Radar — language changed on ${billCount} bill${billCount !== 1 ? 's' : ''} you watch`;
    intro = termCount > 1 ? `Across ${termCount} of your Radar terms` : 'On a bill matching your Radar terms';
  } else if (isLang) {
    heading = `Radar — new language on ${billCount} bill${billCount !== 1 ? 's' : ''} you watch`;
    intro = termCount > 1 ? `New wording across ${termCount} of your Radar terms` : 'New wording on a bill matching your Radar terms';
  } else {
    heading = `Radar — ${billCount} new bill${billCount !== 1 ? 's' : ''} match your terms`;
    intro = termCount > 1 ? `Across ${termCount} of your Radar terms` : 'Matched against your Radar terms';
  }

  return `
    <h2 style="margin:0 0 4px; font-size:20px; font-weight:700; color:${COLORS.forestDeep};">${heading}</h2>
    <p style="margin:0 0 20px; font-size:14px; color:${COLORS.mutedText};">${intro}</p>
    ${groupHtml}`;
}

function buildRadarSection(radarEvents: AlertEvent[], appUrl: string): string {
  const newBills = radarEvents.filter(e => { const r = radarReason(e); return r !== 'material_change' && r !== 'new_language'; });
  const changed = radarEvents.filter(e => radarReason(e) === 'material_change');
  const newLang = radarEvents.filter(e => radarReason(e) === 'new_language');

  const sections: string[] = [];
  if (newBills.length > 0) sections.push(renderRadarGroup(newBills, appUrl, 'new_bill'));
  if (changed.length > 0) sections.push(renderRadarGroup(changed, appUrl, 'material_change'));
  if (newLang.length > 0) sections.push(renderRadarGroup(newLang, appUrl, 'new_language'));

  let html = sections.join(`<hr style="border:none; border-top:1px solid ${COLORS.cardBorder}; margin:24px 0;">`);

  html += `
    <p style="margin:16px 0 0; text-align:center;">
      <a href="${appUrl}/radar" style="display:inline-block; background-color:${COLORS.brass}; color:${COLORS.white}; font-size:14px; font-weight:600; padding:10px 24px; border-radius:6px; text-decoration:none;">Manage Radar terms</a>
    </p>`;
  return html;
}

function buildAlertEmail(events: AlertEvent[], appUrl: string): { subject: string; html: string } {
  const radarEvents = events.filter(e => e.event_type === 'radar_match');
  const regularEvents = events.filter(e => e.event_type !== 'radar_match');

  const total = events.length;
  const radarChanged = radarEvents.filter(e => radarReason(e) === 'material_change').length;
  const radarLang = radarEvents.filter(e => radarReason(e) === 'new_language').length;
  const radarNew = radarEvents.length - radarChanged - radarLang;

  let subject: string;
  if (regularEvents.length === 0 && radarEvents.length > 0) {
    const cats = [radarNew > 0, radarChanged > 0, radarLang > 0].filter(Boolean).length;
    if (cats > 1) {
      subject = `Vector | WA — ${radarEvents.length} Radar update${radarEvents.length !== 1 ? 's' : ''}`;
    } else if (radarNew > 0) {
      subject = `Vector | WA — ${radarNew} new bill${radarNew !== 1 ? 's' : ''} match your Radar terms`;
    } else if (radarChanged > 0) {
      subject = `Vector | WA — language changed on ${radarChanged} bill${radarChanged !== 1 ? 's' : ''} you watch`;
    } else {
      subject = `Vector | WA — new language on ${radarLang} bill${radarLang !== 1 ? 's' : ''} you watch`;
    }
  } else {
    subject = `Vector | WA — ${total} update${total !== 1 ? 's' : ''} on your tracked bills`;
  }

  let bodyHtml = '';

  if (regularEvents.length > 0) {
    const cards = regularEvents.map(evt => {
      const badge = EVENT_BADGES[evt.event_type] || { label: evt.event_type, color: COLORS.slate };
      const d = (evt.event_data || {}) as Record<string, string>;
      const m = evt.meeting || {};
      const billNum = evt.bill_number || d.bill_number || '';
      const title = evt.bill_title || '';
      const description = describeEvent(evt);

      const isMeetingEvent = evt.event_type === 'hearing_scheduled' || evt.event_type === 'committee_meeting_scheduled';
      const billLink = evt.bill_id
        ? `${appUrl}/bill/${encodeURIComponent(evt.bill_id)}`
        : `${appUrl}/committees`;

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

    bodyHtml += `
    <h2 style="margin:0 0 4px; font-size:20px; font-weight:700; color:${COLORS.forestDeep};">Bill Alerts</h2>
    <p style="margin:0 0 20px; font-size:14px; color:${COLORS.mutedText};">${regularEvents.length} update${regularEvents.length !== 1 ? 's' : ''} detected on your watched bills</p>
    ${cards}
    <p style="margin:16px 0 0; text-align:center;">
      <a href="${appUrl}/watchlist" style="display:inline-block; background-color:${COLORS.brass}; color:${COLORS.white}; font-size:14px; font-weight:600; padding:10px 24px; border-radius:6px; text-decoration:none;">View Watchlist</a>
    </p>`;
  }

  if (radarEvents.length > 0) {
    if (regularEvents.length > 0) {
      bodyHtml += `<hr style="border:none; border-top:1px solid ${COLORS.cardBorder}; margin:28px 0;">`;
    }
    bodyHtml += buildRadarSection(radarEvents, appUrl);
  }

  return { subject, html: wrapEmail(subject, bodyHtml, `${appUrl}/settings`) };
}

function buildTestEmail(): { subject: string; html: string } {
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

  return { subject, html: wrapEmail(subject, bodyHtml, `${APP_URL}/settings`) };
}

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
    case 'radar_match': {
      const tl = d.term_label || 'a Radar term';
      if (d.match_reason === 'material_change') return `Language changed on a bill matching "${tl}".`;
      if (d.match_reason === 'new_language') return `New language added to a bill matching "${tl}".`;
      return `New bill matching "${tl}".`;
    }
    default:
      return `${evt.event_type} detected.`;
  }
}

const APP_URL = 'https://vectorwa.com';

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    const secret = req.headers.get('x-function-secret');
    const expectedSecret = Deno.env.get('FUNCTION_SECRET');
    if (!secret || secret !== expectedSecret) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return new Response(JSON.stringify({ error: 'RESEND_API_KEY not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    let body: { type?: string; user_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const fromEmail = 'Vector | WA <alerts@vectorwa.com>';

    if (body.type === 'test') {
      const userId = body.user_id;
      if (!userId) {
        return jsonResp({ error: 'user_id required for test email' }, 400);
      }

      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('email')
        .eq('user_id', userId)
        .single();

      if (!prefs?.email) {
        return jsonResp({ error: 'No email configured in notification preferences' }, 400);
      }

      const { subject, html } = buildTestEmail();
      const resendResult = await sendViaResend(resendKey, fromEmail, prefs.email, subject, html);

      await supabase.from('notifications_sent').insert({
        user_id: userId,
        email_type: 'test',
        recipient: prefs.email,
        resend_id: resendResult.id || null,
        event_count: 0,
        bill_count: 0,
        error: resendResult.error || null,
      });

      return jsonResp({
        ok: !resendResult.error,
        type: 'test',
        recipient: prefs.email,
        resend_id: resendResult.id,
        error: resendResult.error,
      });
    }

    const { data: events, error: evtErr } = await supabase
      .from('alert_events')
      .select(`
        id,
        bill_id,
        user_id,
        event_type,
        event_data,
        meeting_id,
        bills ( bill_number, title ),
        committee_meetings ( committee_name, chamber, meeting_date, meeting_time, location, meeting_type, agenda_url, is_joint )
      `)
      .is('sent_at', null)
      .order('detected_at', { ascending: true });

    if (evtErr) {
      return jsonResp({ error: `Query failed: ${evtErr.message}` }, 500);
    }

    if (!events || events.length === 0) {
      return jsonResp({ ok: true, message: 'No pending alert events', users_notified: 0 });
    }

    const byUser = new Map<string, typeof events>();
    for (const evt of events) {
      const list = byUser.get(evt.user_id) || [];
      list.push(evt);
      byUser.set(evt.user_id, list);
    }

    let usersNotified = 0;
    let eventsSent = 0;
    const errors: string[] = [];

    for (const [userId, userEvents] of byUser) {
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('email, alerts_enabled')
        .eq('user_id', userId)
        .single();

      if (!prefs?.email || prefs.alerts_enabled === false) {
        const ids = userEvents.map(e => e.id);
        await supabase
          .from('alert_events')
          .update({ sent_at: new Date().toISOString() })
          .in('id', ids);
        continue;
      }

      const alertData = userEvents.map(e => ({
        event_type: e.event_type,
        event_data: e.event_data,
        bill_number: e.bills?.bill_number,
        bill_title: e.bills?.title,
        bill_id: e.bill_id,
        meeting: e.committee_meetings || null,
      }));

      let built = buildAlertEmail(alertData, APP_URL);
      if (alertData.length === 1 && alertData[0].event_type === 'hearing_scheduled') {
        const override = buildHearingSubject(alertData[0]);
        if (override) built = { ...built, subject: override };
      }
      const { subject, html } = built;
      const result = await sendViaResend(resendKey, fromEmail, prefs.email, subject, html);

      const ids = userEvents.map(e => e.id);
      await supabase
        .from('alert_events')
        .update({ sent_at: new Date().toISOString() })
        .in('id', ids);

      await supabase.from('notifications_sent').insert({
        user_id: userId,
        email_type: 'alert_batch',
        recipient: prefs.email,
        resend_id: result.id || null,
        event_count: userEvents.length,
        bill_count: new Set(userEvents.map(e => e.bill_id)).size,
        error: result.error || null,
      });

      if (result.error) {
        errors.push(`${userId}: ${result.error}`);
      } else {
        usersNotified++;
        eventsSent += userEvents.length;
      }
    }

    const duration = Date.now() - startTime;
    return jsonResp({
      ok: errors.length === 0,
      users_notified: usersNotified,
      events_sent: eventsSent,
      errors: errors.length > 0 ? errors : undefined,
      duration_ms: duration,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('send-alerts error:', message);
    return jsonResp({ ok: false, error: message }, 500);
  }
});

async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<{ id?: string; error?: string }> {
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        headers: {
          'List-Unsubscribe': `<${APP_URL}/settings>`,
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return { error: data.message || `HTTP ${resp.status}` };
    }

    return { id: data.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
