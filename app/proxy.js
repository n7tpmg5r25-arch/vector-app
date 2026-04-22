import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

// Phase 12 Batch 4: when NEXT_PUBLIC_ENABLE_PUBLIC_LAYER is 'true', anon
// visitors are admitted to the routes in this allowlist instead of being
// redirected to /login. With the flag false (production default) this list
// is never consulted — behavior is byte-identical to pre-Batch-4.
//
// Each batch expands the list:
//   Batch 4 (this thread):  '/'
//   Batch 5:                 '/bill/[id]'   (prefix: '/bill/')
//   Batch 6:                 '/search', '/committees', '/committees/[slug]',
//                            '/members', '/methodology', '/outcomes',
//                            '/hearings'
// '/disclaimers' is already public-shaped and is matched by isAlwaysPublic
// below (no flag dependency).
function isPublicLayerRoute(pathname) {
  if (pathname === '/') return true
  return false
}

// Routes that are public regardless of the public-layer flag — magic-link
// entry points and the existing public disclaimers page.
function isAlwaysPublic(pathname) {
  return (
    pathname === '/login' ||
    pathname === '/auth/callback' ||
    pathname === '/disclaimers'
  )
}

export async function proxy(req) {
  const res = NextResponse.next()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        // 11.1.1 — migrated to getAll/setAll API (newer @supabase/ssr)
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

  // Anon visitor: redirect to /login UNLESS the route is always-public, OR
  // the public-layer flag is on AND the route is in the public allowlist.
  if (
    !session &&
    !isAlwaysPublic(pathname) &&
    !(publicLayerOn && isPublicLayerRoute(pathname))
  ) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  if (session && isLoginPage) {
    return NextResponse.redirect(new URL('/', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\..*).*)'],
}
