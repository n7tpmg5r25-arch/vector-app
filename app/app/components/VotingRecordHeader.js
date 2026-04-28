/**
 * VotingRecordHeader — Vector | WA Thread 15.1 (2026-04-25)
 *
 * Shared section header for the two surfaces that render a roll-call /
 * voting-record list:
 *   • bill/[id]/page.js  → mode="by-bill"   ("Roll-call history · {scope}")
 *   • members/page.js    → mode="by-member" ("Voting Record · {scope} ({N} most-recent votes)")
 *
 * Lifted out of two divergent inline implementations (one inside
 * VoteHistoryTable's scopeLabel render; one written directly in members/page.js).
 * Single source of truth so the two surfaces can never drift again.
 *
 * Props:
 *   mode       — 'by-bill' | 'by-member'   (controls the label noun)
 *   scopeLabel — string, e.g. '2025-26 session' or '2025-2026' or 'All Sessions'
 *   count      — optional number; renders "(N most-recent votes)" suffix when present
 *   showScopeStamp — Thread 31 (2026-04-27); when true and count > 0, render a
 *                    second subline reinforcing what window is loaded so users
 *                    can read the cumulative-across-bienniums profile at a
 *                    glance once 2027-2028 is added to the warehouse.
 *
 * Display-only (G5 frozen-engine). Never imports or calls scoreBill() / extractFeatures().
 */

export default function VotingRecordHeader({ mode, scopeLabel, count, showScopeStamp = false }) {
  const label = mode === 'by-member' ? 'Voting Record' : 'Roll-call history'
  // Thread 31: scope-stamp copy for by-member views with ≥1 row. Plays best
  // when paired with the session selector — readers can always answer "is
  // this all sessions or just one?" without scrolling. Suppressed for
  // by-bill mode (the scope is already implicit in the bill identity).
  const showStamp =
    showScopeStamp &&
    mode === 'by-member' &&
    typeof count === 'number' &&
    count > 0
  const stampText = showStamp
    ? scopeLabel
      ? `Showing ${count} ${count === 1 ? 'vote' : 'votes'} from ${scopeLabel}.`
      : `Showing ${count} ${count === 1 ? 'vote' : 'votes'}.`
    : null
  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          fontSize: 9,
          color: 'var(--text-faint)',
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
        }}
      >
        {label}{scopeLabel ? ` · ${scopeLabel}` : ''}
        {typeof count === 'number' && (
          <span
            style={{
              marginLeft: 8,
              color: 'var(--text-muted)',
              textTransform: 'none',
              letterSpacing: 0,
            }}
          >
            ({count} most-recent votes)
          </span>
        )}
      </div>
      {stampText && (
        <div
          style={{
            marginTop: 4,
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          {stampText}
        </div>
      )}
    </div>
  )
}
