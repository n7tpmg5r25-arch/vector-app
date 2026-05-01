'use client'
import { useState } from 'react'
import { createBrowserClient } from '../../../lib/supabase'
import { SHOREPINE, FONT_BODY } from '../../../lib/shorepine'

/**
 * Client portal — Download briefing PDF
 *
 * Thread 4 client-side button. Generates a Shorepine-branded portfolio
 * brief covering every bill assigned to the named client, with shared
 * notes only. Reuses the existing `generateBriefPDF()` from
 * `app/lib/generate-pdf.js` — that generator already filters
 * `billNotes` to `visibility === 'shared'` inside drawBillCard(), so the
 * client view picks up zero private leakage even if the caller passed
 * a mixed list (which we don't — see the .eq('visibility', 'shared')
 * below for defense in depth).
 *
 * RLS posture: this component runs in the browser as the SIGNED-IN user.
 *   - Owner (admin previewing portal): sees their own notes (RLS:
 *     auth.uid() = user_id). We still .eq('visibility','shared') so the
 *     PDF preview matches what the client would actually see.
 *   - Client: sees shared notes only on bills in their tracked_bills,
 *     enforced by `bill_notes_read_shared_by_client` (Thread 4 migration).
 *
 * Props:
 *   - clientId : uuid    — the client whose bills to brief
 *   - clientName : string — used as the tagLabel on the PDF cover/header
 */
export default function DownloadBriefingButton({ clientId, clientName }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  async function handleDownload() {
    if (busy) return
    setBusy(true)
    setErr(null)
    try {
      const supabase = createBrowserClient()

      // 1. Tracked bills assigned to this client. RLS narrows the result:
      //    owner-of-row OR client-membership match — admins viewing the
      //    portal still see this set because they own the rows.
      const { data: trackedRows, error: tbErr } = await supabase
        .from('tracked_bills')
        .select(`
          bill_id, tag, notes, added_at,
          bills (
            bill_id, bill_number, title, final_score,
            stage, chamber, category, committee_name,
            has_public_hearing, committee_passed,
            hearing_date, days_to_cutoff, status, stalled,
            prime_sponsor, prime_party, bipartisan,
            session, companion_bill, companion_stage, companion_score, companion_state,
            confidence_label, pass_probability, ai_summary, custom_summary,
            calendar_pressure, calendar_pressure_next_meeting,
            xf_multiplier
          )
        `)
        .eq('client_id', clientId)
        .order('added_at', { ascending: false })

      if (tbErr) throw tbErr
      const billsForBrief = (trackedRows || []).filter(t => t.bills)

      // 2. Shared analyst notes for those bills. RLS layer on bill_notes
      //    is the actual fence (`bill_notes_read_shared_by_client`); the
      //    .eq('visibility','shared') below just makes the intent explicit.
      const billIds = billsForBrief.map(t => t.bill_id)
      let sharedNotes = []
      if (billIds.length) {
        const { data: notesData } = await supabase
          .from('bill_notes')
          .select('bill_id, body, created_at, updated_at, visibility')
          .in('bill_id', billIds)
          .eq('visibility', 'shared')
          .order('created_at', { ascending: false })
        sharedNotes = notesData || []
      }

      // 3. Activity context — amendments + fiscal notes (descriptive only;
      //    same payload the owner watchlist export hands the generator).
      let amendmentsData = []
      let fiscalData = []
      if (billIds.length) {
        const { data: aData } = await supabase
          .from('amendments')
          .select('bill_id, amendment_number, adopted, floor_action_date')
          .in('bill_id', billIds)
        amendmentsData = aData || []

        const { data: fData } = await supabase
          .from('fiscal_note_history')
          .select('bill_id, detected_date, new_size, note')
          .in('bill_id', billIds)
        fiscalData = fData || []
      }

      // 4. Calibration cohort blurb — best-effort. If it fails, the PDF
      //    falls back to the baked-in 8,062-bill sentence per generate-pdf.js
      //    (G5: methodology cohort is intentionally frozen).
      let cohortStats = null
      try {
        const { fetchTotalScoredBills } = await import('../../../lib/app-stats')
        cohortStats = await fetchTotalScoredBills(supabase)
      } catch (e) {
        console.warn('cohort fetch failed; PDF will use baked-in calibration sentence', e)
      }

      const today = new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })

      const { generateBriefPDF } = await import('../../../lib/generate-pdf')
      await generateBriefPDF({
        tagLabel: clientName,
        date: today,
        bills: billsForBrief,
        scoreDeltas: {},   // client view doesn't surface score deltas
        changes: {},       // ditto
        session: undefined, // generator derives session context from helpers; G1 — no literal
        billNotes: sharedNotes,
        amendments: amendmentsData,
        fiscalHistory: fiscalData,
        cohortStats,
      })
    } catch (e) {
      console.error('Briefing download failed', e)
      setErr('Couldn’t generate the briefing. Try again, or get in touch if it persists.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleDownload}
        disabled={busy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px',
          fontSize: 12, fontWeight: 500, letterSpacing: '0.04em',
          textTransform: 'uppercase',
          fontFamily: FONT_BODY,
          color: SHOREPINE.parchment,
          background: 'rgba(184, 151, 90, 0.18)',
          border: `1px solid ${SHOREPINE.brass}`,
          borderRadius: 6,
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.65 : 1,
          transition: 'background 0.15s, border-color 0.15s',
        }}
        onMouseEnter={(e) => {
          if (busy) return
          e.currentTarget.style.background = 'rgba(184, 151, 90, 0.32)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(184, 151, 90, 0.18)'
        }}
      >
        <svg
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <polyline points="9 15 12 18 15 15"/>
        </svg>
        {busy ? 'Generating…' : 'Download briefing'}
      </button>
      {err && (
        <span
          role="alert"
          style={{
            marginLeft: 8,
            fontSize: 11,
            color: SHOREPINE.ember,
            fontFamily: FONT_BODY,
          }}
        >
          {err}
        </span>
      )}
    </>
  )
}
