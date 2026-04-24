import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { isAdmin } from '../../../../lib/admin'
import InvitePanel from './InvitePanel'
import AssignBillsPanel from './AssignBillsPanel'

/**
 * /admin/clients/[id] — Thread 2 PR (a) shell + PR (b) action panels
 *
 * Server component. Loads client row + member list + assigned bills via
 * service_role (bypasses RLS intentionally for the admin surface).
 *
 * Action panels (InvitePanel, AssignBillsPanel) are PR (b) client
 * components that POST to /api/admin/invite and /api/admin/assign-bills.
 * Ships empty-state friendly in case PR (a) lands before PR (b).
 */

export const dynamic = 'force-dynamic'

export default async function ClientDetailPage({ params }) {
  const { id } = await params

  // ── Auth gate ────────────────────────────────────────
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
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!isAdmin(user)) redirect('/')

  // ── Load client + members + assigned bills via service_role ──
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id, slug, name, status, created_at, created_by')
    .eq('id', id)
    .single()

  if (clientErr || !client) notFound()

  // Members — join to auth.users for email lookup via admin API. auth.admin
  // returns up to 50 users/page; with 1–3 users per client (PHASE_13 §1),
  // a single listUsers() call with a filter is overkill — we look them up
  // one at a time since we already have the user_ids.
  const { data: memberships, error: memErr } = await admin
    .from('client_users')
    .select('user_id, role, invited_at, accepted_at')
    .eq('client_id', id)
    .order('invited_at', { ascending: true })

  const members = []
  for (const m of (memberships || [])) {
    let email = null
    try {
      const { data } = await admin.auth.admin.getUserById(m.user_id)
      email = data?.user?.email ?? null
    } catch (_) {
      email = null
    }
    members.push({ ...m, email })
  }

  // Assigned bills — join to bills for display. Colin's ~11 tracked bills
  // make this cheap; if a client ever grows past a few dozen, paginate.
  const { data: assignedRaw } = await admin
    .from('tracked_bills')
    .select(`
      bill_id, tag, added_at,
      bills ( bill_id, bill_number, title, stage, final_score, session )
    `)
    .eq('client_id', id)
    .order('added_at', { ascending: false })

  const assigned = (assignedRaw || []).filter(r => r.bills)

  const fmtDate = (s) => s ? new Date(s).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }) : '\u2014'

  const statusPillStyle = (status) => {
    const tone = status === 'active' ? 'var(--gold, #b8975a)'
      : status === 'paused' ? 'var(--text-muted)'
      : 'var(--text-faint)'
    return {
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 999,
      border: `1px solid ${tone}`,
      color: tone,
      fontSize: 11,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
    }
  }

  return (
    <div style={{ padding: '32px 24px', maxWidth: 1100, margin: '0 auto', color: 'var(--text-primary)' }}>
      {/* Breadcrumb */}
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--text-muted)' }}>
        <Link href="/admin/clients" style={{ color: 'var(--text-muted)', textDecoration: 'none' }}>
          &larr; Client admin
        </Link>
      </p>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{client.name}</h1>
        <span style={statusPillStyle(client.status)}>{client.status}</span>
      </div>
      <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 13 }}>
        Portal URL: <code>/c/{client.slug}</code> &middot; Created {fmtDate(client.created_at)}
      </p>

      {/* ── Members ────────────────────────────────────── */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, letterSpacing: '0.02em' }}>
          Members <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({members.length})</span>
        </h2>

        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Email</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Role</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Invited</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Accepted</th>
              </tr>
            </thead>
            <tbody>
              {members.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No members yet. Invite one below.
                  </td>
                </tr>
              ) : members.map(m => (
                <tr key={m.user_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>
                    {m.email || <span style={{ color: 'var(--text-faint)' }}>&mdash;</span>}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{m.role}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{fmtDate(m.invited_at)}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                    {m.accepted_at
                      ? fmtDate(m.accepted_at)
                      : <span style={{ color: 'var(--text-faint)' }}>pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          background: 'var(--bg-card)',
        }}>
          <InvitePanel clientId={client.id} clientSlug={client.slug} />
        </div>
      </section>

      {/* ── Assigned bills ─────────────────────────────── */}
      <section>
        <h2 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 700, letterSpacing: '0.02em' }}>
          Assigned bills <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>({assigned.length})</span>
        </h2>

        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-card)', textAlign: 'left' }}>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Bill</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Stage</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Tag</th>
                <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Assigned</th>
              </tr>
            </thead>
            <tbody>
              {assigned.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No bills assigned yet. Use the panel below.
                  </td>
                </tr>
              ) : assigned.map(row => (
                <tr key={row.bill_id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 12px' }}>
                    <Link href={`/bill/${row.bill_id}`} style={{ color: 'var(--text-primary)', textDecoration: 'none' }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
                        {row.bills.bill_number || row.bill_id}
                      </span>
                      {row.bills.title ? (
                        <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>
                          {row.bills.title.length > 80 ? row.bills.title.slice(0, 80) + '\u2026' : row.bills.title}
                        </span>
                      ) : null}
                    </Link>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{row.bills.stage || '\u2014'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{row.tag || '\u2014'}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{fmtDate(row.added_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '16px 20px',
          background: 'var(--bg-card)',
        }}>
          <AssignBillsPanel clientId={client.id} />
        </div>
      </section>
    </div>
  )
}
