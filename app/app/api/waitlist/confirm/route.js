import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * GET /api/waitlist/confirm?token=... — Brand P2b
 *
 * Double-opt-in confirmation landing. Looks up the waitlist row by
 * confirmation_token, sets confirmed_at, and redirects to /login with a
 * friendly banner.
 *
 * Uses service_role server-side because the UPDATE is blocked for anon
 * (no UPDATE policy on public.waitlist). This is a narrow, token-gated
 * surface — tokens are 32 random bytes, single-use.
 */

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const token = searchParams.get('token') || ''

  if (!token || token.length < 16 || token.length > 128) {
    return NextResponse.redirect(`${origin}/login?waitlist=invalid`)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.redirect(`${origin}/login?waitlist=error`)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Find row first so we can distinguish "already confirmed" from "bad token".
  const { data: row, error: findErr } = await supabase
    .from('waitlist')
    .select('id, confirmed_at')
    .eq('confirmation_token', token)
    .maybeSingle()

  if (findErr) {
    console.error('waitlist confirm find error:', findErr)
    return NextResponse.redirect(`${origin}/login?waitlist=error`)
  }

  if (!row) {
    return NextResponse.redirect(`${origin}/login?waitlist=invalid`)
  }

  if (row.confirmed_at) {
    return NextResponse.redirect(`${origin}/login?waitlist=already_confirmed`)
  }

  const { error: updateErr } = await supabase
    .from('waitlist')
    .update({ confirmed_at: new Date().toISOString() })
    .eq('id', row.id)

  if (updateErr) {
    console.error('waitlist confirm update error:', updateErr)
    return NextResponse.redirect(`${origin}/login?waitlist=error`)
  }

  return NextResponse.redirect(`${origin}/login?waitlist=confirmed`)
}
