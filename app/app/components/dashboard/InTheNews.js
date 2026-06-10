/**
 * Vector | WA — In the news (DASH-5).
 *
 * One calm statewide news card, last in the cockpit body and sitting directly
 * above the footer nav (mock order: ... -> movers -> news -> footer). Reads the
 * news_items table the DASH-4 nightly job fills; this thread is display only —
 * no ingest, no scoring. Each row is a hairline-divided link: the source and a
 * relative timestamp in DM Mono over a two-line Karla headline, with a trailing
 * glyph that names the kind of item — an external-link arrow for press coverage
 * (item_type 'article') or a document for a Legislature filing ('legislation').
 * Tapping a row opens the source in a new tab.
 *
 * Brand: brass is spent only on the "In the news" eyebrow; everything else is
 * neutral. DM Mono labels, Karla headlines, no functional palette here. News
 * runs year-round, so there is no interim gate — the one empty state is an
 * empty table, which renders nothing rather than a hollow card. Mobile-only;
 * no media queries.
 *
 * Neutral selection (NEWS-1, 2026-06-09): the card receives a newest-first
 * POOL (up to 24 rows from page.js / PublicHome.js) and balances it here - at
 * most 2 rows per source, sources rotating newest-first (lib/news-select) - so
 * no single outlet can own the card regardless of publishing volume. Anonymous
 * and registered viewers get the same default selection.
 *
 * Props:
 *   items  Array<{ source, title, url, published_at, item_type }>  newest-first pool
 */
import Link from 'next/link'
import { ExternalLink, FileText } from 'lucide-react'
import { selectBalanced } from '../../../lib/news-select'

const EYEBROW = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
}

/**
 * Compact relative time for a timestamp: "now", "5m", "3h", "2d", "1w".
 * Returns null for a missing or unparseable date (the row then shows the
 * source alone — never a dangling " · "). Future timestamps clamp to "now".
 */
export function relTime(iso, now = Date.now()) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const sec = Math.max(0, Math.floor((now - t) / 1000))
  if (sec < 60) return 'now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d`
  const wk = Math.floor(day / 7)
  if (wk < 5) return `${wk}w`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo`
  return `${Math.floor(day / 365)}y`
}

/**
 * One news row. An anchor when the item has a URL (opens the source in a new
 * tab, rel="noopener noreferrer"); a plain div otherwise, so a feed item that
 * arrived without a link is never a dead click. Every row carries a hairline
 * top border, matching the mock's divided list.
 */
export function NewsRow({ item }) {
  if (!item) return null
  const isLegislation = item.item_type === 'legislation'
  const Icon = isLegislation ? FileText : ExternalLink
  const time = relTime(item.published_at)
  const rowStyle = {
    textDecoration: 'none', color: 'inherit',
    display: 'flex', gap: 10, alignItems: 'flex-start',
    padding: '11px 0', borderTop: '1px solid var(--border)',
  }
  const inner = (
    <>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ ...EYEBROW, fontSize: 8, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.source}{time ? ` · ${time}` : ''}
        </div>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 12.5, color: 'var(--text-primary)', lineHeight: 1.35,
          display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, overflow: 'hidden',
        }}>
          {item.title}
        </div>
      </div>
      <Icon size={14} strokeWidth={2} aria-hidden="true" style={{ color: 'var(--text-muted)', marginTop: 2, flexShrink: 0 }} />
    </>
  )
  if (item.url) {
    return (
      <a href={item.url} target="_blank" rel="noopener noreferrer" style={rowStyle}>
        {inner}
      </a>
    )
  }
  return <div style={rowStyle}>{inner}</div>
}

export default function InTheNews({ items = [] }) {
  // NEWS-1: per-source cap + newest-first rotation instead of a bare slice.
  const rows = selectBalanced(items || [], { perSourceCap: 2, limit: 4 })
  // News is year-round (no interim gate). The one empty state is an empty
  // table — stay silent rather than render a hollow card. The DASH-4 nightly
  // job fills it within a day of going live.
  if (rows.length === 0) return null

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', padding: '12px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ ...EYEBROW, color: 'var(--teal)' }}>In the news</span>
        <Link href="/news" style={{ ...EYEBROW, letterSpacing: '0.04em', padding: '6px 0 6px 10px' }}>
          Statewide · All →
        </Link>
      </div>
      {rows.map((item, i) => (
        <NewsRow key={item.id ?? item.url ?? `${item.source}-${i}`} item={item} />
      ))}
    </div>
  )
}
