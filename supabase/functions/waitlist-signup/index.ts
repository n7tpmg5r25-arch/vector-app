import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * VECTOR | WA — Waitlist Signup Email
 *
 * Sends a double-opt-in confirmation email to a waitlist submitter.
 * The waitlist row is inserted by the Next.js API route (app/api/waitlist)
 * using the anon key + INSERT-only RLS policy — this function only sends
 * the confirmation email, it does not write to the database.
 *
 * Headers required: x-function-secret (shared secret auth)
 * Body: { email: string, confirmation_token: string, source?: string }
 *
 * When source === 'closed_beta', sends beta-specific copy.
 * Otherwise sends the standard public-launch waitlist copy.
 *
 * Thread 73 (2026-05-09): beta copy + Vector | WA brand v1.2.
 * Removed Shorepine GR attribution (brand v1.2 — Vector | WA only).
 */

const APP_URL = 'https://vectorwa.com';
const PUBLIC_LAUNCH = 'August 2027';
const BETA_LAUNCH = 'December 2026';

// Vector | WA brand v1.2 email palette
const C = {
  bg:          '#0e1014',
  card:        '#171921',
  border:      '#2a2d38',
  brass:       '#b8975a',
  brassLight:  '#d4b47a',
  textPrimary: '#e8e9ec',
  textMuted:   '#a8acb4',
  textFaint:   '#6c7078',
};

function wrapEmail(subject: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0; padding:0; background-color:${C.bg}; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; color:${C.textPrimary}; line-height:1.6;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.bg};">
    <tr><td align="center" style="padding:24px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%;">

        <!-- Header -->
        <tr><td style="background-color:${C.card}; padding:20px 28px; border-radius:8px 8px 0 0; border:1px solid ${C.border}; border-bottom:2px solid ${C.brass};">
          <span style="font-size:16px; font-weight:700; color:${C.brass}; letter-spacing:3px; font-family:monospace;">VECTOR | WA</span>
        </td></tr>

        <!-- Body -->
        <tr><td style="background-color:${C.card}; padding:28px; border-left:1px solid ${C.border}; border-right:1px solid ${C.border};">
          ${bodyHtml}
        </td></tr>

        <!-- Footer -->
        <tr><td style="background-color:${C.bg}; padding:16px 28px; border:1px solid ${C.border}; border-top:none; border-radius:0 0 8px 8px;">
          <p style="margin:0 0 6px; font-size:12px; color:${C.textFaint}; font-family:monospace; letter-spacing:1px;">
            VECTOR | WA &mdash; Legislative Intelligence for Washington State
          </p>
          <p style="margin:0; font-size:11px; color:${C.textFaint};">
            You received this because someone entered this address on vectorwa.com. If that wasn&rsquo;t you, ignore this email &mdash; you won&rsquo;t be added.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildBetaConfirmationEmail(confirmUrl: string): { subject: string; html: string } {
  const subject = `Confirm your Vector | WA closed beta request`;
  const bodyHtml = `
    <h2 style="margin:0 0 12px; font-size:20px; font-weight:700; color:${C.brassLight};">One more step.</h2>
    <p style="margin:0 0 16px; font-size:15px; color:${C.textPrimary};">
      Confirm your email to complete your closed beta request. We&rsquo;re targeting <strong style="color:${C.brassLight};">${BETA_LAUNCH}</strong> for the first beta invites.
    </p>
    <p style="margin:0 0 20px; font-size:14px; color:${C.textMuted};">
      Beta access is for people who want to actively help identify bugs and usability issues &mdash; not just an early preview. We&rsquo;ll be in touch when your spot is ready.
    </p>
    <p style="margin:24px 0; text-align:center;">
      <a href="${confirmUrl}" style="display:inline-block; background-color:${C.brass}; color:${C.bg}; font-size:14px; font-weight:700; padding:13px 32px; border-radius:6px; text-decoration:none; letter-spacing:0.06em;">CONFIRM MY EMAIL</a>
    </p>
    <p style="margin:16px 0 0; font-size:12px; color:${C.textFaint};">
      Or copy this link into your browser:<br>
      <span style="word-break:break-all; color:${C.textMuted};">${confirmUrl}</span>
    </p>
    <hr style="margin:24px 0; border:none; border-top:1px solid ${C.border};">
    <p style="margin:0; font-size:12px; color:${C.textFaint};">
      Your email is stored only to send your beta invite. It will not be shared, sold, or used for any other purpose.
    </p>`;

  return { subject, html: wrapEmail(subject, bodyHtml) };
}

