import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { isAdmin } from '../../../lib/admin'
import { SHOREPINE, FONT_DISPLAY, FONT_BODY } from '../../../lib/shorepine'
import SignOutButton from './SignOutButton'
import DownloadBriefingButton from './DownloadBriefingButton'

/**
 * /c/[slug] — Client Portal (Thread 4)
 *
 * Server component. Resolves auth + tenant in Thread 3's pattern, then
 * renders the assigned watchlist with shared notes counts. Each bill
 * card links to /c/[slug]/bill/[id], the read-only client bill view.
 *
 * Auth model (unchanged from Thread 3 — see commit a5266b3 + fe00374
 * for the full rationale):
 *   • Anonymous            → redirect to /login (proxy.js catches first)
 *   • Admin (Colin)        → render with "Admin preview" chip in header
 *   • Member of the slug   → render
 *   • Authed non-member    → redirect to first membership, else /login
 *
 * Data fetch:
 *   • For members, the authed `supabase` client returns tracked_bills via
 *     RLS policy `tracked_bills_read_by_client` (Phase 13a) — no
 *     service_role needed for the member path.
 *   • For admin previewing a non-member slug, we use service_role so the
 *     watchlist isn't empty. Admin is already established earlier in the
 *     dispatch matrix; this is the same bypass posture as Thread 3.
 *   • Shared notes are fetched the same way: RLS-scoped for the client
 *     (via `bill_notes_read_shared_by_client` from the Thread 4 migration),
 *     service_role for admin owner-view.
 */

export const dynamic = 'force-dynamic'

// Score tier thresholds — match ScoreBadge / generate-pdf.js so the
// portal speaks the same vocabulary as the rest of the app.
const TIER_HIGH = 75
const TIER_MODERATE = 60
const TIER_LOW = 45

// Stage labels — index = bills.stage. Mirrors STAGE_SHORT in app/lib/stages.js
// but using the long form clients see (no internal acronyms like "Out of Cmte").
const STAGE_LABEL = [
  '',
  'Introduced',
  'In Committee',
  'Passed Committee',
  'Passed Floor',
  'Conference',
  'Signed into Law',
]

function tierLabel(score) {
  if (score >= TIER_HIGH) return 'HIGH'
  if (score >= TIER_MODERATE) return 'MODERATE'
  if (score >= TIER_LOW) return 'LOW'
  return 'VERY LOW'
}

function tierColor(score) {
  if (score >= TIER_HIGH) return SHOREPINE.forestMid
  if (score >= TIER_MODERATE) return SHOREPINE.forest
  if (score >= TIER_LOW) return SHOREPINE.brass
  return SHOREPINE.slate
}

function formatStageLine(bill) {
  const cl = (bill?.confidence_label || '').toUpperCase()
  const chamber = bill?.chamber || 'House'
  if (cl === 'LAW') return 'Signed into law'
  if (cl === 'PASSED_CHAMBER') return `Passed ${chamber} — carries to next session`
  if (cl === 'DEAD') return 'Did not advance — session ended'
  const s = bill?.stage || 1
  if (s >= 6) return 'Signed into law'
  if (s >= 4) return `Passed ${chamber} floor`
  if (s >= 3) return bill?.committee_name ? `Passed ${bill.committee_name}` : 'Passed committee'
  return STAGE_LABEL[s] || 'Introduced'
}

