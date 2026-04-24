import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { isAdmin } from '../../../../lib/admin'

/**
 * POST /api/admin/assign-bills — Thread 2 PR (b)
 *
 * Owner-only. Body: { client_id, assign: string[], unassign: string[] }.
 *  - `assign`: bill_ids to set tracked_bills.client_id = client_id for.
 *  - `unassign`: bill_ids to set tracked_bills.client_id = null for, but
 *    only where the row is currently attached to THIS client (we don't
 *    detach rows that belong to a different client, defensive).
 *
 * Both UPDATEs are scoped to rows where user_id = the signed-in admin
 * (today: Colin). A future admin sharing a client pool would need a
 * rethink of this scope — flagged below.
 *
 * Writes run via service_role because there's no write-side RLS policy
 * on tracked_bills.client_id for owner users yet. This keeps the admin
 * path consistent and sidesteps future RLS tightening.
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
    const assign = Array.isArray(body.assign) ? body.assign.filter(x => typeof x === 'string' && x.length > 0) : []
    const unassign = Array.isArray(body.unassign) ? body.unassign.filter(x => typeof x === 'string' && x.length > 0) : []

    if (!clientId) return NextResponse.json({ ok: false, error: 'client_id is required.' }, { status: 400 })
    if (assign.length === 0 && unassign.length === 0) {
      return NextResponse.json({ ok: true, assigned: 0, unassigned: 0 })
    }

    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!serviceKey || !supabaseUrl) {
      return NextResponse.json({ ok: false, error: 'Server not configured.' }, { status: 500 })
    }
    const admin = createClient(supabaseUrl, serviceKey)

    // ── Sanity: client must exist and be active ──────────
    const { data: client, error: clientErr } = await admin
      .from('clients')
      .select('id, status')
      .eq('id', clientId)
      .single()
    if (clientErr || !client) return NextResponse.json({ ok: false, error: 'Client not found.' }, { status: 404 })
    if (client.status !== 'active') {
      return NextResponse.json({ ok: false, error: `Client is ${client.status}.` }, { status: 409 })
    }

    // ── Apply updates ────────────────────────────────────
    // Scope writes to the invoking admin's own tracked_bills rows. Today
    // that's Colin — if we ever add a second admin, revisit: we'd want a
    // "who owns this watchlist row" concept distinct from "who is admin".
    let assignedCount = 0
    let unassignedCount = 0

    if (assign.length > 0) {
      const { data, error } = await admin
        .from('tracked_bills')
        .update({ client_id: clientId })
        .eq('user_id', actor.id)
        .in('bill_id', assign)
        .select('bill_id')
      if (error) {
        console.error('[/api/admin/assign-bills] assign error:', error)
        return NextResponse.json({ ok: false, error: error.message || 'Assign failed.' }, { status: 500 })
      }
      assignedCount = data?.length || 0
    }

    if (unassign.length > 0) {
      const { data, error } = await admin
        .from('tracked_bills')
        .update({ client_id: null })
        .eq('user_id', actor.id)
        .eq('client_id', clientId)        // only detach from THIS client
        .in('bill_id', unassign)
        .select('bill_id')
      if (error) {
        console.error('[/api/admin/assign-bills] unassign error:', error)
        return NextResponse.json({ ok: false, error: error.message || 'Unassign failed.' }, { status: 500 })
      }
      unassignedCount = data?.length || 0
    }

    return NextResponse.json({
      ok: true,
      assigned: assignedCount,
      unassigned: unassignedCount,
    })
  } catch (err) {
    console.error('[/api/admin/assign-bills] unexpected error:', err)
    return NextResponse.json({ ok: false, error: 'Server error.' }, { status: 500 })
  }
}
