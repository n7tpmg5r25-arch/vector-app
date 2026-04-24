import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isAdmin } from '../../../lib/admin'
import SignOutButton from './SignOutButton'

/**
 * /c/[slug] — Thread 3 Client Portal Shell
 *
 * Server component. The "proof of life" for the client portal: it proves
 * end-to-end that an invited client user can magic-link in, land on this
 * URL, and see a branded Shorepine shell that confirms they're looking
 * at the right tenant. Thread 4 fills the shell with watchlist + bill
 * detail views; Thread 3 only ships the plumbing.
 *
 * Auth model
 * ──────────
 *   • Anonymous            → redirect to /login (handled by proxy.js
 *                            before this code runs; belt-and-suspenders
 *                            check below in case proxy is bypassed).
 *   • Admin (Colin)        → render shell with "Viewing as client" banner,
 *                            regardless of client_users membership.
 *                            Admin is detected by UID allowlist, not by
 *                            app_metadata (see app/lib/admin.js header).
 *   • Member of the slug   → render shell. No banner.
 *   • Authed non-member    → if they belong to ANY other client, redirect
 *                            to their first slug. Otherwise, /login.
 *
 * RLS posture
 * ───────────
 * The client_users RLS policy (`client_users_read`) lets any authenticated
 * user SELECT their own rows by user_id = auth.uid(). The clients RLS
 * policy uses auth_user_client_ids() for SELECT. So we can ask, "what
 * clients does this user belong to?" with a plain authed query — no
 * service_role needed for the member path.
 *
 * We still use service_role to resolve {slug → client row} for the admin
 * owner-view path, because admins who aren't client_users members can't
 * see the client row via RLS. That's intentional: RLS is the real fence,
 * and the admin surface is a deliberate bypass.
 */

export const dynamic = 'force-dynamic'

// Brand v4.6 Shorepine firm palette — distinct from the Vector app dark
// palette. Intentionally inlined (not wired into CSS vars) so this shell
// stays self-contained. See BRAND_V46_ROLLOUT_PLAN.md §Firm palette.
const SHOREPINE = {
  forest: '#1a4a2e',
  forestMid: '#2d6b45',
  parchment: '#f5f0e6',
  parchmentDeep: '#ece5d3',
  brass: '#b8975a',
  slate: '#4a5060',
  ink: '#1c1c1c',
}

const FONT_DISPLAY = "'Cormorant Garamond', Georgia, serif"
const FONT_BODY = "'Karla', system-ui, sans-serif"

