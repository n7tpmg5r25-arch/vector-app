'use client'
/**
 * Vector | WA — All news (/news) (DASH-5).
 *
 * The full statewide feed behind the dashboard's "In the news" card. Same
 * source the card reads (news_items, DASH-4), same row treatment (NewsRow from
 * InTheNews.js), just more of it — up to thirty recent items, balanced to at
 * most five per source by the NEWS-1 neutral selection rule (lib/news-select),
 * so one prolific outlet cannot fill the page. Display only;
 * no ingest, no scoring. Mobile-only: sticky brand header, viewer-aware
 * bottom nav -- authed viewers get Nav here; anon rides the globally-mounted
 * PublicBottomNav (PORTAL-3 opened /news in the proxy + its mirror, closing
 * the anon dead end behind the home card's "All ->" link). Reads the
 * public-read news_items table directly, so it works for any viewer.
 */
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { createBrowserClient } from '../../lib/supabase'
import Nav from '../components/Nav'
import { NewsRow } from '../components/dashboard/InTheNews'
import { useViewer } from '../../lib/viewer-capabilities'
import { selectBalanced } from '../../lib/news-select'

const EYEBROW = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
}

export default function NewsPage() {
  const supabase = createBrowserClient()
  // PORTAL-3: anon visitors reach this page when the public layer is on.
  // The authed bottom Nav renders only for signed-in viewers; anon wayfinding
  // is the global PublicBottomNav (its mirror gained /news this PR).
  const { capabilities, loading: viewerLoading } = useViewer()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    ;(async () => {
      const { data } = await supabase
        .from('news_items')
        .select('source, title, snippet, url, published_at, item_type')
        .order('published_at', { ascending: false, nullsFirst: false })
        .limit(120) // NEWS-1: multi-source pool; balanced down to 30 below
      if (active) {
        setItems(selectBalanced(data || [], { perSourceCap: 5, limit: 30 }))
        setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  return (
    <div style={{ paddingBottom: 90, fontFamily: 'var(--font-body)' }}>
      <div style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'radial-gradient(ellipse at 70% 20%, rgba(184,151,90,0.10) 0%, transparent 60%), rgba(14,16,20,0.95)',
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--border)', padding: '52px 16px 14px',
      }}>
        <img
          src="/logos/vector-wa-primary.svg"
          alt="Vector | WA"
          style={{ height: 56, width: 'auto', display: 'block', flexShrink: 0, filter: 'drop-shadow(0 0 16px rgba(184,151,90,0.22))' }}
        />
      </div>

      <div style={{ padding: '16px 16px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h1 style={{ ...EYEBROW, color: 'var(--teal)' }}>In the news</h1>
          <span style={{ ...EYEBROW, letterSpacing: '0.04em' }}>Statewide</span>
        </div>

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius)', padding: '4px 14px 12px',
        }}>
          {loading ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
              Loading…
            </div>
          ) : items.length === 0 ? (
            <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--text-faint)' }}>
              No statewide items yet — the nightly feed fills this in.
            </div>
          ) : (
            items.map((item, i) => (
              <NewsRow key={item.url ?? `${item.source}-${i}`} item={item} />
            ))
          )}
        </div>

        <div style={{ marginTop: 14 }}>
          <Link href="/" style={{ ...EYEBROW, padding: '8px 0', display: 'inline-block' }}>
            ← Back to dashboard
          </Link>
        </div>
      </div>

      {!viewerLoading && capabilities.isAuthed && <Nav/>}
    </div>
  )
}
