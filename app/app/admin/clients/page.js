import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { isAdmin } from '../../../lib/admin'
import NewClientForm from './NewClientForm'
import TopHamburger from '../../components/TopHamburger'

/**
 * /admin/clients — Phase 13b, Thread 2 PR (a)
 *
 * Server component. Owner-only list of clients with an inline "New client"
 * form. Each row links to the detail page where invites + bill assignment
 * live (Thread 2 PR b).
 *
 * Why server component (same as /admin/waitlist):
 *   - Reads via service_role so the page renders deterministic data even
 *     if RLS ever flips on the owner accidentally.
 *   - Auth gate runs on the server before any UI flashes.
 *
 * The "New client" form is split into a client component (NewClientForm)
 * because it needs a controlled input + fetch() POST to /api/admin/clients.
 * Everything else stays server-rendered.
 */

export const dynamic = 'force-dynamic'

export default async function AdminClientsPage() {
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

  // ── Load clients + counts via service_role ───────────
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  const { data: clients, error } = await admin
    .from('clients')
    .select('id, slug, name, status, created_at')
    .order('created_at', { ascending: true })

  if (error) {
    return (
      <div style={{ padding: 32, color: 'var(--text-primary)' }}>
        <h1>Team admin</h1>
        <p style={{ color: 'var(--danger)' }}>Error loading teams: {error.message}</p>
      </div>
    )
  }

  // Counts — one query each, fan-in on id. With 3–10 clients total per
  // PHASE_13 §1 scale target, N+1 here is fine; we can batch if the number
  // of clients ever grows past ~20.
  const ids = (clients || []).map(c => c.id)

  const usersByClient = {}
  const billsByClient = {}
  for (const id of ids) {
    const [{ count: uCount }, { count: bCount }] = await Promise.all([
      admin.from('client_users').select('user_id', { count: 'exact', head: true }).eq('client_id', id),
      admin.from('tracked_bills').select('bill_id', { count: 'exact', head: true }).eq('client_id', id),
    ])
    usersByClient[id] = uCount ?? 0
    billsByClient[id] = bCount ?? 0
  }

  const fmtDate = (s) => s ? new Date(s).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
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
    <div style={{ paddingBottom: 100, color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>
      <TopHamburger />

      {/* Sticky page-header bar (Thread 64, 2026-05-03). Mirrors the
          PR #81 about/methodology/install pattern. The 52px top
          padding clears the fixed-position HamburgerButton. */}
      <div style={{
        position: 'sticky',
        top: 0, zIndex: 50,
        background: 'rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)',
        padding: '52px 20px 20px',
      }}>
        <div style={{
          fontFamily: 'var(--font-display)',
          fontSize: 24, fontWeight: 700,
          color: 'var(--teal)',
          textShadow: '0 0 16px rgba(184,151,90,0.2)',
        }}>Team admin</div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginTop: 4, fontWeight: 600,
        }}>Admin</div>
      </div>

      <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 14 }}>
        Create teams, invite their users, assign bills. Phase 13b.
      </p>

      {/* Counts row */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Teams" value={clients?.length ?? 0} />
        <StatCard
          label="Active"
          value={(clients || []).filter(c => c.status === 'active').length}
          tone="brass"
        />
        <StatCard
          label="Total members"
          value={Object.values(usersByClient).reduce((a, b) => a + b, 0)}
          tone="muted"
        />
      </div>

      {/* New client form */}
      <div style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        padding: '16px 20px',
        marginBottom: 24,
        background: 'var(--bg-card)',
      }}>
        <NewClientForm />
      </div>

      {/* Client table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-card)', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Name</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Slug</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Status</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Members</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Bills</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {(clients || []).length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No teams yet. Create one above.
                </td>
              </tr>
            ) : clients.map(c => (
              <tr key={c.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 12px' }}>
                  <Link
                    href={`/admin/clients/${c.id}`}
                    style={{ color: 'var(--text-primary)', textDecoration: 'none', fontWeight: 600 }}
                  >
                    {c.name}
                  </Link>
                </td>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  /c/{c.slug}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={statusPillStyle(c.status)}>{c.status}</span>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{usersByClient[c.id] ?? 0}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{billsByClient[c.id] ?? 0}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{fmtDate(c.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ marginTop: 16, fontSize: 12, color: 'var(--text-faint)' }}>
        Portal shell at <code>/c/[slug]</code> ships in Thread 3. For now, this
        page manages the data model; the tenant-facing UI lands next.
      </p>
      </div>
    </div>
  )
}

function StatCard({ label, value, tone = 'default' }) {
  const color = tone === 'brass' ? 'var(--gold, #b8975a)' : tone === 'muted' ? 'var(--text-muted)' : 'var(--text-primary)'
  return (
    <div style={{
      padding: '12px 18px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
  )
}
