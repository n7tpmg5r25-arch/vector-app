'use client'
/**
 * PublicHome -- anonymous-visitor cockpit (DASH-6, 2026-06-08).
 *
 * Brings the anon path to the same glanceable cockpit registered users see
 * (DASH-1..5), reading the statewide warehouse through the anon browser client
 * (RLS public-read on bills / interim_intelligence / trajectory_snapshots /
 * news_items). Renders only when useViewer() returns !user && publicLayerEnabled
 * and the proxy gate has admitted the request; the page-level gate in
 * app/app/page.js skips loadData() for this path, so PublicHome owns its own
 * statewide fetches.
 *
 * Parity with the registered shell, with three swaps:
 *   1. Hero gauge  -> statewide "% still alive" (not-DEAD / total) over the
 *      statewide tier distribution, in place of the personal portfolio gauge.
 *   2. Movers      -> statewide score movers (the top-trajectory cohort), in
 *      place of the watchlist movers. Momentum counts the same statewide rises.
 *   3. Personal needs-attention card -> a static "track your bills -- free"
 *      prompt.
 * Issue heat and In-the-news are identical to registered (both already
 * statewide); the news card reads the same four newest news_items. Footer ->
 * Search / How it works. Everything stays behind NEXT_PUBLIC_ENABLE_PUBLIC_LAYER
 * (off in prod) -- the page-level gate is the upstream switch.
 *
 * Interim-aware: between sessions (now) scores are frozen, so the movers and
 * momentum instruments render their frozen states and no snapshot diff runs.
 * The gauge then reads the survival share, issue heat reads interim_intelligence,
 * and the news card runs year-round. Brand v1.2: real logo (PublicNav lockup +
 * the prompt mark), Playfair numbers, DM Mono labels, Karla body, brass
 * restrained, functional palette semantic-only. Mobile-only; no media queries.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import PublicNav from './PublicNav'
import ArcGauge from './dashboard/ArcGauge'
import DistributionBar from './dashboard/DistributionBar'
import SessionClock from './dashboard/SessionClock'
import MomentumTile from './dashboard/MomentumTile'
import IssueHeat from './dashboard/IssueHeat'
import MoversChart from './dashboard/MoversChart'
import InTheNews from './dashboard/InTheNews'
import { createBrowserClient } from '../../lib/supabase'
import { isInterimPeriod, getCurrentSession, bienniumShortLabel } from '../../lib/session-config'
import { getSessionClock } from '../../lib/session-clock'

const EYEBROW = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
}

// Statewide movers diff: scan the top-trajectory cohort and look back a couple
// of weeks. Both bounds keep the snapshot read under the PostgREST 1000-row cap
// (<= cohort * window rows) while staying wide enough to be a real statewide read.
const MOVERS_COHORT = 60
const MOVERS_WINDOW_DAYS = 14

export default function PublicHome() {
  const interim = isInterimPeriod()
  const session = getCurrentSession()
  const clock = getSessionClock()

  const [stats, setStats] = useState(null)   // { total, alive, alivePct, tiers }
  const [categories, setCategories] = useState([])
  const [newsItems, setNewsItems] = useState([])
  const [deltas, setDeltas] = useState({})   // bill_id -> signed score change
  const [billsById, setBillsById] = useState({})

  useEffect(() => {
    let cancelled = false
    const supabase = createBrowserClient()

    async function load() {
      // One statewide bill-count helper, reused for the survival rate and each
      // tier bucket. head:true => count only, no rows over the wire.
      const billCount = () => supabase
        .from('bills')
        .select('bill_id', { count: 'exact', head: true })
        .eq('session', session)
        .eq('legislation_type', 'bill')

      const [totalRes, deadRes, highRes, modRes, lowRes, vlowRes, catsRes, newsRes] =
        await Promise.all([
          billCount(),                                               // total
          billCount().eq('confidence_label', 'DEAD'),                // dead -> alive = total - dead
          billCount().gte('final_score', 75),                        // HIGH
          billCount().gte('final_score', 60).lt('final_score', 75),  // MODERATE
          billCount().gte('final_score', 45).lt('final_score', 60),  // LOW
          billCount().lt('final_score', 45),                         // VERY LOW (nulls excluded by <)
          supabase.from('interim_intelligence')
            .select('category, avg_score, total_bills')
            .order('avg_score', { ascending: false })
            .limit(8),
          supabase.from('news_items')
            .select('source, title, snippet, url, published_at, item_type')
            .order('published_at', { ascending: false, nullsFirst: false })
            .limit(4),
        ])
      if (cancelled) return

      const total = totalRes.count || 0
      const dead = deadRes.count || 0
      const alive = Math.max(0, total - dead)
      setStats({
        total, alive,
        alivePct: total > 0 ? Math.round((alive / total) * 100) : 0,
        tiers: {
          high: highRes.count || 0, mod: modRes.count || 0,
          low: lowRes.count || 0, vlow: vlowRes.count || 0,
        },
      })
      setCategories((catsRes.data || []).filter(c => c.category && c.category !== 'Other'))
      setNewsItems(newsRes.data || [])

      // Statewide movers -- off the critical path, in-session only. Scores are
      // frozen during the interim, so MoversChart + MomentumTile render their
      // frozen states and we skip the snapshot diff entirely. In session we scan
      // the top-trajectory cohort (bounded for the 1000-row cap) and diff each
      // bill's two most recent snapshots.
      if (interim) return
      const { data: top } = await supabase
        .from('bills')
        .select('bill_id, bill_number, chamber, final_score')
        .eq('session', session)
        .eq('legislation_type', 'bill')
        .not('final_score', 'is', null)
        .order('final_score', { ascending: false })
        .limit(MOVERS_COHORT)
      if (cancelled || !top || top.length === 0) return

      const byId = {}
      top.forEach(b => { byId[b.bill_id] = b })
      const since = new Date(Date.now() - MOVERS_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
      const { data: snaps } = await supabase
        .from('trajectory_snapshots')
        .select('bill_id, score, snapshot_date')
        .in('bill_id', top.map(b => b.bill_id))
        .gte('snapshot_date', since)
        .order('snapshot_date', { ascending: false })
      if (cancelled || !snaps) return

      const recent = {}
      snaps.forEach(s => {
        if (!recent[s.bill_id]) recent[s.bill_id] = []
        if (recent[s.bill_id].length < 2) recent[s.bill_id].push(s)
      })
      const d = {}
      Object.entries(recent).forEach(([bid, arr]) => {
        if (arr.length >= 2) d[bid] = (arr[0].score || 0) - (arr[1].score || 0)
      })
      setBillsById(byId)
      setDeltas(d)
    }

    load()
    return () => { cancelled = true }
  }, [interim, session])

  const tiers = stats?.tiers || { high: 0, mod: 0, low: 0, vlow: 0 }
  const alivePct = stats?.alivePct ?? 0
  const momentumCount = Object.values(deltas).filter(v => v > 0).length
  const shortLabel = bienniumShortLabel(session)

  return (
    <div style={{ paddingBottom: 40, fontFamily: 'var(--font-body)', minHeight: '100vh' }}>
      <PublicNav />

      <div style={{ padding: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* -- CHROME: next-cutoff chip + session clock (mirrors the registered bar) -- */}
        <div>
          {clock.nextCutoff && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9, whiteSpace: 'nowrap',
                color: clock.nextCutoff.daysLeft <= 7 ? 'var(--danger)' : 'var(--text-mid)',
                background: clock.nextCutoff.daysLeft <= 7 ? 'rgba(196,71,48,0.1)' : 'rgba(184,151,90,0.08)',
                border: `1px solid ${clock.nextCutoff.daysLeft <= 7 ? 'rgba(196,71,48,0.25)' : 'var(--border)'}`,
                borderRadius: 11, padding: '3px 9px',
              }}>
                Cutoff &middot; {clock.nextCutoff.daysLeft}d
              </span>
            </div>
          )}
          <SessionClock clock={clock} />
        </div>

        {/* -- HERO: statewide survival gauge + tier distribution -- */}
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 14,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <ArcGauge
              value={alivePct}
              max={100}
              displayValue={stats ? `${alivePct}%` : '—'}
              subLabel="alive"
              size={104}
              ariaLabel={stats
                ? `${alivePct}% of ${stats.total} bills still alive this session`
                : 'Loading statewide survival rate'}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...EYEBROW, marginBottom: 7 }}>Session pulse &middot; {shortLabel}</div>
              <div style={{ fontSize: 12, color: 'var(--text-mid)', lineHeight: 1.5 }}>
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>
                  {stats ? stats.total.toLocaleString() : '—'}
                </span> bills tracked<br />
                <span style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 15, color: 'var(--sage)' }}>
                  {stats ? tiers.high.toLocaleString() : '—'}
                </span> in the HIGH tier
              </div>
            </div>
          </div>
          {stats && <DistributionBar counts={tiers} style={{ marginTop: 13 }} />}
        </div>

        {/* -- TRACK-YOUR-BILLS PROMPT (replaces the personal needs-attention card) -- */}
        <Link href="/login" style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderLeft: '3px solid var(--brass)', borderRadius: '0 var(--radius) var(--radius) 0',
          padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12,
          textDecoration: 'none', color: 'inherit',
        }}>
          <img
            src="/logos/vector-wa-mark.svg"
            alt=""
            aria-hidden="true"
            style={{ height: 20, width: 'auto', flexShrink: 0, filter: 'drop-shadow(0 0 10px rgba(184,151,90,0.25))' }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.3, marginBottom: 2 }}>
              Track your bills &mdash; free
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.4 }}>
              A watchlist, hearing alerts, and your own trajectory gauge.
            </div>
          </div>
          <span aria-hidden="true" style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--brass)', flexShrink: 0 }}>
            {'→'}
          </span>
        </Link>

        {/* -- INSTRUMENTS: momentum + issue heat (2-up), then statewide movers -- */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <MomentumTile count={momentumCount} interim={interim} />
          <IssueHeat categories={categories} />
        </div>
        <MoversChart deltas={deltas} billsById={billsById} interim={interim} />

        {/* -- IN THE NEWS (identical to registered; statewide, self-hides when empty) -- */}
        <InTheNews items={newsItems} />

        {/* -- FOOTER NAV -- */}
        <div style={{ display: 'flex', gap: 9 }}>
          <FooterPill href="/search">Search bills</FooterPill>
          <FooterPill href="/methodology">How it works</FooterPill>
        </div>
      </div>
    </div>
  )
}

function FooterPill({ href, children }) {
  return (
    <Link
      href={href}
      style={{
        flex: 1, textAlign: 'center', textDecoration: 'none',
        border: '1px solid var(--border)', borderRadius: 10,
        padding: '12px 9px', minHeight: 44,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: 'var(--text-mid)',
      }}
    >
      {children}
    </Link>
  )
}
