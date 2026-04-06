/**
 * VECTOR | WA — Backfill Data Gaps Script
 * lib/backfill-data-gaps.js
 *
 * Fills 3 data gaps that require WSL API calls:
 *   1. avg_floor_margin  — from GetRollCalls (billNumber param, NOT billId)
 *   2. companion_bill    — from GetLegislation (Companions element)
 *   3. is_committee_chair — from GetCommitteeMembers (chair lookup)
 *
 * Run this LOCALLY (not in Cowork) since the WSL API is blocked from the sandbox.
 *
 * Usage:
 *   cd C:\Users\Col\vector-app
 *   node lib/backfill-data-gaps.js
 *
 * Requires .env with:
 *   SUPABASE_URL=https://skuedssejrbrxycgdcfw.supabase.co
 *   SUPABASE_SERVICE_KEY=your-service-key
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const xml2js = require('xml2js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const WA_BASE = 'https://wslwebservices.leg.wa.gov';
const BIENNIUM = '2025-26';
const SESSION = '2025-2026';

// ── XML HELPER ───────────────────────────────────────────────────────────────
async function fetchXML(service, endpoint, params) {
  const url = new URL(`${WA_BASE}/${service}/${endpoint}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { 'Accept': 'text/xml' },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${endpoint} → ${res.status}`);
  const text = await res.text();
  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });
  return parser.parseStringPromise(text);
}

function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// ── 1. BACKFILL ROLL CALLS (avg_floor_margin) ──────────────────────────────
// BUG FIX: GetRollCalls takes "billNumber" (e.g. "1001"), NOT "billId" (e.g. "HB 1001")
async function backfillRollCalls() {
  console.log('\n=== BACKFILLING ROLL CALLS (avg_floor_margin) ===');

  // Get ALL bills that don't have roll call data yet (paginate past 1000 limit)
  let bills = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, bill_number, stage')
      .eq('session', SESSION)
      .is('avg_floor_margin', null)
      .order('stage', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { console.error('DB error:', error.message); return; }
    if (!data || data.length === 0) break;
    bills = bills.concat(data);
    page++;
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  ${bills.length} bills need roll call data`);

  let updated = 0, withVotes = 0;
  const BATCH = 5;

  for (let i = 0; i < bills.length; i += BATCH) {
    const batch = bills.slice(i, i + BATCH);
    process.stdout.write(`  Processing ${i}–${Math.min(i + BATCH, bills.length)} of ${bills.length}...\r`);

    await Promise.all(batch.map(async (bill) => {
      try {
        // FIX: use billNumber, not billId
        const data = await fetchXML('LegislationService.asmx', 'GetRollCalls', {
          biennium: BIENNIUM,
          billNumber: bill.bill_number,
        });

        const rollCalls = toArray(data?.ArrayOfRollCall?.RollCall);

        if (rollCalls.length > 0) {
          // Each RollCall has Votes with Members, or YeaVotes/NayVotes counts
          const margins = [];
          for (const rc of rollCalls) {
            const yeas = parseInt(rc.YeaVotes?.Count || rc.YeaVotes || '0');
            const nays = parseInt(rc.NayVotes?.Count || rc.NayVotes || '0');
            const total = yeas + nays;
            if (total > 0) {
              margins.push(yeas / total);
            }
          }

          const avgMargin = margins.length > 0
            ? margins.reduce((a, b) => a + b, 0) / margins.length
            : null;

          if (avgMargin !== null) {
            const { error: uErr } = await supabase
              .from('bills')
              .update({ avg_floor_margin: Math.round(avgMargin * 1000) / 1000 })
              .eq('bill_id', bill.bill_id);
            if (!uErr) { updated++; withVotes++; }
          }
        }
      } catch (e) {
        // Silently skip — some bills may not have roll calls
      }
    }));

    // Rate limit: 2 second pause between batches
    if (i + BATCH < bills.length) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n  Done: ${withVotes} bills have vote data, ${updated} updated`);
}

// ── 2. BACKFILL COMPANION BILLS ─────────────────────────────────────────────
async function backfillCompanionBills() {
  console.log('\n=== BACKFILLING COMPANION BILLS ===');

  // Paginate past 1000-row limit
  let bills = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, bill_number')
      .eq('session', SESSION)
      .is('companion_bill', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) { console.error('DB error:', error.message); return; }
    if (!data || data.length === 0) break;
    bills = bills.concat(data);
    page++;
    if (data.length < PAGE_SIZE) break;
  }
  console.log(`  ${bills.length} bills need companion bill check`);

  let updated = 0, found = 0;
  const BATCH = 5;

  for (let i = 0; i < bills.length; i += BATCH) {
    const batch = bills.slice(i, i + BATCH);
    process.stdout.write(`  Processing ${i}–${Math.min(i + BATCH, bills.length)} of ${bills.length}...\r`);

    await Promise.all(batch.map(async (bill) => {
      try {
        const data = await fetchXML('LegislationService.asmx', 'GetLegislation', {
          biennium: BIENNIUM,
          billNumber: bill.bill_number,
        });

        const legs = toArray(data?.ArrayOfLegislation?.Legislation);
        if (legs.length === 0) return;

        const leg = legs[0];
        // Companion bills are in Companions > Companion > BillId
        const companions = toArray(leg?.Companions?.Companion);

        if (companions.length > 0) {
          const companionId = companions[0].BillId || companions[0].BillNumber || null;
          if (companionId) {
            const { error: uErr } = await supabase
              .from('bills')
              .update({ companion_bill: companionId })
              .eq('bill_id', bill.bill_id);
            if (!uErr) { updated++; found++; }
          }
        }
      } catch (e) {
        // Skip on error
      }
    }));

    if (i + BATCH < bills.length) await new Promise(r => setTimeout(r, 2000));
  }

  console.log(`\n  Done: ${found} bills have companion bills, ${updated} updated`);
}

// ── 3. BACKFILL COMMITTEE CHAIRS ────────────────────────────────────────────
async function backfillCommitteeChairs() {
  console.log('\n=== BACKFILLING COMMITTEE CHAIRS (is_committee_chair) ===');

  // Step 1: Get all committees and their chairs
  console.log('  Step 1: Fetching committee rosters...');
  const chairNames = new Set();

  for (const agency of ['House', 'Senate']) {
    try {
      const data = await fetchXML('CommitteeService.asmx', 'GetCommittees', {
        biennium: BIENNIUM,
      });

      const committees = toArray(data?.ArrayOfCommittee?.Committee);
      console.log(`  Found ${committees.length} committees`);

      for (const comm of committees) {
        const commName = comm.Name || comm.LongName || '';
        const commAgency = comm.Agency || agency;
        if (!commName) continue;

        try {
          const membersData = await fetchXML('CommitteeService.asmx', 'GetCommitteeMembers', {
            biennium: BIENNIUM,
            agency: commAgency,
            committee: commName,
          });

          const members = toArray(membersData?.ArrayOfMember?.Member);
          for (const m of members) {
            // Check for chair title/position
            const title = (m.Title || m.Position || m.Role || '').toLowerCase();
            if (title.includes('chair') && !title.includes('vice')) {
              const name = `${m.FirstName || ''} ${m.LastName || ''}`.trim();
              if (name) {
                chairNames.add(name);
                console.log(`    Chair: ${name} (${commName}, ${commAgency})`);
              }
            }
          }
        } catch (e) {
          // Skip individual committee errors
        }

        await new Promise(r => setTimeout(r, 500)); // rate limit
      }
    } catch (e) {
      console.error(`  Error fetching ${agency} committees:`, e.message);
    }
  }

  console.log(`  Found ${chairNames.size} unique committee chairs`);

  // Step 2: Update bills where prime_sponsor matches a chair
  if (chairNames.size > 0) {
    // First reset all to false
    await supabase
      .from('bills')
      .update({ is_committee_chair: false })
      .eq('session', SESSION);

    let updated = 0;
    for (const chairName of chairNames) {
      const { data, error } = await supabase
        .from('bills')
        .update({ is_committee_chair: true })
        .eq('session', SESSION)
        .ilike('prime_sponsor', `%${chairName}%`);

      if (!error) {
        // Count affected rows
        const { count } = await supabase
          .from('bills')
          .select('*', { count: 'exact', head: true })
          .eq('session', SESSION)
          .eq('is_committee_chair', true)
          .ilike('prime_sponsor', `%${chairName}%`);
        updated += (count || 0);
      }
    }

    console.log(`  Updated is_committee_chair for bills by ${chairNames.size} chairs`);
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Backfill Data Gaps — ${SESSION}`);

  // Run sequentially to be gentle on the API
  await backfillRollCalls();
  await backfillCompanionBills();
  await backfillCommitteeChairs();

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n=== ALL DONE (${duration}s) ===`);
  console.log('Next step: Run the re-score script to update scores with new data.');
}

main().catch(console.error);
