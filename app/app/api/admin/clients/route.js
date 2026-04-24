import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isAdmin } from '../../../../lib/admin'

/**
 * POST /api/admin/clients — Thread 2 PR (a)
 *
 * Owner-only. Body: { slug, name }.
 * - Auth gate: Supabase session must be admin (isAdmin helper).
 * - Writes via service_role — admin actions bypass RLS intentionally.
 * - CHECK constraint `clients_slug_reserved_ck` will still block reserved
 *   slugs at the DB level; we mirror the client-side validation, but the
 *   DB is the authority.
 * - Unique-violation on slug returns a friendly 409.
 */

const RESERVED_SLUGS = new Set([
  'app', 'admin', 'login', 'c', 'auth', 'api', 'www',
  'public', 'signup', 'signin', 'signout', 'settings',
])

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/

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
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Not signed in.' }, { status: 401 })
    if (!isAdmin(user)) return NextResponse.json({ ok: false, error: 'Forbidden.' }, { status: 403 })

    // ── Parse + validate ─────────────────────────────────
    const body = await request.json().catch(() => ({}))
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''

    if (!name) return NextResponse.json({ ok: false, error: 'Name is required.' }, { status: 400 })
    if (name.length > 120) return NextResponse.json({ ok: false, error: 'Name is too long.' }, { status: 400 })
    if (!SLUG_RE.test(slug)) {
      return NextResponse.json({ ok: false, error: 'Invalid slug format.' }, { status: 400 })
    }
    if (RESERVED_SLUGS.has(slug)) {
      return NextResponse.json({ ok: false, error: `"${slug}" is reserved.` }, { status: 400 })
    }

    // ── Insert via service_role ──────────────────────────
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    if (!serviceKey) {
      return NextResponse.json({ ok: false, error: 'Server not configured.' }, { status: 500 })
    }
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, serviceKey)

    const { data, error } = await admin
      .from('clients')
      .insert({ name, slug, status: 'active', created_by: user.id })
      .select('id, slug, name, status, created_at')
      .single()

    if (error) {
      // 23505 = unique_violation; 23514 = check_violation (reserved slug CK)
      if (error.code === '23505') {
        return NextResponse.json(
          { ok: false, error: `Slug "${slug}" is already taken.` },
          { status: 409 },
        )
      }
      if (error.code === '23514') {
        return NextResponse.json(
          { ok: false, error: `"${slug}" is reserved.` },
          { status: 400 },
        )
      }
      console.error('[/api/admin/clients] insert error:', error)
      return NextResponse.json({ ok: false, error: error.message || 'Insert failed.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true, client: data })
  } catch (err) {
    console.error('[/api/admin/clients] unexpected error:', err)
    return NextResponse.json({ ok: false, error: 'Server error.' }, { status: 500 })
  }
}
