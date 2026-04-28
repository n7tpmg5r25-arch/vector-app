import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import BackChip from '../../../../components/BackChip'
import { isAdmin } from '../../../../../lib/admin'
import { SHOREPINE, FONT_DISPLAY, FONT_BODY } from '../../../../../lib/shorepine'
import { getCurrentSession, formatSessionDate, isPostBienniumClose, getCurrentBiennium, getNextBiennium } from '../../../../../lib/session-config'
import { translateAmendmentEvent, WSL_AMENDMENT_REFERENCE_URL } from '../../../../../lib/wsl-amendment-codes'
import SignOutButton from '../../SignOutButton'

/**
 * /c/[slug]/bill/[id] — Read-only client bill briefing (Thread 4)
 *
 * Server component. Lean briefing surface per the Thread 4 spec direction
 * (Phase 13 §4 permission matrix: client tier is READ-ONLY in v1):
 *   • Identity — bill number, category, session, title, sponsor
 *   • Score — final_score + tier label, with the plain-English trajectory
 *     reading the same calibration cohort the rest of the app uses
 *   • Stage line — where the bill is in the legislative process
 *   • AI summary (custom_summary preferred over ai_summary)
 *   • Recent activity — amendments + fiscal note history
 *   • Shared analyst notes — visibility='shared' only, RLS-enforced
 *
 * Intentionally NOT shown (deferred — keeps v1 clean and defensible):
 *   • Sparkline / X-factors signal breakdown / parallel-track widget
 *   • "Add to watchlist" / "Edit note" / tag editor — owner affordances
 *   • Private notes — never reach the client (RLS + app-layer .eq filter)
 *
 * Auth model — same dispatch matrix as /c/[slug]/page.js. The bill must
 * be in the client's tracked_bills (defended at both the app layer here
 * and the RLS policy on bill_notes for note visibility). If a client
 * deep-links to a bill not in their watchlist, we 404 — never leak
 * existence of a bill to a tenant that wasn't given access.
 *
 * Session-config:
 *   • bill.session is the canonical biennium for the bill's leg.wa.gov
 *     deep link. Per G4, the fallback is `getCurrentSession()` (NOT a
 *     hardcoded '2025-2026' literal).
 */

export const dynamic = 'force-dynamic'

const TIER_HIGH = 75
const TIER_MODERATE = 60
const TIER_LOW = 45

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

function accentForBill(bill) {
  const cl = (bill?.confidence_label || '').toUpperCase()
  if (cl === 'LAW') return SHOREPINE.forestMid
  if (cl === 'PASSED_CHAMBER') return SHOREPINE.brass
  if (cl === 'DEAD') return SHOREPINE.slate
  return tierColor(bill?.final_score || 0)
}

function formatStageLine(bill) {
  const cl = (bill?.confidence_label || '').toUpperCase()
  const chamber = bill?.chamber || 'House'
  if (cl === 'LAW') return 'Signed into law'
  if (cl === 'PASSED_CHAMBER') {
    // Thread 18.2: post-biennium-close, "carries to next session" is wrong —
    // bills that didn't become law before the biennium ended must be
    // reintroduced. Branch on isPostBienniumClose() so the brief reads true.
    if (isPostBienniumClose()) {
      const cur = getCurrentBiennium()
      const nxt = getNextBiennium()
      const hasRealNext = nxt && cur && nxt.session !== cur.session
      return `Passed ${chamber} — must be reintroduced${hasRealNext ? ` in ${nxt.session}` : ' next session'}`
    }
    return `Passed ${chamber} — carries to next session`
  }
  if (cl === 'DEAD') return 'Did not advance — session ended'
  const s = bill?.stage || 1
  if (s >= 6) return 'Signed into law'
  if (s >= 4) return `Passed ${chamber} floor`
  if (s >= 3) return bill?.committee_name ? `Passed ${bill.committee_name}` : 'Passed committee'
  if (s >= 2) return bill?.committee_name ? `In ${bill.committee_name}` : 'In committee'
  return `Introduced in ${chamber}`
}

