/**
 * Vector | WA — Needs Attention card (DASH-3).
 *
 * Risk + hearings triage for the tracked set, sitting directly under the
 * portfolio hero (mock order: hero -> needs-attention -> momentum/heat). A left
 * border carries the state — rust when bills are at risk, brass when it is only
 * an upcoming-hearings heads-up — then three reads: the at-risk count (Playfair,
 * rust), hearings this week (Playfair, brass-light), and a one-line callout for
 * the single most urgent bill, "HB #### {reason} . {urgency}", from the model.
 *
 * Self-gating: returns null during the interim (scores frozen; the Session
 * Outcomes block owns that period) and when nothing needs flagging. All risk
 * logic lives in lib/at-risk.js; this component only presents it. Mobile-only;
 * no media queries.
 *
 * Props:
 *   watchlist  Array<{ bills: billRow }>   the viewer's tracked bills
 *   interim    boolean                     interim freeze -> hidden
 */
import { isAtRisk, atRiskReason, urgencyText, worstAtRisk } from '../../../lib/at-risk'

const EYEBROW = {
  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--text-muted)',
}

const HEARING_WINDOW_DAYS = 7

/** hearing_date (text) falling within the next HEARING_WINDOW_DAYS days. */
function isHearingSoon(dateStr, now) {
  if (!dateStr) return false
  const t = new Date(dateStr).getTime()
  if (Number.isNaN(t)) return false
  const diff = (t - now.getTime()) / 86400000
  return diff >= -0.5 && diff <= HEARING_WINDOW_DAYS
}

function billLabel(b) {
  if (!b) return ''
  return `${b.chamber === 'House' ? 'HB' : 'SB'} ${b.bill_number}`
}

export default function NeedsAttention({ watchlist = [], interim = false }) {
  if (interim) return null

  const now = new Date()
  const bills = watchlist.map(w => w && w.bills).filter(Boolean)
  const atRiskCount = bills.filter(isAtRisk).length
  const hearingsCount = bills.filter(b => isHearingSoon(b.hearing_date, now)).length
  const worst = worstAtRisk(bills)

  // Nothing to flag — stay quiet rather than show an empty card.
  if (atRiskCount === 0 && hearingsCount === 0 && !worst) return null

  const hasRisk = atRiskCount > 0
  const reason = worst ? atRiskReason(worst) : null
  const tail = worst ? urgencyText(worst, now) : ''

  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${hasRisk ? 'var(--danger)' : 'var(--gold)'}`,
      borderRadius: '0 var(--radius) var(--radius) 0',
      padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 13,
    }}>
      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 27, lineHeight: 1,
          color: hasRisk ? 'var(--danger)' : 'var(--text-muted)',
          textShadow: hasRisk ? '0 0 12px rgba(196,71,48,0.35)' : 'none',
        }}>
          {atRiskCount}
        </div>
        <div style={{ ...EYEBROW, marginTop: 3 }}>At risk</div>
      </div>

      <div style={{ width: 1, height: 34, background: 'var(--border)', flexShrink: 0 }} />

      <div style={{ textAlign: 'center', flexShrink: 0 }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 27, lineHeight: 1,
          color: hearingsCount > 0 ? 'var(--gold)' : 'var(--text-muted)',
        }}>
          {hearingsCount}
        </div>
        <div style={{ ...EYEBROW, marginTop: 3 }}>Hearings</div>
      </div>

      <div style={{
        flex: 1, minWidth: 0, fontSize: 11, color: 'var(--text-mid)', lineHeight: 1.4,
        borderLeft: '1px solid var(--border)', paddingLeft: 13,
      }}>
        {worst && reason ? (
          <>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{billLabel(worst)}</span>{' '}
            {reason.label}
            {tail ? <> · <span style={{ color: 'var(--danger)' }}>{tail}</span></> : null}
          </>
        ) : hearingsCount > 0 ? (
          <>{hearingsCount} hearing{hearingsCount === 1 ? '' : 's'} scheduled this week</>
        ) : (
          <>No bills at risk this week</>
        )}
      </div>
    </div>
  )
}
