import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function proxy(req) {
const res = NextResponse.next()

const supabase = createServerClient(
process.env.NEXT_PUBLIC_SUPABASE_URL,
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
{
cookies: {
get: (name) => req.cookies.get(name)?.value,
set: (name, value, options) => {
res.cookies.set({ name, value, ...options })
},
remove: (name, options) => {
res.cookies.set({ name, value: '', ...options })
},
},
}
)

const {
data: { session },
} = await supabase.auth.getSession()

const { pathname } = req.nextUrl

const publicRoutes = ['/login', '/auth/callback']
const isPublic = publicRoutes.some((route) => pathname.startsWith(route))

if (!session && !isPublic) {
const loginUrl = req.nextUrl.clone()
loginUrl.pathname = '/login'
loginUrl.searchParams.set('redirectedFrom', pathname)
return NextResponse.redirect(loginUrl)
}

if (session && pathname === '/login') {
const dashboardUrl = req.nextUrl.clone()
dashboardUrl.pathname = '/dashboard'
return NextResponse.redirect(dashboardUrl)
}

return res
}

export const config = {
matcher: [
'/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
],
}