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
 *
 * Display-only (G5 frozen-engine). Never imports or calls scoreBill() / extractFeatures().
 */

export default function VotingRecordHeader({ mode, scopeLabel, count }) {
  const label = mode === 'by-member' ? 'Voting Record' : 'Roll-call history'
  return (
    <div
      style={{
        fontSize: 9,
        color: 'var(--text-faint)',
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        marginBottom: 8,
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
  )
}
