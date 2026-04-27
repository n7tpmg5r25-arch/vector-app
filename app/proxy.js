import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

// Phase 12 public layer: when NEXT_PUBLIC_ENABLE_PUBLIC_LAYER is 'true',
// anon visitors are admitted to the routes in this allowlist instead of
// being redirected to /login. With the flag false (production default)
// this list is never consulted -- behavior is byte-identical to
// pre-Batch-4.
//
// Each batch expanded the list:
//   Batch 4:                 '/'
//   Batch 5:                 '/bill/[id]' (prefix: '/bill/')
//   Batch 6:                 '/search', '/committees', '/committees/[slug]',
//                            '/members', '/methodology', '/outcomes',
//                            '/hearings'
//   Thread 9:                '/how-it-works'
//   Thread 24:               '/about'
// '/disclaimers' is matched by isAlwaysPublic below (no flag dependency).
function isPublicLayerRoute(pathname) {
  if (pathname === '/') return true
  if (pathname.startsWith('/bill/')) return true
  if (pathname === '/search') return true
  if (pathname === '/committees') return true
  if (pathname.startsWith('/committees/')) return true
  if (pathname === '/members') return true
  if (pathname === '/methodology') return true
  if (pathname === '/outcomes') return true
  if (pathname === '/hearings') return true
  if (pathname === '/how-it-works') return true
  if (pathname === '/about') return true
  return false
}

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