function buildWaitlistConfirmationEmail(confirmUrl: string): { subject: string; html: string } {
  const subject = `Confirm your spot on the Vector | WA waitlist`;
  const bodyHtml = `
    <h2 style="margin:0 0 12px; font-size:20px; font-weight:700; color:${C.brassLight};">One more step.</h2>
    <p style="margin:0 0 16px; font-size:15px; color:${C.textPrimary};">
      Vector | WA is free, nonpartisan legislative intelligence for Washington State.
      Public access opens <strong style="color:${C.brassLight};">${PUBLIC_LAUNCH}</strong>. Confirm your email and we&rsquo;ll notify you when anonymous browse goes live.
    </p>
    <p style="margin:24px 0; text-align:center;">
      <a href="${confirmUrl}" style="display:inline-block; background-color:${C.brass}; color:${C.bg}; font-size:14px; font-weight:700; padding:13px 32px; border-radius:6px; text-decoration:none; letter-spacing:0.06em;">CONFIRM MY EMAIL</a>
    </p>
    <p style="margin:16px 0 0; font-size:12px; color:${C.textFaint};">
      Or copy this link into your browser:<br>
      <span style="word-break:break-all; color:${C.textMuted};">${confirmUrl}</span>
    </p>
    <hr style="margin:24px 0; border:none; border-top:1px solid ${C.border};">
    <p style="margin:0; font-size:12px; color:${C.textFaint};">
      Your email is stored only to send the launch notice. No marketing, no resale, no third parties.
    </p>`;

  return { subject, html: wrapEmail(subject, bodyHtml) };
}

Deno.serve(async (req: Request) => {
  const startTime = Date.now();

  try {
    // ── Auth check ───────────────────────────────────────
    const secret = req.headers.get('x-function-secret');
    const expectedSecret = Deno.env.get('FUNCTION_SECRET');
    if (!secret || secret !== expectedSecret) {
      return jsonResp({ error: 'Unauthorized' }, 401);
    }

    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (!resendKey) {
      return jsonResp({ error: 'RESEND_API_KEY not configured' }, 500);
    }

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'hello@vectorwa.com';

    // ── Parse body ───────────────────────────────────────
    let body: { email?: string; confirmation_token?: string; source?: string } = {};
    try {
      body = await req.json();
    } catch {
      return jsonResp({ error: 'Invalid JSON body' }, 400);
    }

    const email = (body.email || '').toLowerCase().trim();
    const token = body.confirmation_token || '';
    const source = body.source || '';

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
      return jsonResp({ error: 'Invalid email' }, 400);
    }
    if (!token || token.length < 16) {
      return jsonResp({ error: 'Invalid token' }, 400);
    }

    // ── Build email — branch on source ───────────────────
    const confirmUrl = `${APP_URL}/api/waitlist/confirm?token=${encodeURIComponent(token)}`;
    const { subject, html } = source === 'closed_beta'
      ? buildBetaConfirmationEmail(confirmUrl)
      : buildWaitlistConfirmationEmail(confirmUrl);

    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `Vector | WA <${fromEmail}>`,
        to: [email],
        subject,
        html,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('Resend error:', resp.status, errText);
      return jsonResp({ error: `Resend failed: ${resp.status}` }, 502);
    }

    const sendResult = await resp.json();
    const elapsedMs = Date.now() - startTime;
    console.log(`waitlist-signup [${source || 'public'}] sent to ${email} in ${elapsedMs}ms — resend id ${sendResult.id}`);

    return jsonResp({ ok: true, sent: true, elapsed_ms: elapsedMs });

  } catch (err) {
    console.error('waitlist-signup error:', err);
    return jsonResp({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function jsonResp(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
