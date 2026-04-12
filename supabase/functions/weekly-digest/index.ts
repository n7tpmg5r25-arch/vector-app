import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildDigestEmail } from "../_shared/email-template.ts";

/**
 * VECTOR | WA — Weekly Digest Edge Function (Phase 9)
 *
 * Builds and sends a Monday 7 AM digest email summarizing the past week's
 * changes to each user's watchlisted bills.
 *
 * Triggered by pg_cron every Monday at 7 AM Pacific:
 *   PDT (Mar–Nov): 0 14 * * 1  (14:00 UTC = 7 AM PDT)
 *   PST (Nov–Mar): 0 15 * * 1  (15:00 UTC = 7 AM PST)
 *   → Use 0 14 * * 1 and accept ±1 hour during PST.
 *
 * Also callable manually via curl with x-function-secret header.
 */

const APP_URL = 'https://vector-app-liard.vercel.app';

// Session dates — update when new biennium begins
const SESSIONS = [
  { session: '2025-2026', start: '2025-01-13', end: '2026-03-12' },
  { session: '2027-2028', start: '2027-01-13', end: '2028-03-10' },
];

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    // ── Auth ─────────────────────────────────────────────
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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'alerts@shorepinegr.com';

    // ── Date range ───────────────────────────────────────
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekAgoStr = weekAgo.toISOString().split('T')[0];
    const todayStr = now.toISOString().split('T')[0];

    const dateRange = `${formatDate(weekAgo)} – ${formatDate(now)}`;

    // ── Session context ──────────────────────────────────
    const currentSession = getCurrentSession(now);
    const isInterim = now > new Date(currentSession.end);
    const sessionContext = isInterim
      ? `Interim — next session opens ${formatDate(new Date(getNextSession(now).start))}`
      : `Day ${dayOfSession(now, currentSession)} of session`;

    // ── Get all users with digest enabled ────────────────
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

    // Filter to users whose digest_day matches today
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

        // Mark alert_events as included in digest
        await supabase
          .from('alert_events')
          .update({ digest_sent_at: now.toISOString() })
          .eq('user_id', user.user_id)
          .is('digest_sent_at', null)
          .lte('detected_at', now.toISOString());

        // Audit log
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

// ── Build digest data for a single user ──────────────────

async function buildDigestData(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  weekAgoStr: string,
  todayStr: string,
  dateRange: string,
  sessionContext: string,
  currentSessionStr: string,
) {
  // 1. Get user's tracked bills with current bill data
  const { data: tracked } = await supabase
    .from('tracked_bills')
    .select(`
      bill_id,
      client_tag,
      bills!inner (
        bill_id, bill_number, title, session,
        confidence_label, final_score, stage,
        hearing_date, pulled_from_rules
      )
    `)
    .eq('user_id', userId);

  const bills = (tracked || []).filter(t => t.bills?.session === currentSessionStr);
  const totalTracked = bills.length;

  // Count outcomes
  let activeCount = 0, passedCount = 0, deadCount = 0, carriedCount = 0;
  for (const t of bills) {
    const label = t.bills.confidence_label;
    if (label === 'LAW') passedCount++;
    else if (label === 'DEAD') deadCount++;
    else if (label === 'CARRY OVER') carriedCount++;
    else activeCount++;
  }

  // 2. Get snapshots from a week ago for comparison
  const billIds = bills.map(t => t.bill_id);
  let weekAgoSnaps: Record<string, { score: number; stage: number; confidence_label: string }> = {};

  if (billIds.length > 0) {
    // Get the most recent snapshot on or before weekAgoStr for each bill
    for (let i = 0; i < billIds.length; i += 500) {
      const batch = billIds.slice(i, i + 500);
      const { data: snaps } = await supabase
        .from('trajectory_snapshots')
        .select('bill_id, score, stage, confidence_label, snapshot_date')
        .in('bill_id', batch)
        .lte('snapshot_date', weekAgoStr)
        .order('snapshot_date', { ascending: false });

      // Keep only the most recent per bill_id
      for (const s of (snaps || [])) {
        if (!weekAgoSnaps[s.bill_id]) {
          weekAgoSnaps[s.bill_id] = s;
        }
      }
    }
  }

  // 3. Detect notable movements
  const movements: Array<{
    bill_number: string;
    bill_id: string;
    title: string;
    client_tag?: string;
    change: string;
  }> = [];

  for (const t of bills) {
    const bill = t.bills;
    const old = weekAgoSnaps[t.bill_id];
    if (!old) continue;

    const changes: string[] = [];

    // Score change > 5 points
    const scoreDelta = (bill.final_score || 0) - (old.score || 0);
    if (Math.abs(scoreDelta) > 5) {
      changes.push(`${scoreDelta > 0 ? '+' : ''}${scoreDelta} points`);
    }

    // Stage change
    if (bill.stage !== old.stage) {
      changes.push(`Stage ${stageName(old.stage)} → ${stageName(bill.stage)}`);
    }

    // Outcome change
    if (bill.confidence_label !== old.confidence_label) {
      if (bill.confidence_label === 'LAW') changes.push('Signed into law');
      else if (bill.confidence_label === 'DEAD') changes.push('Did not advance');
      else if (bill.confidence_label === 'CARRY OVER') changes.push('Passed chamber');
    }

    // Hearing set
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
        client_tag: t.client_tag || undefined,
        change: changes.join(' · '),
      });
    }
  }

  // Sort: biggest score changes first
  movements.sort((a, b) => {
    const aScore = Math.abs(parseInt(a.change) || 0);
    const bScore = Math.abs(parseInt(b.change) || 0);
    return bScore - aScore;
  });

  // 4. Count alerts fired this week
  const { count: alertsFired } = await supabase
    .from('alert_events')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('detected_at', weekAgoStr)
    .lte('detected_at', todayStr);

  // 5. Upcoming hearings (next 7 days)
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

// ── Resend API ───────────────────────────────────────────

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
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const data = await resp.json();
    if (!resp.ok) return { error: data.message || `HTTP ${resp.status}` };
    return { id: data.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Helpers ──────────────────────────────────────────────

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
