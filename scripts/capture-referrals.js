#!/usr/bin/env node
/**
 * VECTOR | WA — Phase 11.8
 * scripts/capture-referrals.js
 *
 * Captures each bill's committee assignment over time. Runs nightly after
 * sync-v2.js (which writes bills.committee_name and bills.committee_passed).
 * Writes to bill_committee_referrals so that post-session we can compute
 * "days in committee → pass likelihood" without needing per-day snapshots.
 *
 * Descriptive only for v1 — scoreBill() is NOT reading this table during
 * the 2027 session freeze. See memory:project_scoring_freeze_2027.
 *
 * Safe to run any day. Idempotent:
 *   - First observation of a bill in a committee: opens a referral row
 *   - Committee unchanged + not yet passed: bumps last_observed
 *   - committee_passed flipped to true: closes row as action='passed'
 *   - committee_name changed: closes old as 'rereferred', opens new
 *   - After sine die with referral still open: closes as 'held'
 *
 * If this script fails, the nightly sync still succeeds — it's wired in
 * with `if: success()` AFTER sync-v2, so a failure here doesn't break
 * anything downstream. Disable by commenting out the workflow step.
 */

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

// ── Biennium schedule (keep in sync with app/lib/session-config.js) ────
const BIENNIUMS = [
  { session: '2025-2026', start: '2025-01-13', end: '2026-03-12' },
  { session: '2027-2028', start: '2027-01-11', end: '2028-03-10' },
]

