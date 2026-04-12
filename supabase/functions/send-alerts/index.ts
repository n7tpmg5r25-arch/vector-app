import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildAlertEmail, buildTestEmail } from "../_shared/email-template.ts";

/**
 * VECTOR | WA — Send Alerts Edge Function (Phase 9)
 *
 * Consumes unsent alert_events, groups by user, builds a single
 * batched email per user, sends via Resend, and marks events as sent.
 *
 * Triggered by GitHub Actions curl after mid-day sync (and optionally nightly).
 * Also handles test emails when body.type === 'test'.
 *
 * Headers required: x-function-secret (shared secret auth)
 */

const APP_URL = 'https://vector-app-liard.vercel.app';

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    // ── Auth check ───────────────────────────────────────
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
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // ── Parse request ────────────────────────────────────
    let body: { type?: string; user_id?: string } = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'alerts@shorepinegr.com';

    // ── Test email mode ──────────────────────────────────
    if (body.type === 'test') {
      const userId = body.user_id;
      if (!userId) {
        return jsonResp({ error: 'user_id required for test email' }, 400);
      }

      // Look up user's notification preferences
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

      // Audit log
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

    // ── Event batch mode (default) ───────────────────────
    // Fetch unsent alert events with bill details
    const { data: events, error: evtErr } = await supabase
      .from('alert_events')
      .select(`
        id,
        bill_id,
        user_id,
        event_type,
        event_data,
        bills!inner ( bill_number, title )
      `)
      .is('sent_at', null)
      .order('detected_at', { ascending: true });

    if (evtErr) {
      return jsonResp({ error: `Query failed: ${evtErr.message}` }, 500);
    }

    if (!events || events.length === 0) {
      return jsonResp({ ok: true, message: 'No pending alert events', users_notified: 0 });
    }

    // Group events by user_id
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
      // Check notification preferences
      const { data: prefs } = await supabase
        .from('notification_preferences')
        .select('email, alerts_enabled')
        .eq('user_id', userId)
        .single();

      if (!prefs?.email || prefs.alerts_enabled === false) {
        // Mark events as sent anyway (don't re-send if user enables later)
        const ids = userEvents.map(e => e.id);
        await supabase
          .from('alert_events')
          .update({ sent_at: new Date().toISOString() })
          .in('id', ids);
        continue;
      }

      // Build and send email
      const alertData = userEvents.map(e => ({
        event_type: e.event_type,
        event_data: e.event_data,
        bill_number: e.bills?.bill_number,
        bill_title: e.bills?.title,
        bill_id: e.bill_id,
      }));

      const { subject, html } = buildAlertEmail(alertData, APP_URL);
      const result = await sendViaResend(resendKey, fromEmail, prefs.email, subject, html);

      // Mark events as sent
      const ids = userEvents.map(e => e.id);
      await supabase
        .from('alert_events')
        .update({ sent_at: new Date().toISOString() })
        .in('id', ids);

      // Audit log
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

    if (!resp.ok) {
      return { error: data.message || `HTTP ${resp.status}` };
    }

    return { id: data.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Helpers ──────────────────────────────────────────────

function jsonResp(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
