import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Vector | WA weekly-digest.
//
// CANONICAL DEPLOYED SOURCE. Edge functions deploy via Supabase MCP, not git
// (per CLAUDE.md). This file is the SELF-CONTAINED, inline source of the live
// function (currently v11), kept in sync with the deployed copy so a redeploy
// from this repo cannot regress production. It does NOT import
// ../_shared/email-template.ts (retained for reference only).
//
// v11 (Thread RADAR-AUDIT, 2026-06-14): dropped the dead "/app" link prefix
// (routes are /bill/[id], /watchlist — no /app segment, so old links 404'd);
// added a /settings "Manage notification preferences" link + one-click
// List-Unsubscribe header; and moved the palette off the retired Shorepine
// Forest/Parchment to Vector | WA v1.2 (Dark-Neutral chrome + Brass accent on a
// light neutral background, kept light for deliverability).
//
// From-address hardcoded to the verified vectorwa.com domain.

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

function buildDigestEmail(data: DigestData, appUrl: string): { subject: string; html: string } {
  const subject = `Vector | WA — Weekly Digest (${data.dateRange})`;

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

  let movementsHtml = '';
  if (data.movements.length > 0) {
    const rows = data.movements.map(m => {
      const billLink = `${appUrl}/bill/${encodeURIComponent(m.bill_id)}`;
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

  const alertsHtml = data.alertsFired > 0
    ? `<p style="margin:16px 0 0; font-size:13px; color:${COLORS.mutedText};">${data.alertsFired} per-event alert${data.alertsFired !== 1 ? 's' : ''} were sent this week.</p>`
    : '';

  let upcomingHtml = '';
  if (data.upcoming.length > 0) {
    const items = data.upcoming.map(u => {
      const link = `${appUrl}/bill/${encodeURIComponent(u.bill_id)}`;
      return `<li style="margin-bottom:6px; font-size:13px;"><a href="${link}" style="color:${COLORS.forestDeep}; font-weight:600; text-decoration:none;">${u.bill_number}</a> — ${u.description}</li>`;
    }).join('');
    upcomingHtml = `
      <h3 style="margin:20px 0 8px; font-size:16px; font-weight:700; color:${COLORS.forestDeep};">Upcoming</h3>
      <ul style="margin:0; padding-left:20px;">${items}</ul>`;
  }

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
      <a href="${appUrl}/watchlist" style="display:inline-block; background-color:${COLORS.brass}; color:${COLORS.white}; font-size:14px; font-weight:600; padding:10px 24px; border-radius:6px; text-decoration:none;">Open Vector | WA</a>
    </p>`;

  return { subject, html: wrapEmail(subject, bodyHtml, `${appUrl}/settings`) };
}

function truncate(str: string, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

const APP_URL = 'https://vectorwa.com';

const SESSIONS = [
  { session: '2025-2026', start: '2025-01-13', end: '2026-03-12' },
  { session: '2027-2028', start: '2027-01-11', end: '2028-03-10' },
];

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    const secret = req.headers.get('x-function-secret');
    const expectedSecret = Deno.env.get('FUNCTION_SECRET');
    if (!secret || secret !== expectedSecret) {
      return jsonResp({ error: 'Unauthorized' }, 401);
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return jsonResp({ error: 'RESEND_API_KEY not configured' }, 500);
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const fromEmail = 'Vector | WA <alerts@vectorwa.com>';

    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    const dateRange = `${formatDate(weekAgo)} – ${formatDate(now)}`;

    const currentSession = getCurrentSession(now);
    const isInterim = now > new Date(currentSession.end);
    const sessionContext = isInterim
      ? `Interim — next session opens ${formatDate(new Date(getNextSession(now).start))}`
      : `Day ${dayOfSession(now, currentSession)} of session`;

    const { data: prefs, error: prefsErr } = await supabase
      .from('notification_preferences')
      .select('user_id, email, digest_day')
      .eq('digest_enabled', true);

    if (prefsErr) {
      return jsonResp({ error: `Prefs query: ${prefsErr.message}` }, 500);
    }

    if (!prefs || prefs.length === 0) {
      return jsonResp({ ok: true, message: 'No users with digest enabled', sent: 0 });
    }

    const todayDay = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'][now.getDay()];
    const eligibleUsers = prefs.filter(p => p.digest_day === todayDay);

    if (eligibleUsers.length === 0) {
      return jsonResp({ ok: true, message: `No users with digest_day = ${todayDay}`, sent: 0 });
    }

    let sent = 0;
    const errors: string[] = [];

    for (const user of eligibleUsers) {
      try {
        const digestData = await buildDigestData(
          supabase, user.user_id, weekAgoStr, todayStr, dateRange, sessionContext, currentSession.session,
        );

        const { subject, html } = buildDigestEmail(digestData, APP_URL);
        const result = await sendViaResend(resendKey, fromEmail, user.email, subject, html);

        await supabase
          .from('alert_events')
          .update({ digest_sent_at: now.toISOString() })
          .eq('user_id', user.user_id)
          .is('digest_sent_at', null)
          .lte('detected_at', now.toISOString());

        await supabase.from('notifications_sent').insert({
          user_id: user.user_id,
          email_type: 'digest',
          recipient: user.email,
          resend_id: result.id || null,
          event_count: digestData.alertsFired,
          bill_count: digestData.totalTracked,
          error: result.error || null,
        });

        if (result.error) {
          errors.push(`${user.user_id}: ${result.error}`);
        } else {
          sent++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${user.user_id}: ${msg}`);
      }
    }

    const duration = Date.now() - startTime;
    return jsonResp({
      ok: errors.length === 0,
      sent,
      eligible: eligibleUsers.length,
      errors: errors.length > 0 ? errors : undefined,
      duration_ms: duration,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('weekly-digest error:', message);
    return jsonResp({ ok: false, error: message }, 500);
  }
});

