/**
 * Vector | WA — diverging "movers" chart (DASH-2).
 *
 * Horizontal diverging bars off a center line: score gainers sweep right in
 * Sage, losers sweep left in Rust (Brand Guide v1.2 §02 functional palette,
 * semantic-only). Bill labels + signed values are DM Mono structured data.
 * Brass is deliberately absent here — direction is carried by the functional
 * palette, not by brass. Reads the in-memory scoreDeltas map the watchlist
 * chips already use (bill_id -> delta), so it adds no query.
 *
 * Props:
 *   deltas    { [bill_id]: number }   signed score change since the prior snapshot
 *   billsById { [bill_id]: { bill_number, chamber } }   label resolver (no fetch)
 *   interim   boolean                 interim freeze -> deltas is intentionally
 *                                     empty; show a calm note, not an empty chart
 */
const EYEBROW = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
}

function billLabel(id, billsById) {
  const b = billsById[id]
  if (b && b.bill_number) return `${b.chamber === 'House' ? 'HB' : 'SB'} ${b.bill_number}`
  return String(id)
}

export default function MoversChart({ deltas = {}, billsById = {}, interim = false }) {
  const rows = Object.entries(deltas)
    .map(([id, d]) => ({ id, d: Number(d) || 0 }))
    .filter(r => r.d !== 0)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 4)
  const maxAbs = rows.reduce((m, r) => Math.max(m, Math.abs(r.d)), 0) || 1

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 }}>
        <span style={EYEBROW}>Today’s movers</span>
        <span style={{ ...EYEBROW, letterSpacing: '0.04em' }}>± score</span>
      </div>

      {interim ? (
        <div style={{ padding: '6px 0 2px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Scores are frozen during the interim.<br />
          <span style={{ color: 'var(--text-faint)' }}>Daily moves resume when the Legislature reconvenes.</span>
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '6px 0 2px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
          No score moves in the latest sync.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(({ id, d }) => {
            const w = Math.max(6, Math.round((Math.abs(d) / maxAbs) * 48))
            const up = d > 0
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-mid)', width: 54, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {billLabel(id, billsById)}
                </span>
                <div style={{ flex: 1, position: 'relative', height: 11 }} aria-hidden="true">
                  <div style={{ position: 'absolute', left: '50%', top: -1, bottom: -1, width: 1, background: 'var(--border-light)' }} />
                  <div style={{
                    position: 'absolute', top: 1, height: 9, width: `${w}%`,
                    background: up ? 'var(--sage)' : 'var(--danger)',
                    ...(up ? { left: '50%', borderRadius: '0 3px 3px 0' } : { right: '50%', borderRadius: '3px 0 0 3px' }),
                  }} />
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: up ? 'var(--sage)' : 'var(--danger)', width: 24, textAlign: 'right' }}>
                  {up ? '+' : '−'}{Math.abs(d)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
