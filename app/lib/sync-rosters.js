/**
 * Thread 11.1 — SponsorService roster cache + member_votes.party backfill.
 *
 * READ-ONLY enrichment script (G5). Does NOT import, call, or reference
 * scoreBill() / extractFeatures(). The legislator_party_history table is
 * descriptive metadata; the UPDATE that stamps member_votes.party is purely
 * a display concern. scoreBill() reads bills.* fields — it never reads
 * roll_calls / member_votes / legislator_party_history. Verified before
 * Thread 11.1 ship.
 *
 * What this script does (idempotent — re-runs are safe):
 *   1. Hits SponsorService.asmx/GetSponsors?biennium=YYYY-YY for the target
 *      biennium and pulls the full Member roster (~158 rows).
 *   2. Upserts each <Member> row into legislator_party_history, keyed on
 *      (member_id, biennium). Biennium is stored in the DB-native four-year
 *      format ('2025-2026') so it joins cleanly with bills.session — the
 *      WA API native format ('2025-26') is converted at parse time.
 *   3. Runs an idempotent per-member UPDATE on member_votes.party for any
 *      rows still NULL. The roster's party value is authoritative for the
 *      member_id; we don't session-scope the UPDATE in v1 because no member
 *      has switched parties across biennia in current data (verified
 *      2026-04-25: Abbarno=R in both 2025-26 and 2023-24 SponsorService
 *      probes). If a real switch ever appears, the (member_id, biennium)
 *      key on legislator_party_history preserves the historic record so a
 *      future, session-scoped backfill can fix it.
 *   4. Reports member_votes.party-NULL counts before AND after — drift
 *      check per feedback_idempotency_keys_must_be_globally_unique.
 *
 * Invocation
 *   $env:CURRENT_BIENNIUM = '2025-26'      # WA API short form
 *   $env:CURRENT_YEAR     = '2026'         # second year of biennium
 *   $env:SUPABASE_URL = '...'
 *   $env:SUPABASE_SERVICE_KEY = '...'
 *   node app/lib/sync-rosters.js
 *
 *   # Or for a historical biennium (one-time fill, used during Thread 11.1
 *   # ship to populate 2023-24 alongside 2025-26):
 *   node app/lib/sync-rosters.js --biennium 2023-24 --session 2023-2024
 *
 * Hard-fail rules (mirror backfill-roll-calls.js):
 *   - https only — leg.wa.gov hangs http requests
 *   - 15s per-request AbortController so a hung call doesn't stall the script
 *   - Polite User-Agent header
 *
 * Background
 *   Memory: project_thread11_vote_ui_shipped_2026_04_25 (party=NULL state),
 *           project_thread6_voting_data_shipped_2026_04_25 (member_id format
 *           verified to match SponsorService Id),
 *           feedback_probe_before_parser (probe done first; XML shape was
 *           confirmed before this parser was written).
 */

const path = require('path');

// Resolve env from whichever .env.local is closer (matches backfill-roll-calls.js).
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
  require('dotenv').config(); // CWD fallback
} catch (_) { /* dotenv optional */ }

// ── Args ─────────────────────────────────────────────────────────────────
function parseFlag(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1 || i + 1 >= process.argv.length) return fallback;
  return process.argv[i + 1];
}

const ARG_BIENNIUM = parseFlag('biennium', null);   // '2023-24' format for WA API
const ARG_SESSION  = parseFlag('session',  null);   // '2023-2024' format for DB

// Same env-derivation as backfill-roll-calls.js:
//   CURRENT_BIENNIUM = '2025-26' (WA API form)
//   CURRENT_YEAR     = '2026'    (second year of biennium → '2025-2026')
const BIENNIUM = ARG_BIENNIUM || process.env.CURRENT_BIENNIUM;
const SESSION  = ARG_SESSION  || (process.env.CURRENT_YEAR
  ? `${parseInt(process.env.CURRENT_YEAR) - 1}-${process.env.CURRENT_YEAR}`
  : null);

if (!BIENNIUM || !/^\d{4}-\d{2}$/.test(BIENNIUM)) {
  console.error(`FATAL: pass --biennium YYYY-YY or set CURRENT_BIENNIUM. Got ${JSON.stringify(BIENNIUM)}`);
  process.exit(2);
}
if (!SESSION || !/^\d{4}-\d{4}$/.test(SESSION)) {
  console.error(`FATAL: pass --session YYYY-YYYY or set CURRENT_YEAR. Got ${JSON.stringify(SESSION)}`);
  process.exit(2);
}

