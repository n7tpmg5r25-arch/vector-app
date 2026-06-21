import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

// Phase 12 public layer: when NEXT_PUBLIC_ENABLE_PUBLIC_LAYER is 'true',
// anon visitors are admitted to the data routes in this allowlist instead
// of being redirected to /login. With the flag false (production default)
// this list is never consulted -- behavior is byte-identical to
// pre-Batch-4 for the data surfaces.
//
// Each batch expanded the list:
//   Batch 4:                 '/'
//   Batch 5:                 '/bill/[id]' (prefix: '/bill/')
//   Batch 6:                 '/search', '/committees', '/committees/[slug]',
//                            '/members', '/outcomes', '/hearings'
//   Phase 6 Thread 65:       '/methodology', '/how-it-works', '/about',
//                            '/changelog' MOVED OUT of this list into
//                            isAlwaysPublic below -- info/marketing pages
//                            don't expose bill data and should be reachable
//                            from /login regardless of the public-layer
//                            flag. Without this, the Thread 65 LEARN MORE
//                            CTAs bounced back to /login in production.
// '/disclaimers' is matched by isAlwaysPublic below (no flag dependency).
function isPublicLayerRoute(pathname) {
  if (pathname === '/') return true
  if (pathname.startsWith('/bill/')) return true
  if (pathname === '/search') return true
  if (pathname === '/committees') return true
  if (pathname.startsWith('/committees/')) return true
  if (pathname === '/members') return true
  if (pathname === '/outcomes') return true
  if (pathname === '/hearings') return true
  // PORTAL-3 (2026-06-10): personal-workflow surfaces open to anon when the
  // flag is on -- /watchlist renders the device-local list, /radar renders an
  // inline free-account teaser (no dead redirect), /news closes the anon dead
  // end behind the home In-the-news card (PORTAL_DEEP_DIVE.md 1.4-1, 5).
  // Mirror lives in PublicBottomNav.js#isPublicSurface -- same PR, keep in sync.
  if (pathname === '/watchlist') return true
  if (pathname === '/news') return true
  if (pathname === '/radar') return true
  return false
}

// Always-public routes: reachable for anon visitors regardless of the
// Phase-12 public-layer flag. These are auth surfaces (/login,
// /auth/callback) and info/marketing pages that don't expose bill data
// (/disclaimers, /methodology, /about, /install, /changelog).
// Everything in this set links cleanly from /login's LEARN MORE block
// (Thread 65) and the Footer Row 2 link rail.
//
// Thread 71 (2026-05-07): /how-it-works renamed to /install. The 308
// redirect lives in next.config.ts so the old path resolves before
// hitting this allowlist.
function isAlwaysPublic(pathname) {
  return (
    pathname === '/welcome' ||
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
  const publicLayerOn = process.env.NEXT_PUBLIC_ENABLE_PUBLIC_LAYER === 'true'

  if (
    !session &&
    !isAlwaysPublic(pathname) &&
    !(publicLayerOn && isPublicLayerRoute(pathname))
  ) {
    // Pass the originating route as a ?from= param so /login can show
    // a contextual message explaining why the user landed there.
    // Thread 88: /watchlist is the first route with this treatment.
    const loginDest = pathname === '/watchlist'
      ? '/login?from=watchlist'
      : '/login'
    return NextResponse.redirect(new URL(loginDest, req.url))
  }

  if (session && isLoginPage) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\..*).*)'],
}