// ── Helpers ────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().slice(0, 10) } // YYYY-MM-DD
function bienniumFor(session) { return BIENNIUMS.find(b => b.session === session) }
function isSessionOver(session) {
  const b = bienniumFor(session)
  return b ? today() > b.end : false
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set')
    process.exit(1)
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const TODAY = today()
  console.log(`[capture-referrals] starting run on ${TODAY}`)

  // Bills we care about: any bill with a committee_name, across active+recent sessions
  const sessions = BIENNIUMS.map(b => b.session)

  // Page through bills (default limit is 1000 per Supabase memory)
  let allBills = []
  let from = 0
  const pageSize = 1000
  while (true) {
    const { data, error } = await sb
      .from('bills')
      .select('bill_id, session, chamber, committee_name, committee_passed, confidence_label')
      .in('session', sessions)
      .range(from, from + pageSize - 1)
    if (error) { console.error(error.message); process.exit(1) }
    if (!data || data.length === 0) break
    allBills = allBills.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  console.log(`[capture-referrals] loaded ${allBills.length} bills across ${sessions.join(', ')}`)

  // Load every currently-open referral for these bills (one query)
  const { data: openRows, error: openErr } = await sb
    .from('bill_committee_referrals')
    .select('id, bill_id, session, committee_name, referred_at')
    .is('released_at', null)
  if (openErr) { console.error(openErr.message); process.exit(1) }
  const openByBill = new Map((openRows || []).map(r => [r.bill_id, r]))
  console.log(`[capture-referrals] ${openByBill.size} existing open referrals`)

  // Walk bills and decide what to do
  const toInsert = []
  const toCloseAsPassed = []
  const toCloseAsRereferred = []
  const toBumpLastObserved = []

  for (const bill of allBills) {
    const hasCommittee = !!bill.committee_name
    const open = openByBill.get(bill.bill_id)

    if (!hasCommittee) {
      // No committee assignment on the bill. If an open referral exists and
      // the session is over, the sine-die sweep below handles it. Otherwise
      // skip — the bill might be pre-introduction or post-rules.
      continue
    }

    // Committee passed flipped true with an open referral on same committee → close as passed
    if (open && open.committee_name === bill.committee_name && bill.committee_passed) {
      toCloseAsPassed.push({ id: open.id, bill_id: bill.bill_id })
      continue
    }

    // Committee changed → close old as rereferred, open new
    if (open && open.committee_name !== bill.committee_name) {
      toCloseAsRereferred.push({ id: open.id, bill_id: bill.bill_id })
      toInsert.push({
        bill_id: bill.bill_id,
        session: bill.session,
        chamber: bill.chamber,
        committee_name: bill.committee_name,
        referred_at: TODAY,
      })
      continue
    }

    // First observation of this bill in this committee
    if (!open && !bill.committee_passed) {
      toInsert.push({
        bill_id: bill.bill_id,
        session: bill.session,
        chamber: bill.chamber,
        committee_name: bill.committee_name,
        referred_at: TODAY,
      })
      continue
    }

    // First observation but bill already committee_passed — seed a closed historical row
    // (so we at least know the committee) but can't reconstruct referred_at
    if (!open && bill.committee_passed) {
      toInsert.push({
        bill_id: bill.bill_id,
        session: bill.session,
        chamber: bill.chamber,
        committee_name: bill.committee_name,
        referred_at: TODAY, // best we can do — real date unknown
        released_at: TODAY,
        action: 'passed',
        notes: 'seeded retroactively; referred_at unknown',
      })
      continue
    }

    // Open referral, committee unchanged, not yet passed → just bump last_observed
    if (open && open.committee_name === bill.committee_name && !bill.committee_passed) {
      toBumpLastObserved.push(open.id)
    }
  }

  // Sine-die sweep: close any stuck-open referrals whose session has ended
  const billById = new Map(allBills.map(b => [b.bill_id, b]))
  const toCloseAsHeld = []
  for (const r of (openRows || [])) {
    const bill = billById.get(r.bill_id)
    if (!bill) continue
    if (isSessionOver(r.session)) {
      const b = bienniumFor(r.session)
      const willPass = toCloseAsPassed.some(x => x.id === r.id)
      const willRerefer = toCloseAsRereferred.some(x => x.id === r.id)
      if (!willPass && !willRerefer) {
        toCloseAsHeld.push({
          id: r.id,
          bill_id: r.bill_id,
          released_at: b.end,
        })
      }
    }
  }

  // ── Apply changes ────────────────────────────────────────────────────
  const stats = {
    inserted: 0,
    closed_passed: 0,
    closed_rereferred: 0,
    closed_held: 0,
    bumped: 0,
    errors: 0,
  }

  // Insert new referrals (chunk to 500)
  for (let i = 0; i < toInsert.length; i += 500) {
    const batch = toInsert.slice(i, i + 500)
    const { error } = await sb.from('bill_committee_referrals').insert(batch)
    if (error) { console.error('insert err:', error.message); stats.errors++ }
    else stats.inserted += batch.length
  }

  // Close-as-passed
  for (const row of toCloseAsPassed) {
    const { error } = await sb.from('bill_committee_referrals')
      .update({ released_at: TODAY, action: 'passed', last_observed: new Date().toISOString() })
      .eq('id', row.id)
    if (error) { console.error('close-passed err:', error.message); stats.errors++ }
    else stats.closed_passed++
  }

  // Close-as-rereferred
  for (const row of toCloseAsRereferred) {
    const { error } = await sb.from('bill_committee_referrals')
      .update({ released_at: TODAY, action: 'rereferred', last_observed: new Date().toISOString() })
      .eq('id', row.id)
    if (error) { console.error('close-rereferred err:', error.message); stats.errors++ }
    else stats.closed_rereferred++
  }

  // Close-as-held (sine die sweep)
  for (const row of toCloseAsHeld) {
    const { error } = await sb.from('bill_committee_referrals')
      .update({ released_at: row.released_at, action: 'held', last_observed: new Date().toISOString() })
      .eq('id', row.id)
    if (error) { console.error('close-held err:', error.message); stats.errors++ }
    else stats.closed_held++
  }

  // Bump last_observed on unchanged open referrals (single batch update)
  if (toBumpLastObserved.length > 0) {
    const { error } = await sb.from('bill_committee_referrals')
      .update({ last_observed: new Date().toISOString() })
      .in('id', toBumpLastObserved)
    if (error) { console.error('bump err:', error.message); stats.errors++ }
    else stats.bumped = toBumpLastObserved.length
  }

  console.log('[capture-referrals] done:', JSON.stringify(stats))

  if (stats.errors > 0) {
    console.error(`[capture-referrals] ${stats.errors} errors — exiting non-zero`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('[capture-referrals] fatal:', err)
  process.exit(1)
})
