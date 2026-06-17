import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

/**
 * POST /api/send-test-email
 *
 * Server-side proxy for the send-alerts edge function (test mode).
 * The browser can't call the edge function directly because it uses
 * x-function-secret auth (not JWT) and has no CORS headers.
 *
 * This route:
 *   1. Verifies the caller is an authenticated Supabase user
 *   2. Calls the send-alerts edge function server-side with the function secret
 *   3. Returns the result to the browser
 */
export async function POST(request) {
  try {
    // Get the user's access token from the Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
    }
    const accessToken = authHeader.replace('Bearer ', '')

    // Verify the token is valid by checking the user
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    )
    const { data: { user }, error: authError } = await supabase.auth.getUser(accessToken)
    if (authError || !user) {
      return NextResponse.json({ ok: false, error: 'Invalid session' }, { status: 401 })
    }

    // Call the send-alerts edge function server-side
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const functionSecret = process.env.FUNCTION_SECRET
    if (!functionSecret) {
      return NextResponse.json({ ok: false, error: 'Server configuration error' }, { status: 500 })
    }

    const resp = await fetch(`${supabaseUrl}/functions/v1/send-alerts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-function-secret': functionSecret,
      },
      body: JSON.stringify({ type: 'test', user_id: user.id }),
    })

    const data = await resp.json()
    return NextResponse.json(data, { status: resp.status })

  } catch (err) {
    console.error('send-test-email error:', err)
    return NextResponse.json({ ok: false, error: 'Server error' }, { status: 500 })
  }
}
