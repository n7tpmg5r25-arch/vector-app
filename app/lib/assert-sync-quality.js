// Phase 6.3 — Post-sync data-quality assertions.
//
// Why this exists: Phase 5B shipped with 3,111 bills that all had empty titles,
// "Unknown" prime sponsors, and a uniform fiscal_note_size, and NO alarm was
// raised because sync_log only tracked row counts, not field quality. Manual QA
// caught it after launch-blocker damage was already done. This script is the
// automated safety net — run it as a GitHub Actions step immediately after
// sync-v2.js finishes. If ANY assertion fails, the workflow turns red (so the
// GitHub Actions failure email fires) and the downstream AI summary step is
// skipped so we don't burn Haiku tokens summarizing corrupted data.
//
// Thresholds are derived from the healthy post-Phase-6.11 state:
//   - 2,855 bills in 2025-2026
//   - 100% titles populated
//   - 100% prime_sponsor != 'Unknown'
//   - 100% prime_party in (D, R)
//   - 4 distinct fiscal_note_size values
//   - 1,039 bipartisan bills
//
// Thresholds are set BELOW current values so normal sync-to-sync variation
// doesn't trigger false alarms, but catastrophic regressions (sync bug, API
// change) will still fire.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Biennium calendar — keep in sync with app/lib/session-config.js BIENNIUMS.
// Inlined in CommonJS because this script is require()-loaded. Mirrors
// getCurrentSession() in session-config.js: picks the biennium whose prefiling
// window has opened. Without this, SYNC_SESSION-less local runs would vacuously
// assert against 2025-2026 data long after the 2027 rollover.
const BIENNIUM_EFFECTIVE_DATES = [
  { session: '2025-2026', effectiveFrom: '2024-12-01' },
  { session: '2027-2028', effectiveFrom: '2026-12-01' },
  { session: '2029-2030', effectiveFrom: '2028-12-01' },
];
function currentBienniumFromDate(now = new Date()) {
  for (let i = BIENNIUM_EFFECTIVE_DATES.length - 1; i >= 0; i--) {
    if (now >= new Date(BIENNIUM_EFFECTIVE_DATES[i].effectiveFrom)) {
      return BIENNIUM_EFFECTIVE_DATES[i].session;
    }
  }
  return BIENNIUM_EFFECTIVE_DATES[0].session;
}
const SESSION = process.env.SYNC_SESSION || currentBienniumFromDate();

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('FATAL: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── Thresholds ───────────────────────────────────────────────────────────────
// Session-aware: mature sessions (2025-2026) have tight bounds; new sessions
// (2027-2028 during pre-filing) have relaxed bounds since bills trickle in.
const SESSION_THRESHOLDS = {
  '2025-2026': { expectedBills: 3400, tolerance: 0.15 },
  // Add future sessions here as they mature; during pre-filing, use defaults
};
const defaults = SESSION_THRESHOLDS[SESSION] || { expectedBills: null, tolerance: null };
const EXPECTED_BILL_COUNT = defaults.expectedBills;   // null = skip count check for new sessions
const BILL_COUNT_TOLERANCE = defaults.tolerance;
const MIN_TITLE_PCT = 0.99;                // 99% must have titles
const MIN_SPONSOR_PCT = 0.99;              // 99% must have real prime_sponsor (not "Unknown")
const MIN_PARTY_PCT = 0.95;                // 95% must have prime_party in (D,R)
const MIN_FISCAL_DISTINCT = 2;             // must have ≥2 distinct fiscal_note_size values
const MIN_BIPARTISAN = 1;                  // must have ≥1 bipartisan bill (drops to 0 = party enrichment broken)

// ── Run checks ───────────────────────────────────────────────────────────────
async function run() {
  const failures = [];
  const pass = (name, detail) => console.log(`  ✓ ${name}: ${detail}`);
  const fail = (name, detail) => { console.log(`  ✗ ${name}: ${detail}`); failures.push({ name, detail }); };

  console.log(`\n[assert-sync-quality] Checking session=${SESSION}\n`);

  // --- Check 1: bill count within tolerance ---
  const { count: totalBills, error: countErr } = await supabase
    .from('bills')
    .select('*', { count: 'exact', head: true })
    .eq('session', SESSION);

  if (countErr) {
    fail('bill_count_query', countErr.message);
  } else if (EXPECTED_BILL_COUNT) {
    const lo = Math.floor(EXPECTED_BILL_COUNT * (1 - BILL_COUNT_TOLERANCE));
    const hi = Math.ceil(EXPECTED_BILL_COUNT * (1 + BILL_COUNT_TOLERANCE));
    if (totalBills < lo || totalBills > hi) {
      fail('bill_count', `${totalBills} bills outside tolerance [${lo}..${hi}] (expected ~${EXPECTED_BILL_COUNT})`);
    } else {
      pass('bill_count', `${totalBills} bills in [${lo}..${hi}]`);
    }
  } else {
    // New session — no expected count yet, just log what we have
    pass('bill_count', `${totalBills} bills (new session, no baseline yet)`);
  }

  // Short-circuit if we can't even count bills
  if (!totalBills) {
    console.error('\nFATAL: could not count bills, aborting remaining checks');
    process.exit(2);
  }

  // --- Check 2: title coverage ---
  const { count: missingTitles } = await supabase
    .from('bills').select('*', { count: 'exact', head: true })
    .eq('session', SESSION).or('title.is.null,title.eq.');

  const titlePct = 1 - (missingTitles / totalBills);
  if (titlePct < MIN_TITLE_PCT) {
    fail('title_coverage', `${(titlePct * 100).toFixed(2)}% have titles (need ≥${MIN_TITLE_PCT * 100}%) — ${missingTitles} missing`);
  } else {
    pass('title_coverage', `${(titlePct * 100).toFixed(2)}% (${missingTitles} missing)`);
  }

  // --- Check 3: sponsor coverage (not "Unknown") ---
  const { count: unknownSponsors } = await supabase
    .from('bills').select('*', { count: 'exact', head: true })
    .eq('session', SESSION).eq('prime_sponsor', 'Unknown');

  const sponsorPct = 1 - (unknownSponsors / totalBills);
  if (sponsorPct < MIN_SPONSOR_PCT) {
    fail('sponsor_coverage', `${(sponsorPct * 100).toFixed(2)}% have real sponsors (need ≥${MIN_SPONSOR_PCT * 100}%) — ${unknownSponsors} Unknown`);
  } else {
    pass('sponsor_coverage', `${(sponsorPct * 100).toFixed(2)}% (${unknownSponsors} Unknown)`);
  }

  // --- Check 4: party coverage (Phase 6.11 safety net) ---
  const { count: withParty } = await supabase
    .from('bills').select('*', { count: 'exact', head: true })
    .eq('session', SESSION).in('prime_party', ['D', 'R']);

  const partyPct = withParty / totalBills;
  if (partyPct < MIN_PARTY_PCT) {
    fail('party_coverage', `${(partyPct * 100).toFixed(2)}% have D/R party (need ≥${MIN_PARTY_PCT * 100}%) — biennium roster fetch likely broken`);
  } else {
    pass('party_coverage', `${(partyPct * 100).toFixed(2)}% (${withParty}/${totalBills} have D/R)`);
  }

  // --- Check 5: fiscal distribution (catches Phase 5B "all zeros" bug) ---
  // Pull all distinct fiscal_note_size values in one shot
  const { data: fiscalRows, error: fiscalErr } = await supabase
    .from('bills')
    .select('fiscal_note_size')
    .eq('session', SESSION)
    .not('fiscal_note_size', 'is', null);

  if (fiscalErr) {
    fail('fiscal_distribution', `query error: ${fiscalErr.message}`);
  } else {
    const distinct = new Set(fiscalRows.map(r => r.fiscal_note_size));
    if (distinct.size < MIN_FISCAL_DISTINCT) {
      fail('fiscal_distribution', `only ${distinct.size} distinct values (need ≥${MIN_FISCAL_DISTINCT}) — uniform value suggests sync bug`);
    } else {
      pass('fiscal_distribution', `${distinct.size} distinct values: ${[...distinct].join(', ')}`);
    }
  }

  // --- Check 6: bipartisan count (drops to 0 if party enrichment broke) ---
  const { count: bipartisanCount } = await supabase
    .from('bills').select('*', { count: 'exact', head: true })
    .eq('session', SESSION).eq('bipartisan', true);

  if (bipartisanCount < MIN_BIPARTISAN) {
    fail('bipartisan_count', `${bipartisanCount} bipartisan bills (need ≥${MIN_BIPARTISAN}) — party enrichment likely broken`);
  } else {
    pass('bipartisan_count', `${bipartisanCount} bipartisan bills`);
  }

  // --- Check 7: latest sync_log entry had no errors ---
  const { data: logRows, error: logErr } = await supabase
    .from('sync_log')
    .select('ran_at, errors, bills_updated, notes')
    .eq('session', SESSION)
    .order('ran_at', { ascending: false })
    .limit(1);

  if (logErr || !logRows || logRows.length === 0) {
    fail('sync_log', `no sync_log entry found for session ${SESSION}`);
  } else {
    const latest = logRows[0];
    if (latest.errors !== null) {
      const errCount = Array.isArray(latest.errors) ? latest.errors.length : 1;
      fail('sync_log', `latest run (${latest.ran_at}) had ${errCount} errors — ${latest.notes}`);
    } else {
      pass('sync_log', `clean (${latest.bills_updated} bills, ${latest.notes})`);
    }
  }

  // ── Verdict ────────────────────────────────────────────────────────────────
  console.log('');
  if (failures.length > 0) {
    console.error(`\n❌ FAILED: ${failures.length} data-quality assertion(s) did not pass\n`);
    for (const f of failures) console.error(`   • ${f.name}: ${f.detail}`);
    console.error('\nThis nightly sync produced suspect data. Investigate before shipping.\n');
    process.exit(1);
  }
  console.log('\n✅ All data-quality assertions passed.\n');
  // Explicit exit to avoid libuv keepalive-pool assertion crash on Windows
  // when @supabase/supabase-js fetch pool holds open connections at drain time.
  process.exit(0);
}

run().catch(e => {
  console.error('FATAL assertion script error:', e);
  process.exit(2);
});
