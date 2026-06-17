import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isAdmin } from '../../../../lib/admin'

/**
 * POST /api/admin/invite — Thread 2 PR (b)
 *
 * Owner-only. Body: { client_id, email }.
 *
 * Flow:
 *  1. Auth gate (Supabase session must pass isAdmin).
 *  2. Validate the client_id exists via service_role SELECT.
 *  3. Find-or-create the user via the Supabase admin API:
 *      - If an auth user with this email exists, reuse their UID and
 *        merge app_metadata so role='client'. We preserve any existing
 *        app_metadata keys.
 *      - If not, createUser() with app_metadata.role='client' and
 *        email_confirm=false (the magic link IS the email confirmation).
 *  4. Upsert into client_users (primary key is (client_id, user_id), so
 *     a duplicate invite is idempotent).
 *  5. Generate a magic link via admin.generateLink and return it to the
 *     admin UI as a fallback if the auto-send email is slow.
 *
 * Why we return the magic link in plaintext to the admin:
 *   Colin is the sole admin (isAdmin gate) and uses this as a belt-and-
 *   suspenders fallback when the Supabase SMTP email is delayed or
 *   filtered. Do NOT expose this link to non-admin callers — the route
 *   is gated, but the link itself grants session access until it's
 *   consumed or expires.
 *
 * Post-callback routing to /c/{slug} is Thread 3 work. For now the user
 * lands at /auth/callback which routes to '/' for all roles.
 */

export async function POST(request) {
  try {
    // ── Auth gate ────────────────────────────────────────
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options)
              )
            } catch {}
          },
        },
      }
    )
    const { data: { user: actor } } = await supabase.auth.getUser()
    if (!actor) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
    if (!isAdmin(actor)) return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 })

    // ── Parse + validate ─────────────────────────────────
    const body = await request.json().catch(() => ({}))
    const clientId = typeof body.client_id === 'string' ? body.client_id.trim() : ''
    const rawEmail = typeof body.email === 'string' ? body.email : ''
    const email = rawEmail.trim().toLowerCase()

    if (!clientId) return NextResponse.json({ ok: false, error: 'client_id is required.' }, { status: 400 })
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 320) {
      return NextResponse.json({ ok: false, error: 'Invalid email.' }, { status: 400 })
    }

    // ── Service-role client ──────────────────────────────
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!serviceKey || !supabaseUrl) {
      return NextResponse.json({ ok: false, error: 'Server not configured.' }, { status: 500 })
    }
    const admin = createClient(supabaseUrl, serviceKey)

    // ── Confirm client exists (and grab slug for the redirect) ──
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('id, slug, name, status')
      .eq('id', clientId)
      .single()
    if (clientErr || !client) {
      return NextResponse.json({ ok: false, error: 'Client not found.' }, { status: 404 })
    }
    if (client.status !== 'active') {
      return NextResponse.json({ ok: false, error: `Client is ${client.status}.` }, { status: 409 })
    }

    // ── Find-or-create the auth user ─────────────────────
    // There's no first-class "get user by email" admin endpoint in the JS
    // SDK; we page listUsers with a reasonable window (per-page=200) and
    // filter by email. Vector's user count is <100 in the 2029 launch
    // scale target, so one or two pages is plenty.
    let targetUser = null
    try {
      let page = 1
      while (page < 10) { // hard cap: 2,000 users scanned max
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
        if (error) throw error
        const users = data?.users || []
        const match = users.find(u => (u.email || '').toLowerCase() === email)
        if (match) { targetUser = match; break }
        if (users.length < 200) break
        page += 1
      }
    } catch (err) {
      console.error('[/api/admin/invite] listUsers error:', err)
      return NextResponse.json({ ok: false, error: 'User lookup failed.' }, { status: 500 })
    }

    let alreadyMember = false
    let userId = null

    if (targetUser) {
      userId = targetUser.id
      const existingMeta = targetUser.app_metadata || {}
      // If the user doesn't already have a role set, stamp them as
      // 'client'. If they already have a role (today only 'client' is
      // used; future roles are possible), leave it alone — membership
      // in client_users is the true authorization gate, and owner is
      // detected by the UID allowlist in app/lib/admin.js, not metadata.
      if (!existingMeta.role) {
        const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
          app_metadata: { ...existingMeta, role: 'client' },
        })
        if (updErr) {
          console.error('[/api/admin/invite] updateUserById error:', updErr)
          return NextResponse.json({ ok: false, error: 'Could not update user metadata.' }, { status: 500 })
        }
      }
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        email_confirm: false,
        app_metadata: { role: 'client' },
      })
      if (createErr || !created?.user) {
        console.error('[/api/admin/invite] createUser error:', createErr)
        return NextResponse.json(
          { ok: false, error: createErr?.message || 'Could not create user.' },
          { status: 500 },
        )
      }
      userId = created.user.id
    }

    // ── Upsert client_users ──────────────────────────────
    // Check first so we can report "already a member" without rewriting
    // invited_at. Primary key = (client_id, user_id).
    const { data: existing, error: existingErr } = await admin
      .from('client_users')
      .select('user_id')
      .eq('client_id', clientId)
      .eq('user_id', userId)
      .maybeSingle()

    if (existingErr) {
      console.error('[/api/admin/invite] existing check error:', existingErr)
      return NextResponse.json({ ok: false, error: 'Membership check failed.' }, { status: 500 })
    }

    if (existing) {
      alreadyMember = true
    } else {
      const { error: insertErr } = await admin
        .from('client_users')
        .insert({ client_id: clientId, user_id: userId, role: 'viewer' })
      if (insertErr) {
        console.error('[/api/admin/invite] client_users insert error:', insertErr)
        return NextResponse.json({ ok: false, error: 'Could not record membership.' }, { status: 500 })
      }
    }

    // ── Generate magic link ──────────────────────────────
    // Supabase send the email via its SMTP config (Resend). The returned
    // action_link is our fallback for the admin UI.
    const origin = request.headers.get('origin')
      || new URL(request.url).origin
      || 'https://vectorwa.com'
    const redirectTo = `${origin}/auth/callback`

    let magicLink = null
    try {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo },
      })
      if (error) throw error
      magicLink = data?.properties?.action_link || null
    } catch (err) {
      console.error('[/api/admin/invite] generateLink error:', err)
      // Non-fatal — membership is set up; admin can re-send from Supabase
      // dashboard or prompt user to use /login magic-link flow directly.
    }

    return NextResponse.json({
      ok: true,
      user_id: userId,
      already_member: alreadyMember,
      magic_link: magicLink,
    })
  } catch (err) {
    console.error('[/api/admin/invite] unexpected error:', err)
    return NextResponse.json({ ok: false, error: 'Server error.' }, { status: 500 })
  }
}