async function buildDigestData(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  weekAgoStr: string,
  todayStr: string,
  dateRange: string,
  sessionContext: string,
  currentSessionStr: string,
) {
  const { data: tracked } = await supabase
    .from('tracked_bills')
    .select(`
      bill_id,
      tag,
      bills!inner (
        bill_id, bill_number, title, session,
        confidence_label, final_score, stage,
        hearing_date, pulled_from_rules
      )
    `)
    .eq('user_id', userId);

  const bills = (tracked || []).filter(t => t.bills?.session === currentSessionStr);
  const totalTracked = bills.length;

  let activeCount = 0, passedCount = 0, deadCount = 0, carriedCount = 0;
  for (const t of bills) {
    const label = t.bills.confidence_label;
    if (label === 'LAW') passedCount++;
    else if (label === 'DEAD') deadCount++;
    else if (label === 'PASSED_CHAMBER') carriedCount++;
    else activeCount++;
  }

  const billIds = bills.map(t => t.bill_id);
  let weekAgoSnaps: Record<string, { score: number; stage: number; confidence_label: string }> = {};

  if (billIds.length > 0) {
    for (let i = 0; i < billIds.length; i += 500) {
      const batch = billIds.slice(i, i + 500);
      const { data: snaps } = await supabase
        .from('trajectory_snapshots')
        .select('bill_id, score, stage, confidence_label, snapshot_date')
        .in('bill_id', batch)
        .lte('snapshot_date', weekAgoStr)
        .order('snapshot_date', { ascending: false });

      for (const s of (snaps || [])) {
        if (!weekAgoSnaps[s.bill_id]) {
          weekAgoSnaps[s.bill_id] = s;
        }
      }
    }
  }

  const movements: Array<{
    bill_number: string;
    bill_id: string;
    title: string;
    tag?: string;
    change: string;
  }> = [];

  for (const t of bills) {
    const bill = t.bills;
    const old = weekAgoSnaps[t.bill_id];
    if (!old) continue;

    const changes: string[] = [];

    const scoreDelta = (bill.final_score || 0) - (old.score || 0);
    if (Math.abs(scoreDelta) > 5) {
      changes.push(`${scoreDelta > 0 ? '+' : ''}${scoreDelta} points`);
    }

    if (bill.stage !== old.stage) {
      changes.push(`Stage ${stageName(old.stage)} → ${stageName(bill.stage)}`);
    }

    if (bill.confidence_label !== old.confidence_label) {
      if (bill.confidence_label === 'LAW') changes.push('Signed into law');
      else if (bill.confidence_label === 'DEAD') changes.push('Did not advance');
      else if (bill.confidence_label === 'PASSED_CHAMBER') changes.push('Passed chamber');
    }

    if (bill.hearing_date) {
      const hearingDate = new Date(bill.hearing_date);
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);
      if (hearingDate <= nextWeek && hearingDate >= new Date()) {
        changes.push(`Hearing ${formatDate(hearingDate)}`);
      }
    }

    if (changes.length > 0) {
      movements.push({
        bill_number: bill.bill_number,
        bill_id: bill.bill_id,
        title: bill.title || '',
        tag: t.tag || undefined,
        change: changes.join(' · '),
      });
    }
  }

  movements.sort((a, b) => {
    const aScore = Math.abs(parseInt(a.change) || 0);
    const bScore = Math.abs(parseInt(b.change) || 0);
    return bScore - aScore;
  });

  const { count: alertsFired } = await supabase
    .from('alert_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('detected_at', weekAgoStr)
    .lte('detected_at', todayStr);

  const upcoming: Array<{ bill_number: string; bill_id: string; description: string }> = [];
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);

  for (const t of bills) {
    const bill = t.bills;
    if (bill.hearing_date) {
      const hd = new Date(bill.hearing_date);
      if (hd >= new Date() && hd <= nextWeek) {
        upcoming.push({
          bill_number: bill.bill_number,
          bill_id: bill.bill_id,
          description: `Hearing on ${formatDate(hd)}`,
        });
      }
    }
  }

  return {
    dateRange,
    totalTracked,
    activeCount,
    passedCount,
    deadCount,
    carriedCount,
    movements,
    alertsFired: alertsFired || 0,
    upcoming,
    sessionContext,
  };
}

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
    if (!resp.ok) return { error: data.message || `HTTP ${resp.status}` };
    return { id: data.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function getCurrentSession(now: Date) {
  for (let i = SESSIONS.length - 1; i >= 0; i--) {
    if (now >= new Date(SESSIONS[i].start)) return SESSIONS[i];
  }
  return SESSIONS[0];
}

function getNextSession(now: Date) {
  const cur = getCurrentSession(now);
  const idx = SESSIONS.findIndex(s => s.session === cur.session);
  return SESSIONS[idx + 1] || SESSIONS[idx];
}

function dayOfSession(now: Date, session: typeof SESSIONS[0]): number {
  const start = new Date(session.start);
  return Math.max(1, Math.ceil((now.getTime() - start.getTime()) / 86400000));
}

function stageName(stage: number): string {
  const names: Record<number, string> = {
    1: 'Introduced',
    2: 'Hearing',
    3: 'Out of Committee',
    4: 'Passed Floor',
    5: 'Opposite Chamber',
    6: 'Signed',
  };
  return names[stage] || `Stage ${stage}`;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