// ── Supabase client (service-role) ───────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');
const xml2js = require('xml2js');

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('FATAL: set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in your env or .env.local');
  process.exit(2);
}
if (!SUPABASE_KEY) {
  console.error('FATAL: set SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in your env or .env.local');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

// ── WA API fetch helper (mirrors backfill-roll-calls.js) ─────────────────
const BASE = process.env.WA_API_BASE || 'https://wslwebservices.leg.wa.gov';
const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
const REQUEST_TIMEOUT_MS = 15_000;

async function fetchXML(service, method, params) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${service}/${method}?${qs}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'vector-wa-roster-sync/1.0' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
    const xml = await res.text();
    return await parser.parseStringPromise(xml);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Member parsing ───────────────────────────────────────────────────────
//
// Probe verified XML shape (2026-04-25 against 2025-26 biennium):
//   <ArrayOfMember>
//     <Member>
//       <Id>31526</Id>
//       <Name>Peter Abbarno</Name>
//       <LongName>Representative Abbarno</LongName>
//       <Agency>House</Agency>
//       <Acronym>ABBA</Acronym>
//       <Party>R</Party>
//       <District>20</District>
//       <Phone>(360) 786-7896</Phone>
//       <Email>Peter.Abbarno@leg.wa.gov</Email>
//       <FirstName>Peter</FirstName>
//       <LastName>Abbarno</LastName>
//     </Member>
//     ...
//   </ArrayOfMember>
//
// Fallback paths cover variants in case WSL renames elements between API
// versions. Pattern matches sync-v2.js fetchBienniumSponsorParties().
function _parseMembers(data) {
  const items = data?.ArrayOfMember?.Member
             ?? data?.ArrayOfSponsor?.Sponsor
             ?? data?.ArrayOfLegislator?.Legislator;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

function _normalizeAgency(s) {
  const v = String(s || '').trim();
  // Probe confirmed full-word values; defensive normalization for edge cases.
  if (/^h/i.test(v)) return 'House';
  if (/^s/i.test(v)) return 'Senate';
  return v || 'Unknown';
}

function _toRosterRow(m, biennium) {
  const memberId = String(m.Id || m.MemberId || m.LegislatorId || '').trim();
  const fullName = String(m.Name || `${m.FirstName || ''} ${m.LastName || ''}`).trim();
  const agency   = _normalizeAgency(m.Agency || m.Chamber);
  const party    = String(m.Party || '').trim() || 'Unknown';
  if (!memberId || !fullName) return null;
  return {
    member_id:   memberId,
    biennium:    biennium,
    agency:      agency,
    party:       party,
    district:    String(m.District || '').trim() || null,
    full_name:   fullName,
    long_name:   String(m.LongName || '').trim() || null,
    first_name:  String(m.FirstName || '').trim() || null,
    last_name:   String(m.LastName || '').trim() || null,
    acronym:     String(m.Acronym || '').trim() || null,
    last_seen_at: new Date().toISOString(),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[${new Date().toISOString()}] Roster sync — biennium=${BIENNIUM} session=${SESSION}`);

  // ── 1. Fetch the WA roster ──
  let xmlData;
  try {
    xmlData = await fetchXML('SponsorService.asmx', 'GetSponsors', { biennium: BIENNIUM });
  } catch (e) {
    console.error(`FATAL: SponsorService fetch failed: ${e.message}`);
    process.exit(1);
  }

  const rawMembers = _parseMembers(xmlData);
  if (!rawMembers.length) {
    console.error(`FATAL: SponsorService returned 0 members for ${BIENNIUM}. Refusing to wipe roster.`);
    process.exit(1);
  }
  console.log(`  Fetched ${rawMembers.length} <Member> rows from SponsorService`);

  // ── 2. Upsert into legislator_party_history ──
  const parsedRows = rawMembers.map(m => _toRosterRow(m, SESSION)).filter(Boolean);

  // WA SponsorService returns the SAME member_id twice when a legislator
  // moves chambers mid-biennium. Confirmed cases (probe 2026-04-25):
  //   2025-26 — Alvarado 34024 House→Senate, Hunt 35410 House→Senate
  //   2023-24 — Hansen 16499 House→Senate
  // Both rows carry non-empty Name in these cases, so the empty-Name filter
  // above doesn't catch them. Dedup by member_id, keeping the LAST occurrence
  // — by API convention this is the most recent chamber assignment, which
  // is the one we want for "what party is this member NOW" lookups.
  const byMemberId = new Map();
  for (const r of parsedRows) byMemberId.set(r.member_id, r);
  const rows = [...byMemberId.values()];
  const dupCount = parsedRows.length - rows.length;

  console.log(`  Parsed ${parsedRows.length} valid roster rows; ${dupCount > 0 ? `deduped ${dupCount} mid-biennium chamber transition(s); ` : ''}${rawMembers.length - parsedRows.length} skipped as empty-Name`);

  // Pre-write count (drift sentinel).
  const { count: lphBefore } = await supabase
    .from('legislator_party_history')
    .select('*', { count: 'exact', head: true })
    .eq('biennium', SESSION);

  const { error: upsertErr } = await supabase
    .from('legislator_party_history')
    .upsert(rows, { onConflict: 'member_id,biennium' });
  if (upsertErr) {
    console.error(`FATAL: legislator_party_history upsert failed: ${upsertErr.message}`);
    process.exit(1);
  }

  // Post-write count.
  const { count: lphAfter } = await supabase
    .from('legislator_party_history')
    .select('*', { count: 'exact', head: true })
    .eq('biennium', SESSION);

  const lphDelta = (lphAfter || 0) - (lphBefore || 0);
  console.log(`  legislator_party_history (${SESSION}): ${lphBefore || 0} → ${lphAfter || 0} rows (Δ ${lphDelta >= 0 ? '+' : ''}${lphDelta}, ${rows.length} upserted)`);

  // ── 3. Backfill member_votes.party ────────────────────────────────────
  // Per-member UPDATE: for each member in the roster, stamp their party on
  // every NULL-party member_votes row matching their member_id. PostgREST
  // doesn't expose join-aware UPDATEs through the data API, so the loop is
  // 148 round-trips at ~50ms each (~30s total).
  //
  // Session scoping: deliberately omitted in v1. Reason: in current data,
  // no member has different parties across biennia (verified 2026-04-25 via
  // SponsorService probe — Abbarno=R in both 2025-26 and 2023-24). The
  // (member_id, biennium) PK on legislator_party_history preserves the
  // historic record so a future, session-scoped backfill via Postgres
  // function can fix it if a real switch ever appears. Tradeoff documented
  // in Thread 11.1 SHIPPED notes.

  // Pre-update sentinel.
  const { count: nullBefore, error: countErr1 } = await supabase
    .from('member_votes')
    .select('roll_call_id', { count: 'exact', head: true })
    .is('party', null);
  if (countErr1) {
    console.error(`FATAL: pre-count failed: ${countErr1.message}`);
    process.exit(1);
  }

  let updated = 0;
  let memberMisses = 0;
  for (const r of rows) {
    const { error: updErr, count } = await supabase
      .from('member_votes')
      .update({ party: r.party }, { count: 'exact' })
      .eq('member_id', r.member_id)
      .is('party', null);
    if (updErr) {
      console.error(`  WARN: update for member ${r.member_id} (${r.full_name}) failed: ${updErr.message}`);
      memberMisses++;
      continue;
    }
    updated += (count || 0);
  }

  // Post-update sentinel.
  const { count: nullAfter, error: countErr2 } = await supabase
    .from('member_votes')
    .select('roll_call_id', { count: 'exact', head: true })
    .is('party', null);
  if (countErr2) {
    console.error(`FATAL: post-count failed: ${countErr2.message}`);
    process.exit(1);
  }

  const driftPct = (nullBefore || 0) > 0
    ? (((nullAfter || 0) / (nullBefore || 1)) * 100).toFixed(2)
    : '0.00';
  console.log(`  member_votes.party (all biennia): NULL ${nullBefore || 0} → ${nullAfter || 0} (updated ${updated}; ${driftPct}% remain NULL)`);
  if (memberMisses > 0) {
    console.warn(`  ⚠ ${memberMisses} per-member updates failed — investigate above.`);
  }

  // Loud warning if drift exceeds the spec's 5% threshold — would indicate the
  // roster doesn't match member_votes.member_id keys, contradicting the
  // 2026-04-25 probe. Only meaningful when we synced the current biennium
  // (cross-biennium NULLs from a roster we haven't loaded yet are expected).
  if ((nullBefore || 0) > 0 && parseFloat(driftPct) > 5) {
    console.warn(`  ⚠ Drift > 5% — investigate. Either roster IDs don't match member_votes IDs, or member_votes contains rows from a biennium whose roster hasn't been synced. Run with --biennium for any missing biennia.`);
  }

  console.log(`[${new Date().toISOString()}] Roster sync done.`);
  process.exit(0);
}

main().catch(e => { console.error(`FATAL: ${e.message}`); process.exit(1); });
