import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isAdmin } from '../../../lib/admin'
import TopHamburger from '../../components/TopHamburger'

/**
 * /admin/waitlist — Brand P2b
 *
 * Server component. Gated to the authenticated admin user ID only.
 * Reads via service_role (UPDATE/SELECT blocked for anon on public.waitlist).
 *
 * Gate is now centralized in app/lib/admin.js (Thread 2, 2026-04-23) —
 * reuse isAdmin() instead of copying the UID array per page.
 */

export const dynamic = 'force-dynamic'

export default async function AdminWaitlistPage({ searchParams }) {
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

  // ── Load waitlist via service_role ──────────────────
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  const sp = (await searchParams) ?? {}
  const filter = sp.filter === 'confirmed' ? 'confirmed' : sp.filter === 'pending' ? 'pending' : 'all'

  let query = admin
    .from('waitlist')
    .select('id, email, source, created_at, confirmed_at, converted_at, unsubscribed_at')
    .order('created_at', { ascending: false })
    .limit(500)

  if (filter === 'confirmed') query = query.not('confirmed_at', 'is', null)
  else if (filter === 'pending') query = query.is('confirmed_at', null)

  const { data: rows, error } = await query

  const { count: totalAll } = await admin.from('waitlist').select('id', { count: 'exact', head: true })
  const { count: totalConfirmed } = await admin.from('waitlist').select('id', { count: 'exact', head: true }).not('confirmed_at', 'is', null)
  const totalPending = (totalAll ?? 0) - (totalConfirmed ?? 0)

  if (error) {
    return (
      <div style={{ padding: 32, color: 'var(--text-primary)' }}>
        <h1>Waitlist admin</h1>
        <p style={{ color: 'var(--danger)' }}>Error loading waitlist: {error.message}</p>
      </div>
    )
  }

  const fmtDate = (s) => s ? new Date(s).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  }) : '\u2014'

  // ── CSV export link (builds on the fly) ─────────────
  const csvHeader = 'email,source,created_at,confirmed_at,converted_at\n'
  const csvBody = (rows || []).map(r => [
    r.email,
    r.source || '',
    r.created_at || '',
    r.confirmed_at || '',
    r.converted_at || '',
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')
  const csvDataUrl = `data:text/csv;charset=utf-8,${encodeURIComponent(csvHeader + csvBody)}`

  const tabStyle = (active) => ({
    padding: '8px 14px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: active ? 'var(--gold, #b8975a)' : 'var(--bg-card)',
    color: active ? '#0e1014' : 'var(--text-primary)',
    textDecoration: 'none',
    fontSize: 13,
    fontWeight: 600,
  })

  return (
    <div style={{ paddingBottom: 100, color: 'var(--text-primary)', fontFamily: 'var(--font-body)' }}>
      <TopHamburger />

      {/* Sticky page-header bar (Thread 64, 2026-05-03). */}
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
        }}>Waitlist admin</div>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10, color: 'var(--text-faint)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
          marginTop: 4, fontWeight: 600,
        }}>Admin</div>
      </div>

      <div style={{ padding: '20px 24px', maxWidth: 1100, margin: '0 auto' }}>
      <p style={{ margin: '0 0 24px', color: 'var(--text-muted)', fontSize: 14 }}>
        Pre-launch interest list. Public signup opens August 2027.
      </p>

      {/* Counts */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <StatCard label="Total" value={totalAll ?? 0} />
        <StatCard label="Confirmed" value={totalConfirmed ?? 0} tone="brass" />
        <StatCard label="Pending" value={totalPending ?? 0} tone="muted" />
      </div>

      {/* Filter tabs + CSV */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <a href="/app/admin/waitlist?filter=all" style={tabStyle(filter === 'all')}>All</a>
        <a href="/app/admin/waitlist?filter=confirmed" style={tabStyle(filter === 'confirmed')}>Confirmed</a>
        <a href="/app/admin/waitlist?filter=pending" style={tabStyle(filter === 'pending')}>Pending</a>
        <div style={{ flex: 1 }} />
        <a href={csvDataUrl} download={`waitlist-${new Date().toISOString().slice(0, 10)}.csv`} style={tabStyle(false)}>
          Download CSV
        </a>
      </div>

      {/* Table */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--bg-card)', textAlign: 'left' }}>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Email</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Source</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Joined</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Confirmed</th>
              <th style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>Converted</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).length === 0 ? (
              <tr>
                <td colSpan={5} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No entries.
                </td>
              </tr>
            ) : rows.map(r => (
              <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{r.email}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{r.source || '\u2014'}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{fmtDate(r.created_at)}</td>
                <td style={{ padding: '10px 12px' }}>
                  {r.confirmed_at ? (
                    <span style={{ color: 'var(--gold-light, #d4b07a)' }}>{fmtDate(r.confirmed_at)}</span>
                  ) : (
                    <span style={{ color: 'var(--text-faint)' }}>pending</span>
                  )}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{fmtDate(r.converted_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(rows?.length ?? 0) === 500 && (
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--text-faint)' }}>
          Showing first 500 rows. Filter or export CSV for full set.
        </p>
      )}
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