// Strip markdown headers + collapse whitespace for clean display.
function cleanSummary(raw) {
  if (!raw) return ''
  return String(raw)
    .split('\n')
    .filter(line => !line.trim().startsWith('#'))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export default async function ClientBillBriefPage({ params }) {
  const { slug, id: billId } = await params

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

  // ─── Resolve client + verify slug membership (same dispatch as /c/[slug]) ─
  const { data: memberships } = await supabase
    .from('client_users')
    .select('client_id, clients(id, slug, name, status)')

  const matched = (memberships || []).find(m => m.clients?.slug === slug)
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

  if (!client) {
    if (!viewerIsAdmin) {
      const firstOther = (memberships || []).find(m => m.clients?.slug)
      if (firstOther?.clients?.slug) redirect(`/c/${firstOther.clients.slug}`)
      redirect('/login')
    }
    notFound()
  }

  const adminOwnerView = viewerIsAdmin
  const usingAdminBypass =
    viewerIsAdmin && !memberships?.some(m => m.clients?.id === client.id)

  // For admin previewing a non-member slug, RLS would hide the data.
  // Otherwise the authed `supabase` client is naturally RLS-scoped.
  let dataClient = supabase
  if (usingAdminBypass) {
    const serviceKey = process.env.SUPABASE_SERVICE_KEY
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (serviceKey && supabaseUrl) {
      dataClient = createClient(supabaseUrl, serviceKey)
    }
  }

  // ─── Verify bill is in the client's watchlist ────────────────────────
  // Hard fence. If the bill isn't assigned to this client, return 404 even
  // for admins viewing the slug — that way an admin testing a deep-link
  // surfaces the missing assignment instead of seeing data the client
  // wouldn't have.
  const { data: trackedRow } = await dataClient
    .from('tracked_bills')
    .select('bill_id, tag, added_at')
    .eq('client_id', client.id)
    .eq('bill_id', billId)
    .maybeSingle()

  if (!trackedRow) notFound()

  // ─── Bill + activity + shared notes (parallel) ────────────────────────
  const [billResp, latestSnapResp, amendResp, fiscalResp, notesResp] = await Promise.all([
    dataClient
      .from('bills')
      .select(`
        bill_id, bill_number, title, final_score,
        stage, chamber, category, committee_name,
        prime_sponsor, prime_party, bipartisan,
        session, companion_bill, confidence_label,
        ai_summary, custom_summary,
        has_public_hearing, hearing_date,
        bipartisan_index, chair_alignment,
        calendar_pressure, calendar_pressure_next_meeting
      `)
      .eq('bill_id', billId)
      .maybeSingle(),
    dataClient
      .from('trajectory_snapshots')
      .select('snapshot_date, score, stage')
      .eq('bill_id', billId)
      .order('snapshot_date', { ascending: false })
      .limit(1),
    dataClient
      .from('amendments')
      // Thread 15.7 (mirror of Thread 14.1): pull sponsor + description +
      // floor_action so translateAmendmentEvent() can compose plain English
      // ("Walsh House amendment — Adopted") instead of leaking raw WSL codes
      // ("2192-S AMH LOW H3553.1") into the client briefing.
      .select('bill_id, amendment_number, sponsor, description, adopted, floor_action, floor_action_date')
      .eq('bill_id', billId)
      .order('floor_action_date', { ascending: false, nullsFirst: false })
      .limit(20),
    dataClient
      .from('fiscal_note_history')
      .select('bill_id, detected_date, new_size, note')
      .eq('bill_id', billId)
      .order('detected_date', { ascending: false })
      .limit(10),
    // Shared notes — RLS layer (`bill_notes_read_shared_by_client`) is the
    // hard fence; the .eq below makes the intent explicit and ensures admin
    // owner-view sees the same set the client would.
    dataClient
      .from('bill_notes')
      .select('id, body, created_at, updated_at, visibility')
      .eq('bill_id', billId)
      .eq('visibility', 'shared')
      .order('created_at', { ascending: false }),
  ])

  const bill = billResp?.data
  if (!bill) notFound()

  const latestSnap = (latestSnapResp?.data || [])[0] || null
  const amendments = amendResp?.data || []
  const fiscalHistory = fiscalResp?.data || []
  const sharedNotes = notesResp?.data || []

  const score = bill.final_score || 0
  const accent = accentForBill(bill)
  const billLabel = (bill.chamber === 'House' ? 'HB' : 'SB') + ' ' + bill.bill_number
  const summary = cleanSummary(bill.custom_summary || bill.ai_summary)
  const summaryEdited = !!bill.custom_summary
  // G4 — fallback to current session, never to a hardcoded '2025-2026'.
  const sessionForLink = bill.session || getCurrentSession()
  const legUrl = `https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${sessionForLink.split('-')[0]}`

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
        {/* ── Forest header (mirrors portal shell) ──────────────────── */}
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
                Vector | WA · Bill briefing
              </div>
            </div>
            {adminOwnerView && (
              <span
                role="note"
                aria-label="Admin preview"
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
              </span>
            )}
          </div>
          <SignOutButton />
        </header>

        {/* ── Breadcrumb ───────────────────────────────────────────── */}
        <nav
          aria-label="Breadcrumb"
          style={{
            background: SHOREPINE.parchmentDeep + '88',
            padding: '10px 22px',
            borderBottom: `1px solid ${SHOREPINE.parchmentDeep}`,
            fontSize: 12,
            color: SHOREPINE.slate,
          }}
        >
          <BackChip
            label="Back"
            fallbackPath={`/c/${client.slug}`}
            style={{ color: SHOREPINE.forest, fontWeight: 600 }}
          />
        </nav>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div style={{ padding: '24px 22px 28px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Identity + score row */}
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                minWidth: 78, padding: '10px 12px',
                background: SHOREPINE.parchmentDeep + '55',
                border: `1px solid ${SHOREPINE.parchmentDeep}`,
                borderLeft: `4px solid ${accent}`,
                borderRadius: 8,
              }}
            >
              <div
                style={{
                  fontFamily: FONT_DISPLAY, fontSize: 36, fontWeight: 700,
                  lineHeight: 1, color: accent,
                }}
              >
                {score}
              </div>
              <div
                style={{
                  fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: SHOREPINE.slate, marginTop: 4, fontWeight: 600,
                }}
              >
                {tierLabel(score)}
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8,
                  fontSize: 12, color: SHOREPINE.slate, marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontWeight: 600, color: SHOREPINE.forest, fontSize: 13,
                    letterSpacing: '0.02em',
                  }}
                >
                  {billLabel}
                </span>
                {bill.category && <span>· {bill.category}</span>}
                <span>· {bill.session || sessionForLink}</span>
                {trackedRow.tag && (
                  <span
                    style={{
                      fontSize: 10, fontWeight: 600,
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      color: SHOREPINE.brass,
                      background: 'rgba(184, 151, 90, 0.12)',
                      border: `1px solid ${SHOREPINE.brass}55`,
                      padding: '1px 8px', borderRadius: 10,
                    }}
                  >
                    {trackedRow.tag}
                  </span>
                )}
              </div>
              <h1
                style={{
                  fontFamily: FONT_DISPLAY, fontSize: 22, fontWeight: 600,
                  color: SHOREPINE.ink, lineHeight: 1.25, margin: 0,
                }}
              >
                {bill.title || bill.committee_name || `Bill ${bill.bill_number}`}
              </h1>
              <div
                style={{
                  marginTop: 8, fontSize: 13, color: SHOREPINE.slate,
                  display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
                }}
              >
                <span style={{ fontWeight: 600, color: SHOREPINE.forest }}>
                  {formatStageLine(bill)}
                </span>
                {bill.has_public_hearing && bill.hearing_date && (
                  <span>
                    · Hearing {formatSessionDate(bill.hearing_date)}
                  </span>
                )}
                {bill.prime_sponsor && (
                  <span>
                    · Sponsor {bill.prime_sponsor}
                    {bill.prime_party ? ` (${bill.prime_party})` : ''}
                  </span>
                )}
                <a
                  href={legUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    color: SHOREPINE.forest, textDecoration: 'none', fontWeight: 600,
                  }}
                >
                  leg.wa.gov ↗
                </a>
              </div>
            </div>
          </div>

          {/* Summary */}
          {summary && (
            <div>
              <div
                style={{
                  fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
                  color: SHOREPINE.brass, fontWeight: 700, marginBottom: 8,
                }}
              >
                {summaryEdited ? 'AI-generated · edited by analyst' : 'AI-generated summary'}
              </div>
              <p
                style={{
                  fontSize: 14, lineHeight: 1.6, color: SHOREPINE.ink,
                  margin: 0,
                }}
              >
                {summary}
              </p>
            </div>
          )}

          {/* Shared analyst notes */}
          <div>
            <div
              style={{
                fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
                color: SHOREPINE.forest, marginBottom: 10,
                paddingBottom: 6,
                borderBottom: `1px solid ${SHOREPINE.brass}55`,
              }}
            >
              Analyst notes
            </div>
            {sharedNotes.length === 0 ? (
              <p
                style={{
                  fontSize: 13, color: SHOREPINE.slate, fontStyle: 'italic',
                  margin: 0,
                }}
              >
                No shared notes for this bill yet.
              </p>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sharedNotes.map(n => (
                  <li
                    key={n.id}
                    style={{
                      padding: '12px 14px',
                      background: SHOREPINE.parchmentDeep + '55',
                      borderLeft: `3px solid ${SHOREPINE.brass}`,
                      borderRadius: 6,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 11, color: SHOREPINE.slate,
                        marginBottom: 6, fontStyle: 'italic',
                      }}
                    >
                      {new Date(n.created_at).toLocaleDateString('en-US', {
                        month: 'short', day: 'numeric', year: 'numeric',
                      })}
                      {n.updated_at !== n.created_at ? ' (edited)' : ''}
                    </div>
                    <div
                      style={{
                        fontSize: 14, lineHeight: 1.55, color: SHOREPINE.ink,
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {n.body}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recent activity (descriptive — amendments + fiscal note moves) */}
          {(amendments.length > 0 || fiscalHistory.length > 0) && (
            <div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY, fontSize: 16, fontWeight: 600,
                  color: SHOREPINE.forest, marginBottom: 10,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${SHOREPINE.brass}55`,
                }}
              >
                Recent activity
              </div>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {amendments.slice(0, 6).map(a => {
                  // Thread 15.7 (mirror of Thread 14.1): translator turns the
                  // raw WSL code into plain English. Fallback path renders the
                  // raw code with a small "?" link to leg.wa.gov when neither
                  // sponsor nor chamber can be derived. Read-only display only
                  // (G5 frozen — no scoreBill/extractFeatures touch).
                  const { label: amLabel, fallback: amFallback } = translateAmendmentEvent({
                    amendmentNumber: a.amendment_number,
                    sponsor: a.sponsor,
                    description: a.description,
                    adopted: a.adopted,
                    floorAction: a.floor_action,
                  })
                  // Translator only injects a disposition suffix when adopted
                  // OR a floor_action exists. If neither is set, preserve the
                  // original "filed" copy so undated rows still read naturally.
                  const noDisposition = !a.adopted && !a.floor_action
                  return (
                    <li
                      key={`amend-${a.amendment_number}-${a.floor_action_date || 'pending'}`}
                      style={{ fontSize: 13, color: SHOREPINE.ink, lineHeight: 1.5 }}
                    >
                      <span style={{ color: SHOREPINE.brass, fontWeight: 600, marginRight: 6 }}>
                        {amLabel}
                      </span>
                      {amFallback && (
                        <a
                          href={WSL_AMENDMENT_REFERENCE_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={`Raw WA Legislature amendment code: ${a.amendment_number}\nClick to open the WA Legislature bill summary lookup.`}
                          style={{
                            marginLeft: 4,
                            marginRight: 6,
                            fontSize: 10,
                            color: SHOREPINE.slate,
                            border: `1px solid ${SHOREPINE.brass}55`,
                            borderRadius: '50%',
                            width: 14,
                            height: 14,
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            textDecoration: 'none',
                            verticalAlign: 'middle',
                            cursor: 'help',
                          }}
                        >?</a>
                      )}
                      {noDisposition && 'filed'}
                      {a.floor_action_date && (
                        <span style={{ color: SHOREPINE.slate }}>
                          {' '}· {formatSessionDate(a.floor_action_date)}
                        </span>
                      )}
                    </li>
                  )
                })}
                {fiscalHistory.slice(0, 4).map(f => (
                  <li
                    key={`fiscal-${f.detected_date}-${f.new_size}`}
                    style={{ fontSize: 13, color: SHOREPINE.ink, lineHeight: 1.5 }}
                  >
                    <span style={{ color: SHOREPINE.brass, fontWeight: 600, marginRight: 6 }}>
                      Fiscal note
                    </span>
                    {f.new_size || 'updated'}
                    {f.detected_date && (
                      <span style={{ color: SHOREPINE.slate }}>
                        {' '}· {formatSessionDate(f.detected_date)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Latest snapshot age — quiet line so the client knows the score is fresh */}
          {latestSnap?.snapshot_date && (
            <p
              style={{
                fontSize: 11, color: SHOREPINE.slate,
                fontStyle: 'italic', margin: 0,
              }}
            >
              Score recalculated {formatSessionDate(latestSnap.snapshot_date)}.
            </p>
          )}

          {/* Brass divider + admin QA + ownership */}
          <div
            style={{
              height: 1,
              background: SHOREPINE.brass,
              opacity: 0.4,
              margin: '4px 0 0',
            }}
          />

          {viewerIsAdmin && (
            <div
              style={{
                fontSize: 12,
                color: SHOREPINE.slate,
                background: SHOREPINE.parchmentDeep,
                border: `1px dashed ${SHOREPINE.brass}`,
                borderRadius: 8,
                padding: '10px 12px',
              }}
            >
              <div style={{ textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                Admin · QA
              </div>
              <div>
                Bill <code>{bill.bill_id}</code> · Client slug <code>{client.slug}</code>
                {' · '}
                <Link
                  href={`/bill/${bill.bill_id}`}
                  style={{ color: SHOREPINE.forest, fontWeight: 600 }}
                >
                  Owner view
                </Link>
              </div>
            </div>
          )}

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
