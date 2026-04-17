import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * VECTOR | WA — Waitlist Signup Email (Brand P2b)
 *
 * Sends a double-opt-in confirmation email to a prospective waitlister.
 * The waitlist row is inserted by the Next.js API route (app/api/waitlist)
 * using the anon key + INSERT-only RLS policy — this function only sends
 * the confirmation email, it does not write to the database.
 *
 * Headers required: x-function-secret (shared secret auth)
 * Body: { email: string, confirmation_token: string }
 *
 * Email template is inlined (not imported from _shared/) per CLAUDE.md rule
 * so Supabase MCP deploy doesn't need extra files.
 */

const APP_URL = 'https://vector-app-liard.vercel.app';
const PUBLIC_LAUNCH = 'August 2027';

// ── Brand colors (email palette — Forest + Brass + Parchment) ──────────
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
};

function wrapEmail(subject: string, bodyHtml: string): string {
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
              <td align="right" style="font-size:12px; color:${COLORS.brassLight};">Shorepine Civic Tech</td>
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
            Shorepine Civic Tech &middot; Olympia, WA<br>
            Free legislative intelligence for Washington State
          </p>
          <p style="margin:0; font-size:11px; color:${COLORS.mutedText};">
            You are receiving this because someone entered this address on the Vector | WA waitlist. If that wasn&rsquo;t you, ignore this email and you will not be added.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildWaitlistConfirmationEmail(confirmUrl: string): { subject: string; html: string } {
  const subject = `Confirm your spot on the Vector | WA waitlist`;
  const bodyHtml = `
    <h2 style="margin:0 0 12px; font-size:20px; font-weight:700; color:${COLORS.forestDeep};">One more step.</h2>
    <p style="margin:0 0 16px; font-size:15px; color:${COLORS.forestText};">
      Vector | WA is free legislative intelligence for Washington State &mdash; built by Shorepine Civic Tech.
      Public accounts open <strong>${PUBLIC_LAUNCH}</strong>. Confirm your email below and we&rsquo;ll notify you the day signup opens.
    </p>
    <p style="margin:24px 0; text-align:center;">
      <a href="${confirmUrl}" style="display:inline-block; background-color:${COLORS.brass}; color:${COLORS.white}; font-size:14px; font-weight:600; padding:12px 28px; border-radius:6px; text-decoration:none; letter-spacing:0.04em;">Confirm my email</a>
    </p>
    <p style="margin:16px 0 0; font-size:13px; color:${COLORS.mutedText};">
      Or copy this link into your browser:<br>
      <span style="word-break:break-all; color:${COLORS.slate};">${confirmUrl}</span>
    </p>
    <hr style="margin:24px 0; border:none; border-top:1px solid ${COLORS.cardBorder};">
    <p style="margin:0; font-size:13px; color:${COLORS.slate};">
      Shorepine Civic Tech is a free, nonpartisan civic-technology company. Accounts are free &mdash; always &mdash; and we don&rsquo;t sell your data.
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

    const fromEmail = Deno.env.get('RESEND_FROM_EMAIL') || 'alerts@shorepine.org';

    // ── Parse body ───────────────────────────────────────
    let body: { email?: string; confirmation_token?: string } = {};
    try {
      body = await req.json();
    } catch {
      return jsonResp({ error: 'Invalid JSON body' }, 400);
    }

    const email = (body.email || '').toLowerCase().trim();
    const token = body.confirmation_token || '';

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
      return jsonResp({ error: 'Invalid email' }, 400);
    }
    if (!token || token.length < 16) {
      return jsonResp({ error: 'Invalid token' }, 400);
    }

    // ── Build + send email ───────────────────────────────
    const confirmUrl = `${APP_URL}/api/waitlist/confirm?token=${encodeURIComponent(token)}`;
    const { subject, html } = buildWaitlistConfirmationEmail(confirmUrl);

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
    console.log(`waitlist-signup sent to ${email} in ${elapsedMs}ms — resend id ${sendResult.id}`);

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
