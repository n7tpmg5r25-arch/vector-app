/**
 * VECTOR | WA — Alert Detection (Phase 9)
 *
 * Runs after sync-v2.js in GitHub Actions.
 * Compares current bill state to yesterday's snapshot for all
 * tracked (watchlisted) bills with alert_enabled = true.
 *
 * Inserts rows into alert_events for five triggers:
 *   1. outcome_change    — confidence_label changed
 *   2. imminent_hearing  — hearing_date set within 3 days
 *   3. rules_pull        — pulled_from_rules flipped false → true
 *   4. amendment_posted  — new amendment appeared on a tracked bill (Phase 10)
 *   5. fiscal_note_change — fiscal note status changed on a tracked bill (Phase 10)
 *   6. hearing_scheduled — hearing scheduled for a watchlist bill (Phase 11.2)
 *   7. committee_meeting_scheduled — new meeting for a followed committee (Phase 11.2)
 *
 * Phase 11.2 dedup: persistent via unique partial indexes on
 * (user_id, meeting_id, bill_id) and (user_id, meeting_id). Inserts use
 * onConflict ignoreDuplicates so re-syncs and reschedules don't re-fire.
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

  // 4d. Amendment posted: new amendments created today for tracked bills (Phase 10)
  const todayDate = new Date().toISOString().split('T')[0];
  if (billIds.length > 0) {
    let allNewAmendments = [];
    for (let i = 0; i < billIds.length; i += 500) {
      const batch = billIds.slice(i, i + 500);
      const { data: newAmends } = await supabase
        .from('amendments')
        .select('bill_id, amendment_number, sponsor, adopted, description')
        .in('bill_id', batch)
        .gte('created_at', todayDate + 'T00:00:00Z');
      if (newAmends) allNewAmendments = allNewAmendments.concat(newAmends);
    }

    // Group by bill_id and fire one alert per bill (not per amendment)
    const amendsByBill = new Map();
    for (const a of allNewAmendments) {
      if (!amendsByBill.has(a.bill_id)) amendsByBill.set(a.bill_id, []);
      amendsByBill.get(a.bill_id).push(a);
    }

    for (const [bId, amends] of amendsByBill) {
      if (recentSet.has(`${bId}:amendment_posted`)) continue;
      // Find the tracked entry to get user_id and bill_number
      const trackedEntry = tracked.find(t => t.bill_id === bId);
      if (!trackedEntry) continue;
      const billNumber = trackedEntry.bills?.bill_number || bId;
      newEvents.push({
        bill_id: bId,
        user_id: trackedEntry.user_id,
        event_type: 'amendment_posted',
        event_data: {
          bill_number: billNumber,
          count: amends.length,
          amendments: amends.slice(0, 3).map(a => ({
            number: a.amendment_number,
            sponsor: a.sponsor,
            adopted: a.adopted,
          })),
        },
      });
    }
    console.log(`  Checked amendments: ${allNewAmendments.length} new across ${amendsByBill.size} bills.`);
  }

  // 4e. Fiscal note change: detected today for tracked bills (Phase 10)
  if (billIds.length > 0) {
    let allFiscalChanges = [];
    for (let i = 0; i < billIds.length; i += 500) {
      const batch = billIds.slice(i, i + 500);
      const { data: fiscalRows } = await supabase
        .from('fiscal_note_history')
        .select('bill_id, previous_size, new_size, note')
        .in('bill_id', batch)
        .eq('detected_date', todayDate);
      if (fiscalRows) allFiscalChanges = allFiscalChanges.concat(fiscalRows);
    }

    for (const f of allFiscalChanges) {
      if (recentSet.has(`${f.bill_id}:fiscal_note_change`)) continue;
      const trackedEntry = tracked.find(t => t.bill_id === f.bill_id);
      if (!trackedEntry) continue;
      newEvents.push({
        bill_id: f.bill_id,
        user_id: trackedEntry.user_id,
        event_type: 'fiscal_note_change',
        event_data: {
          bill_number: trackedEntry.bills?.bill_number || f.bill_id,
          previous: f.previous_size,
          new_size: f.new_size,
          note: f.note,
        },
      });
    }
    console.log(`  Checked fiscal notes: ${allFiscalChanges.length} changes detected.`);
  }

  // 4f. Hearing scheduled for a watchlist bill (Phase 11.2)
  //     Window = meetings created in last 30h (covers twice-daily sync cadence).
  //     Dedup is enforced by the unique partial index alert_events_hearing_dedup;
  //     inserts here just need to not crash on conflict.
  const trackedBillIds = new Set(tracked.filter(t => t.alert_enabled !== false).map(t => t.bill_id));
  const trackedByBill = new Map();
  for (const t of tracked) trackedByBill.set(t.bill_id, t);
  const hearingEvents = [];
  if (trackedBillIds.size > 0) {
    const cutoff = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    const { data: hearingRows, error: hErr } = await supabase
      .from('meeting_agenda_items')
      .select(`
        meeting_id,
        bill_id,
        item_type,
        created_at,
        committee_meetings!inner (
          id, committee_name, chamber, meeting_date, meeting_time,
          location, meeting_type, agenda_url, is_joint
        )
      `)
      .in('bill_id', Array.from(trackedBillIds))
      .gte('created_at', cutoff)
      .gte('committee_meetings.meeting_date', new Date().toISOString().split('T')[0]);

    if (hErr) {
      console.warn('  [hearing_scheduled query failed]:', hErr.message);
    } else {
      for (const r of hearingRows || []) {
        const t = trackedByBill.get(r.bill_id);
        if (!t) continue;
        const cm = r.committee_meetings;
        hearingEvents.push({
          bill_id: r.bill_id,
          user_id: t.user_id,
          event_type: 'hearing_scheduled',
          meeting_id: r.meeting_id,
          event_data: {
            bill_number: t.bills?.bill_number || null,
            meeting_id: r.meeting_id,
            committee_name: cm?.committee_name || null,
            chamber: cm?.chamber || null,
            meeting_date: cm?.meeting_date || null,
            meeting_time: cm?.meeting_time || null,
            meeting_type: cm?.meeting_type || null,
            location: cm?.location || null,
            agenda_url: cm?.agenda_url || null,
            is_joint: cm?.is_joint || false,
            item_type: r.item_type || null,
          },
        });
      }
    }
    console.log(`  Checked hearings: ${hearingEvents.length} candidate events for watchlist bills.`);
  }

  // 4g. New meeting for a followed committee (Phase 11.2)
  const { data: follows, error: fErr } = await supabase
    .from('user_followed_committees')
    .select('user_id, committee_id')
    .eq('alerts_enabled', true);

  const committeeEvents = [];
  if (fErr) {
    console.warn('  [followed_committees query failed]:', fErr.message);
  } else if (follows && follows.length > 0) {
    // Group follows by committee for fan-out
    const followByCmte = new Map();
    for (const f of follows) {
      const list = followByCmte.get(f.committee_id) || [];
      list.push(f.user_id);
      followByCmte.set(f.committee_id, list);
    }

    const cutoff = new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString();
    const { data: newMtgs, error: mErr } = await supabase
      .from('committee_meetings')
      .select('id, committee_id, committee_name, chamber, meeting_date, meeting_time, location, meeting_type, agenda_url, is_joint, created_at')
      .in('committee_id', Array.from(followByCmte.keys()))
      .gte('created_at', cutoff)
      .gte('meeting_date', new Date().toISOString().split('T')[0]);

    if (mErr) {
      console.warn('  [new_meetings query failed]:', mErr.message);
    } else {
      for (const m of newMtgs || []) {
        const userIds = followByCmte.get(m.committee_id) || [];
        for (const uid of userIds) {
          committeeEvents.push({
            bill_id: null,
            user_id: uid,
            event_type: 'committee_meeting_scheduled',
            meeting_id: m.id,
            event_data: {
              meeting_id: m.id,
              committee_name: m.committee_name,
              chamber: m.chamber,
              meeting_date: m.meeting_date,
              meeting_time: m.meeting_time,
              meeting_type: m.meeting_type,
              location: m.location,
              agenda_url: m.agenda_url,
              is_joint: m.is_joint,
            },
          });
        }
      }
    }
    console.log(`  Checked followed committees: ${committeeEvents.length} candidate events.`);
  }

  // 5. Insert events
  //    Phase 9 events → .insert() (legacy; dedup via 24h window)
  //    Phase 11.2 events → .insert() with ignoreDuplicates via unique indexes
  const phase9Events = newEvents;
  const phase11Events = [...hearingEvents, ...committeeEvents];

  if (phase9Events.length === 0 && phase11Events.length === 0) {
    console.log('No alert events detected.');
  } else {
    if (phase9Events.length > 0) {
      console.log(`Detected ${phase9Events.length} Phase 9 alert event(s):`);
      for (const e of phase9Events) {
        console.log(`  - ${e.event_type}: ${e.event_data.bill_number || e.bill_id}`);
      }
      const { error: insertErr } = await supabase
        .from('alert_events')
        .insert(phase9Events);
      if (insertErr) {
        console.error('Error inserting Phase 9 alert events:', insertErr.message);
        process.exit(1);
      }
      console.log(`Inserted ${phase9Events.length} Phase 9 alert event(s).`);
    }

    if (phase11Events.length > 0) {
      // Unique partial indexes absorb re-runs. upsert + ignoreDuplicates uses
      // the (user_id, meeting_id, bill_id) / (user_id, meeting_id) indexes.
      // We split by event_type to match each onConflict target.
      const hearingBatch = phase11Events.filter(e => e.event_type === 'hearing_scheduled');
      const committeeBatch = phase11Events.filter(e => e.event_type === 'committee_meeting_scheduled');

      if (hearingBatch.length > 0) {
        const { error: hInsErr, count: hInsCount } = await supabase
          .from('alert_events')
          .upsert(hearingBatch, {
            onConflict: 'user_id,meeting_id,bill_id',
            ignoreDuplicates: true,
            count: 'exact',
          });
        if (hInsErr) {
          console.warn('  [hearing_scheduled upsert failed]:', hInsErr.message);
        } else {
          console.log(`  Inserted ${hInsCount ?? 0} hearing_scheduled event(s) (duplicates ignored).`);
        }
      }

      if (committeeBatch.length > 0) {
        const { error: cInsErr, count: cInsCount } = await supabase
          .from('alert_events')
          .upsert(committeeBatch, {
            onConflict: 'user_id,meeting_id',
            ignoreDuplicates: true,
            count: 'exact',
          });
        if (cInsErr) {
          console.warn('  [committee_meeting_scheduled upsert failed]:', cInsErr.message);
        } else {
          console.log(`  Inserted ${cInsCount ?? 0} committee_meeting_scheduled event(s) (duplicates ignored).`);
        }
      }
    }
  }

  const duration = Date.now() - start;
  console.log(`Alert detection complete in ${duration}ms.`);
}

// ── Run ────────────────────────────────────────────────────

detectAlerts().catch(err => {
  console.error('Alert detection failed:', err);
  process.exit(1);
});
