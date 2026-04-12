/**
 * VECTOR | WA — Alert Detection (Phase 9)
 *
 * Runs after sync-v2.js in GitHub Actions.
 * Compares current bill state to yesterday's snapshot for all
 * tracked (watchlisted) bills with alert_enabled = true.
 *
 * Inserts rows into alert_events for three narrow triggers:
 *   1. outcome_change  — confidence_label changed
 *   2. imminent_hearing — hearing_date set within 3 days
 *   3. rules_pull       — pulled_from_rules flipped false → true
 *
 * Score deltas and routine stage advances are NOT per-event alerts;
 * those go into the weekly digest only.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node app/lib/detect-alerts.js
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ────────────────────────────────────────────────

function daysUntil(dateStr) {
  if (!dateStr) return Infinity;
  const target = new Date(dateStr);
  const now = new Date();
  return Math.ceil((target - now) / 86400000);
}

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

// ── Main ───────────────────────────────────────────────────

async function detectAlerts() {
  const start = Date.now();
  console.log('=== Alert Detection ===');

  // 1. Get all tracked bills with alert_enabled = true
  //    Join with bills table for current state
  const { data: tracked, error: trackErr } = await supabase
    .from('tracked_bills')
    .select(`
      user_id,
      bill_id,
      alert_enabled,
      bills!inner (
        bill_id,
        bill_number,
        title,
        session,
        confidence_label,
        pulled_from_rules,
        hearing_date,
        stage
      )
    `)
    .eq('alert_enabled', true);

  if (trackErr) {
    console.error('Error fetching tracked bills:', trackErr.message);
    process.exit(1);
  }

  if (!tracked || tracked.length === 0) {
    console.log('No tracked bills with alerts enabled. Done.');
    return;
  }

  console.log(`Found ${tracked.length} tracked bills with alerts enabled.`);

  // 2. Get yesterday's snapshots for those bill_ids
  const billIds = [...new Set(tracked.map(t => t.bill_id))];
  const yesterdayDate = yesterday();

  // Fetch in pages (Supabase 1000-row limit)
  let allSnapshots = [];
  for (let i = 0; i < billIds.length; i += 500) {
    const batch = billIds.slice(i, i + 500);
    const { data: snaps, error: snapErr } = await supabase
      .from('trajectory_snapshots')
      .select('bill_id, confidence_label, snapshot_date')
      .in('bill_id', batch)
      .eq('snapshot_date', yesterdayDate);

    if (snapErr) {
      console.error('Error fetching snapshots:', snapErr.message);
    } else if (snaps) {
      allSnapshots = allSnapshots.concat(snaps);
    }
  }

  // Build lookup: bill_id → yesterday's snapshot
  const snapMap = new Map();
  for (const s of allSnapshots) {
    snapMap.set(s.bill_id, s);
  }

  console.log(`Loaded ${allSnapshots.length} yesterday snapshots for comparison.`);

  // 3. Also check for recently detected events (dedup window = 24h)
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentEvents } = await supabase
    .from('alert_events')
    .select('bill_id, event_type')
    .gte('detected_at', twentyFourHoursAgo);

  const recentSet = new Set(
    (recentEvents || []).map(e => `${e.bill_id}:${e.event_type}`)
  );

  // 4. Detect events
  const newEvents = [];

  for (const t of tracked) {
    const bill = t.bills;
    if (!bill) continue;

    const snap = snapMap.get(t.bill_id);
    const dedupKey = (type) => `${t.bill_id}:${type}`;

    // 4a. Outcome change: confidence_label changed
    if (snap && bill.confidence_label !== snap.confidence_label) {
      if (!recentSet.has(dedupKey('outcome_change'))) {
        newEvents.push({
          bill_id: t.bill_id,
          user_id: t.user_id,
          event_type: 'outcome_change',
          event_data: {
            from: snap.confidence_label || 'null',
            to: bill.confidence_label || 'null',
            bill_number: bill.bill_number,
          },
        });
      }
    }

    // 4b. Imminent hearing: hearing_date within 3 days and wasn't in yesterday's snapshot
    //     We check hearing_date on the bills table (text field, e.g. "2027-02-14")
    if (bill.hearing_date) {
      const days = daysUntil(bill.hearing_date);
      if (days >= 0 && days <= 3) {
        if (!recentSet.has(dedupKey('imminent_hearing'))) {
          newEvents.push({
            bill_id: t.bill_id,
            user_id: t.user_id,
            event_type: 'imminent_hearing',
            event_data: {
              hearing_date: bill.hearing_date,
              bill_number: bill.bill_number,
            },
          });
        }
      }
    }

    // 4c. Rules pull: pulled_from_rules flipped to true
    //     Yesterday's snapshot doesn't have pulled_from_rules directly,
    //     so we check against bills.updated_at or rely on dedup window
    if (bill.pulled_from_rules === true) {
      if (!recentSet.has(dedupKey('rules_pull'))) {
        // Only fire if this is likely new — check if bill was updated today
        const updatedToday = bill.updated_at &&
          new Date(bill.updated_at).toISOString().split('T')[0] === new Date().toISOString().split('T')[0];
        // Fallback: if no snapshot exists (new bill) or dedup hasn't fired
        if (updatedToday || !snap) {
          newEvents.push({
            bill_id: t.bill_id,
            user_id: t.user_id,
            event_type: 'rules_pull',
            event_data: {
              bill_number: bill.bill_number,
            },
          });
        }
      }
    }
  }

  // 5. Insert events
  if (newEvents.length === 0) {
    console.log('No alert events detected.');
  } else {
    console.log(`Detected ${newEvents.length} alert event(s):`);
    for (const e of newEvents) {
      console.log(`  - ${e.event_type}: ${e.event_data.bill_number || e.bill_id}`);
    }

    const { error: insertErr } = await supabase
      .from('alert_events')
      .insert(newEvents);

    if (insertErr) {
      console.error('Error inserting alert events:', insertErr.message);
      process.exit(1);
    }

    console.log(`Inserted ${newEvents.length} alert event(s).`);
  }

  const duration = Date.now() - start;
  console.log(`Alert detection complete in ${duration}ms.`);
}

// ── Run ────────────────────────────────────────────────────

detectAlerts().catch(err => {
  console.error('Alert detection failed:', err);
  process.exit(1);
});
