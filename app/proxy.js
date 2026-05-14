import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

// Thread 98 (2026-05-13): explicit private-route list replaces the
// NEXT_PUBLIC_ENABLE_PUBLIC_LAYER flag gate. Only these four route groups
// require a session; everything else is open to anonymous visitors.
// Prior isPublicLayerRoute() and publicLayerOn flag removed — no longer
// needed now that the public intelligence routes are open by default.
function isPrivateRoute(pathname) {
  return pathname === '/watchlist' ||
    pathname === '/settings' ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/c/')
}

// Always-public routes — kept as documentation. These are auth surfaces
// (/login, /auth/callback) and info/marketing pages that don't expose
// bill data. They are a strict subset of "not private" under the new
// isPrivateRoute() gate above, so this function is no longer consulted
// in the auth gate logic. Preserved for future reference and to keep the
// allowlist explicit.
//
// Thread 65: /methodology, /about, /install, /changelog moved here from
// the old isPublicLayerRoute() list so they remain reachable from /login
// regardless of any feature flag.
// Thread 71 (2026-05-07): /how-it-works renamed to /install. The 308
// redirect lives in next.config.ts so the old path resolves before
// hitting this list.
function isAlwaysPublic(pathname) {
  return (
    pathname === '/login' ||
    pathname === '/auth/callback' ||
    pathname === '/disclaimers' ||
    pathname === '/methodology' ||
    pathname === '/about' ||
    pathname === '/install' ||
    pathname === '/changelog' ||
    pathname === '/roadmap' ||
    pathname === '/api/waitlist' ||
    pathname === '/api/waitlist/confirm'
  )
}

export async function proxy(req) {
  const res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set({ name, value, ...options })
          })
        },
      },
    }
  )

  const { data: { session } } = await supabase.auth.getSession()

  const pathname = req.nextUrl.pathname
  const isLoginPage = pathname === '/login'

  // Thread 98 (2026-05-13): explicit private-route gate. Only /watchlist,
  // /settings, /admin/*, and /c/* require a session. All other routes
  // (data intelligence surfaces, info pages, home) are open to anon users.
  if (!session && isPrivateRoute(pathname)) {
    // Pass the originating route as a ?from= param so /login can show
    // a contextual message explaining why the user landed there.
    // Thread 88: /watchlist is the first route with this treatment.
    const from = pathname === '/watchlist' ? '?from=watchlist' : ''
    return NextResponse.redirect(new URL(`/login${from}`, req.url))
  }

  if (session && isLoginPage) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\..*).*)'],
}