export default async function ClientPortalPage({ params }) {
  const { slug } = await params

  // ─── Auth gate ────────────────────────────────────────────────────────
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

  // ─── Resolve client (member path via RLS, admin path via service_role) ─
  const { data: memberships } = await supabase
    .from('client_users')
    .select('client_id, role, clients(id, slug, name, status)')
    .order('invited_at', { ascending: true })

  const matched = (memberships || []).find(m => m.clients?.slug === slug)
  let client = matched?.clients || null

  // Admin owner-view bypass
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

  if (!client) {
    if (!viewerIsAdmin) {
      const firstOther = (memberships || []).find(m => m.clients?.slug)
      if (firstOther?.clients?.slug) redirect(`/c/${firstOther.clients.slug}`)
      redirect('/login')
    }
    notFound()
  }

  const adminOwnerView = viewerIsAdmin

  // ─── Load assigned watchlist + shared note counts ─────────────────────
  // For the admin previewing a non-member slug, RLS would hide both the
  // tracked_bills rows and the shared notes. Use service_role then.
  // Otherwise the authed `supabase` client is RLS-scoped naturally.
  const usingAdminBypass =
    viewerIsAdmin && !memberships?.some(m => m.clients?.id === client.id)
  let dataClient = supabase
  if (usingAdminBypass) {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (serviceKey && supabaseUrl) {
      dataClient = createClient(supabaseUrl, serviceKey)
    }
  }

  const { data: trackedRows } = await dataClient
    .from('tracked_bills')
    .select(`
      bill_id, tag, added_at,
      bills (
        bill_id, bill_number, title, final_score,
        stage, chamber, category, committee_name,
        session, confidence_label, has_public_hearing,
        committee_passed, stalled
      )
    `)
    .eq('client_id', client.id)
    .order('added_at', { ascending: false })

  const bills = (trackedRows || []).filter(t => t.bills)

  // Shared note counts per bill (display only — full notes load on the
  // bill detail page). Single round trip.
  let sharedNoteCount = {}
  if (bills.length) {
    const billIds = bills.map(b => b.bill_id)
    const { data: notesData } = await dataClient
      .from('bill_notes')
      .select('bill_id')
      .in('bill_id', billIds)
      .eq('visibility', 'shared')
    if (notesData) {
      sharedNoteCount = notesData.reduce((acc, n) => {
        acc[n.bill_id] = (acc[n.bill_id] || 0) + 1
        return acc
      }, {})
    }
  }

  // Portfolio counters for the header strip.
  const lawCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'LAW').length
  const carryCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'PASSED_CHAMBER').length
  const deadCount = bills.filter(b => (b.bills?.confidence_label || '').toUpperCase() === 'DEAD').length
  const activeCount = bills.length - lawCount - carryCount - deadCount

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
      <section
        style={{
          maxWidth: 720,
          margin: '0 auto',
          background: SHOREPINE.parchment,
          border: `1px solid ${SHOREPINE.parchmentDeep}`,
          borderRadius: 12,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        {/* ── Forest header ─────────────────────────────────────────── */}
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
          <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
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
            {adminOwnerView && (
              <Link
                href={`/admin/clients/${client.id}`}
                role="link"
                aria-label="Admin preview — back to admin client detail"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 12px',
                  borderRadius: 20,
                  border: `1px solid ${SHOREPINE.brass}`,
                  background: 'rgba(184, 151, 90, 0.22)',
                  color: SHOREPINE.parchment,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  fontFamily: FONT_BODY,
                  whiteSpace: 'nowrap',
                  textDecoration: 'none',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: SHOREPINE.brass,
                    boxShadow: '0 0 8px rgba(184, 151, 90, 0.7)',
                  }}
                />
                Admin preview
              </Link>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {bills.length > 0 && (
              <DownloadBriefingButton clientId={client.id} clientName={client.name} />
            )}
            <SignOutButton />
          </div>
        </header>

        {/* ── Body ─────────────────────────────────────────────────── */}
        <div style={{ padding: '24px 22px 28px' }}>
          {/* Portfolio counters strip */}
          {bills.length > 0 && (
            <div
              role="group"
              aria-label="Portfolio summary"
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 18,
                paddingBottom: 16,
                borderBottom: `1px solid ${SHOREPINE.parchmentDeep}`,
                marginBottom: 18,
              }}
            >
              {[
                { label: 'Tracked', value: bills.length, tone: 'forest' },
                { label: 'Active', value: activeCount, tone: 'brass' },
                { label: 'Signed', value: lawCount, tone: 'forestMid' },
                { label: 'Carried', value: carryCount, tone: 'brass' },
                { label: 'Did not advance', value: deadCount, tone: 'slate' },
              ].map(({ label, value, tone }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span
                    style={{
                      fontFamily: FONT_DISPLAY,
                      fontSize: 22,
                      fontWeight: 600,
                      color: SHOREPINE[tone] || SHOREPINE.forest,
                      lineHeight: 1,
                    }}
                  >
                    {value}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: '0.1em',
                      textTransform: 'uppercase',
                      color: SHOREPINE.slate,
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Bill cards */}
          {bills.length === 0 ? (
            <div
              style={{
                padding: '36px 12px',
                textAlign: 'center',
                color: SHOREPINE.slate,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 20,
                  fontWeight: 600,
                  color: SHOREPINE.forest,
                  marginBottom: 8,
                }}
              >
                Your tracked legislation will appear here.
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>
                No bills have been assigned to {client.name} yet. As soon as
                the first one is added, it will show up on this page with the
                latest score and any notes published for you.
              </div>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {bills.map(({ bill_id, bills: bill, tag }) => {
                const score = bill?.final_score || 0
                const cl = (bill?.confidence_label || '').toUpperCase()
                const accent =
                  cl === 'LAW' ? SHOREPINE.forestMid
                    : cl === 'PASSED_CHAMBER' ? SHOREPINE.brass
                    : cl === 'DEAD' ? SHOREPINE.slate
                    : tierColor(score)
                const noteN = sharedNoteCount[bill_id] || 0
                const billLabel = (bill?.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill?.bill_number

                return (
                  <li key={bill_id}>
                    <Link
                      href={`/c/${client.slug}/bill/${bill_id}`}
                      style={{
                        display: 'block',
                        padding: '14px 16px',
                        background: SHOREPINE.parchmentDeep + '55', // soft tint
                        border: `1px solid ${SHOREPINE.parchmentDeep}`,
                        borderLeft: `4px solid ${accent}`,
                        borderRadius: 8,
                        textDecoration: 'none',
                        color: 'inherit',
                        transition: 'background 0.15s, border-color 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div
                          aria-hidden="true"
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            minWidth: 52,
                          }}
                        >
                          <div
                            style={{
                              fontFamily: FONT_DISPLAY,
                              fontSize: 26,
                              fontWeight: 700,
                              lineHeight: 1,
                              color: accent,
                            }}
                          >
                            {score}
                          </div>
                          <div
                            style={{
                              fontSize: 8,
                              letterSpacing: '0.12em',
                              textTransform: 'uppercase',
                              color: SHOREPINE.slate,
                              marginTop: 4,
                              fontWeight: 600,
                            }}
                          >
                            {tierLabel(score)}
                          </div>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 8,
                              marginBottom: 4,
                            }}
                          >
                            <span
                              style={{
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                fontSize: 12,
                                fontWeight: 600,
                                color: SHOREPINE.forest,
                                letterSpacing: '0.02em',
                              }}
                            >
                              {billLabel}
                            </span>
                            {bill?.category && (
                              <span style={{ fontSize: 11, color: SHOREPINE.slate }}>
                                · {bill.category}
                              </span>
                            )}
                            {tag && (
                              <span
                                style={{
                                  fontSize: 10,
                                  fontWeight: 600,
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.06em',
                                  color: SHOREPINE.brass,
                                  background: 'rgba(184, 151, 90, 0.12)',
                                  border: `1px solid ${SHOREPINE.brass}55`,
                                  padding: '1px 8px',
                                  borderRadius: 10,
                                }}
                              >
                                {tag}
                              </span>
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 14,
                              fontWeight: 500,
                              color: SHOREPINE.ink,
                              lineHeight: 1.35,
                              marginBottom: 6,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {bill?.title || bill?.committee_name || `Bill ${bill?.bill_number}`}
                          </div>
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              flexWrap: 'wrap',
                              gap: 10,
                              fontSize: 11,
                              color: SHOREPINE.slate,
                            }}
                          >
                            <span>{formatStageLine(bill)}</span>
                            {bill?.has_public_hearing && (
                              <span style={{ color: SHOREPINE.forestMid, fontWeight: 600 }}>
                                · Hearing scheduled
                              </span>
                            )}
                            {noteN > 0 && (
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  color: SHOREPINE.brass,
                                  fontWeight: 600,
                                }}
                              >
                                <svg
                                  width="11" height="11" viewBox="0 0 24 24"
                                  fill="none" stroke="currentColor" strokeWidth="2"
                                  strokeLinecap="round" strokeLinejoin="round"
                                  aria-hidden="true"
                                >
                                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                                </svg>
                                {noteN} {noteN === 1 ? 'note' : 'notes'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}

          {/* Brass divider */}
          <div
            style={{
              height: 1,
              background: SHOREPINE.brass,
              opacity: 0.4,
              margin: '24px 0 16px',
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
                marginBottom: 16,
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

        </div>
      </section>
    </div>
  )
}
