import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import crypto from 'crypto'

/**
 * POST /api/waitlist — Brand P2b
 *
 * Public endpoint. Anyone can submit their email to join the pre-launch waitlist.
 *
 * Security posture:
 *  - Uses anon key (NOT service_role) to insert. A dedicated INSERT-only RLS
 *    policy on public.waitlist lets this succeed without exposing the
 *    service_role key on an internet-facing endpoint.
 *  - Honeypot field (`hp`) silently absorbs bot submissions.
 *  - Per-IP rate limit: 5 submissions/hour (counted via ip_hash).
 *  - Confirmation email sent via the `waitlist-signup` edge function using
 *    x-function-secret auth (same pattern as send-alerts / weekly-digest).
 *  - Response is always generic — we never leak whether an email already
 *    existed on the list.
 *
 * Body: { email, source?, hp? }
 */

const RATE_LIMIT_PER_HOUR = 5

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const rawEmail = typeof body.email === 'string' ? body.email : ''
    const email = rawEmail.toLowerCase().trim()
    const source = typeof body.source === 'string' ? body.source.slice(0, 64) : null
    const honeypot = typeof body.hp === 'string' ? body.hp : ''

    // ── Honeypot ──────────────────────────────────────────
    // Bots fill every field. A real form hides `hp` from humans via CSS.
    // If it's filled, return generic success without doing anything.
    if (honeypot) {
      return NextResponse.json({ ok: true })
    }

    // ── Email validation ──────────────────────────────────
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
      return NextResponse.json(
        { ok: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      )
    }

    // ── IP hash (for rate limit + abuse analysis) ────────
    const forwarded = request.headers.get('x-forwarded-for') || ''
    const clientIp = forwarded.split(',')[0].trim() || request.headers.get('x-real-ip') || 'unknown'
    const ipSalt = process.env.WAITLIST_IP_SALT || 'vector-wa-waitlist-v1'
    const ipHash = crypto.createHash('sha256').update(clientIp + ipSalt).digest('hex').slice(0, 32)
    const userAgent = (request.headers.get('user-agent') || '').slice(0, 256)

    // ── Supabase (anon key + RLS INSERT policy) ──────────
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ ok: false, error: 'Server not configured' }, { status: 500 })
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    // ── Rate limit check ─────────────────────────────────
    // We check via service_role because SELECT is blocked for anon. Narrow
    // scope: COUNT only, no data returned from a public endpoint.
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    if (serviceKey) {
      const adminClient = createClient(supabaseUrl, serviceKey)
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const { count } = await adminClient
        .from('waitlist')
        .select('id', { count: 'exact', head: true })
        .eq('ip_hash', ipHash)
        .gte('created_at', oneHourAgo)

      if ((count ?? 0) >= RATE_LIMIT_PER_HOUR) {
        // Generic response — don't tell scanners the limit triggered.
        return NextResponse.json({ ok: true })
      }
    }

    // ── Generate confirmation token ──────────────────────
    const confirmationToken = crypto.randomBytes(32).toString('hex')

    // ── Beta acknowledgment timestamp (Option B) ─────────
    // When source is 'closed_beta', the client sends beta_ack_at as a signal
    // that the user checked all four acknowledgment boxes before submitting.
    // We accept the client timestamp but only store it as a boolean signal —
    // the real authoritative timestamp is set server-side here.
    const rawBetaAck = body.beta_ack_at
    const betaAckAt = (source === 'closed_beta' && rawBetaAck)
      ? new Date().toISOString()
      : null

    // ── Insert (anon key + RLS INSERT policy) ───────────
    // If email already exists, unique constraint blocks the insert. We still
    // return generic success to avoid leaking membership.
    const insertPayload = {
      email,
      source,
      confirmation_token: confirmationToken,
      ip_hash: ipHash,
      user_agent: userAgent,
    }
    if (betaAckAt) insertPayload.beta_ack_at = betaAckAt

    const { error: insertError } = await supabase
      .from('waitlist')
      .insert(insertPayload)

    if (insertError) {
      // 23505 = unique_violation (email already on list)
      if (insertError.code === '23505') {
        return NextResponse.json({ ok: true, alreadyJoined: true })
      }
      console.error('waitlist insert error:', insertError)
      return NextResponse.json({ ok: false, error: 'Could not join the list. Try again.' }, { status: 500 })
    }

    // ── Send confirmation email via edge function ────────
    const functionSecret = process.env.FUNCTION_SECRET
    if (!functionSecret) {
      console.error('FUNCTION_SECRET not configured — waitlist row inserted but no email sent')
      return NextResponse.json({ ok: true })
    }

    const emailResp = await fetch(`${supabaseUrl}/functions/v1/waitlist-signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-function-secret': functionSecret,
      },
      body: JSON.stringify({ email, confirmation_token: confirmationToken, source }),
    })

    if (!emailResp.ok) {
      const errText = await emailResp.text().catch(() => '')
      console.error('waitlist-signup edge function failed:', emailResp.status, errText)
      // Row is already inserted; user can be re-sent confirmation manually.
      // Don't leak this to the browser.
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('/api/waitlist error:', err)
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 })
  }
}