export default async function ClientPortalPage({ params }) {
  const { slug } = await params

  // ─── Auth gate (defence in depth; proxy.js catches anon first) ────────
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
              cookieStore.set(name, value, options),
            )
          } catch {}
        },
      },
    },
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const viewerIsAdmin = isAdmin(user)

  // ─── Find the user's client memberships (RLS-scoped) ─────────────────
  // Returns at most the clients this user belongs to. For an admin who is
  // not a member of any client, this returns []; we fall through to the
  // owner-view path below.
  const { data: memberships } = await supabase
    .from('client_users')
    .select('client_id, role, clients(id, slug, name, status)')
    .order('invited_at', { ascending: true })

  const matched = (memberships || []).find(m => m.clients?.slug === slug)

  // ─── Resolve the requested client ────────────────────────────────────
  // Two paths:
  //   1. Member: we already have the joined client row from memberships.
  //   2. Admin owner-view: service_role fetch because RLS on `clients`
  //      would hide this row from a non-member admin.
  let client = matched?.clients || null

  if (!client && viewerIsAdmin) {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (serviceKey && supabaseUrl) {
      const admin = createClient(supabaseUrl, serviceKey)
      const { data: row } = await admin
        .from('clients')
        .select('id, slug, name, status')
        .eq('slug', slug)
        .maybeSingle()
      if (row) client = row
    }
  }

  // ─── Dispatch ────────────────────────────────────────────────────────
  if (!client) {
    // Not admin and no matching membership → route by whether the user
    // belongs somewhere else entirely.
    if (!viewerIsAdmin) {
      const firstOther = (memberships || []).find(m => m.clients?.slug)
      if (firstOther?.clients?.slug) {
        redirect(`/c/${firstOther.clients.slug}`)
      }
      // No memberships at all — they shouldn't be here. Back to login
      // rather than the owner home: their account isn't provisioned as
      // either an admin or a client_users row.
      redirect('/login')
    }
    // Admin and the slug doesn't exist anywhere → 404. notFound() here
    // instead of /login because an admin typoed a URL — they deserve a
    // real 404, not a silent punt.
    notFound()
  }

  // If we reach here: client is resolved. Banner dispatch:
  //   Admin (UID allowlist) visiting /c/* → banner, unconditionally.
  //   This is explicit per the Thread 3 smoke test matrix: "owner →
  //   /c/<slug> → shows portal with 'Viewing as client' banner". The
  //   banner signals admin-preview capacity, independent of whether
  //   the admin happens to also sit in client_users for this slug.
  //   (Today Colin IS a member of the `internal` test fixture; the
  //   earlier "canonical viewer" exception suppressed the banner for
  //   him and diverged from the spec.)
  const adminOwnerView = viewerIsAdmin

  // ──────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        minHeight: '100vh',
        padding: '24px 16px 48px',
        fontFamily: FONT_BODY,
        color: SHOREPINE.ink,
      }}
    >
      {adminOwnerView && (
        <div
          role="note"
          aria-label="Viewing as client"
          style={{
            maxWidth: 640,
            margin: '0 auto 16px',
            padding: '10px 14px',
            background: 'rgba(184, 151, 90, 0.18)',
            border: `1px solid ${SHOREPINE.brass}`,
            color: SHOREPINE.parchment,
            borderRadius: 8,
            fontSize: 12,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            textAlign: 'center',
          }}
        >
          Viewing as client · Shorepine admin preview
        </div>
      )}

      {/* Parchment card — the portal shell proper */}
      <section
        style={{
          maxWidth: 640,
          margin: '0 auto',
          background: SHOREPINE.parchment,
          border: `1px solid ${SHOREPINE.parchmentDeep}`,
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* Forest header bar */}
        <header
          style={{
            background: SHOREPINE.forest,
            color: SHOREPINE.parchment,
            padding: '18px 22px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                fontWeight: 600,
                lineHeight: 1.15,
                letterSpacing: '0.005em',
              }}
            >
              {client.name}
            </div>
            <div
              style={{
                fontSize: 11,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: 'rgba(245, 240, 230, 0.72)',
                marginTop: 4,
              }}
            >
              Vector | WA · Client Portal
            </div>
          </div>
          <SignOutButton />
        </header>

        {/* Body */}
        <div style={{ padding: '28px 24px 32px' }}>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 26,
              fontWeight: 600,
              color: SHOREPINE.forest,
              lineHeight: 1.2,
              marginBottom: 10,
            }}
          >
            Welcome.
          </h1>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.6,
              color: SHOREPINE.ink,
              marginBottom: 14,
            }}
          >
            This is the {client.name} workspace — the secure surface where
            Shorepine Government Relations will post the bills we&rsquo;re
            tracking on your behalf, plus shared notes and briefings.
          </p>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: SHOREPINE.slate,
            }}
          >
            Your assigned bills, shared notes, and downloadable briefings
            arrive in the next release. You&rsquo;re signed in as{' '}
            <strong style={{ color: SHOREPINE.ink }}>{user.email}</strong>.
          </p>

          {/* Brass divider */}
          <div
            style={{
              height: 1,
              background: SHOREPINE.brass,
              opacity: 0.5,
              margin: '24px 0',
            }}
          />

          {/* Admin-only QA strip */}
          {viewerIsAdmin && (
            <div
              style={{
                fontSize: 12,
                color: SHOREPINE.slate,
                background: SHOREPINE.parchmentDeep,
                border: `1px dashed ${SHOREPINE.brass}`,
                borderRadius: 8,
                padding: '10px 12px',
                marginBottom: 20,
              }}
            >
              <div style={{ textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                Admin · QA
              </div>
              <div>
                Slug <code>{client.slug}</code> · Status <code>{client.status}</code>
                {' · '}
                <Link
                  href={`/admin/clients/${client.id}`}
                  style={{ color: SHOREPINE.forest, fontWeight: 600 }}
                >
                  Manage in admin
                </Link>
              </div>
            </div>
          )}

          {/* Firm ownership line */}
          <p
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 13,
              fontStyle: 'italic',
              color: SHOREPINE.slate,
              textAlign: 'center',
              margin: 0,
            }}
          >
            Vector | WA &mdash; a product of Shorepine Government Relations.
          </p>
        </div>
      </section>
    </div>
  )
}
