import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { isAdmin } from '../../../../lib/admin'

/**
 * POST /api/admin/grant-access
 *
 * Sends a Supabase invite email to a closed-beta waitlist applicant and
 * stamps converted_at on the waitlist row.
 *
 * Auth flow (mirrors /api/send-test-email):
 *   1. Caller must send Authorization: Bearer <access_token>.
 *   2. We verify the token with service-role getUser() — no cookie handling needed
 *      in a server-side API route.
 *   3. isAdmin() gate: 403 for anyone who isn't Colin (ADMIN_USER_IDS).
 *
 * Why Next.js API route (not Edge Function):
 *   SUPABASE_SERVICE_KEY is already in Vercel env; no extra secret management.
 *   This is a low-volume admin action — Edge Function overhead isn't worth it.
 *
 * Thread 78 — 2026-05-11.
 */

export async function POST(request) {
  try {
    // ── Auth check ──────────────────────────────────────────────────────────
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
    }
    const accessToken = authHeader.replace('Bearer ', '')

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken)
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 })
    }

    // ── Admin gate ───────────────────────────────────────────────────────────
    if (!isAdmin(user)) {
      return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
    }

    // ── Parse body ───────────────────────────────────────────────────────────
    const { email, waitlistId } = await request.json()
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ ok: false, error: 'email required' }, { status: 400 })
    }
    if (!waitlistId) {
      return NextResponse.json({ ok: false, error: 'waitlistId required' }, { status: 400 })
    }

    // ── Invite via Supabase Auth Admin ───────────────────────────────────────
    // inviteUserByEmail sends the user a magic-link invite email.
    // If the user already exists, Supabase returns an error — surface it
    // so the admin can see it inline rather than silently failing.
    const { error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email)
    if (inviteError) {
      return NextResponse.json(
        { ok: false, error: inviteError.message },
        { status: 422 },
      )
    }

    // ── Stamp converted_at ───────────────────────────────────────────────────
    // Best-effort — invite already sent so we don't fail the whole request
    // if the DB update fails (e.g., row was deleted between page load and click).
    const { error: updateError } = await supabase
      .from('waitlist')
      .update({ converted_at: new Date().toISOString() })
      .eq('id', waitlistId)

    if (updateError) {
      console.error('[grant-access] converted_at update failed:', updateError.message)
      // Still return ok:true — the invite went out; DB drift is minor.
    }

    return NextResponse.json({ ok: true })

  } catch (err) {
    console.error('[grant-access] unexpected error:', err)
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 })
  }
}
