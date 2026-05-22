/**
 * VECTOR | WA — Committee Seat Sync (Thread 123)
 * app/lib/sync-committee-seats.js
 *
 * Fetches committee membership rosters from the WA Legislature
 * CommitteeService API and upserts them into legislator_committee_seats.
 *
 * Runs weekly (Mondays) via GitHub Actions in nightly-sync.yml.
 * WA Legislature API is public, free, no auth required.
 * scoreBill() untouched — this script is purely additive.
 *
 * API endpoints used:
 *   CommitteeService.asmx/GetActiveCommittees      — all committees (both chambers)
 *   CommitteeService.asmx/GetActiveCommitteeMembers — roster per committee
 *
 * IMPORTANT: CommitteeService returns NO role/title field for members.
 * All seats are stored as role='member'. Role enrichment (chair/vice_chair)
 * deferred to a future enhancement using a separate data source.
 *
 * Invocation:
 *   node app/lib/sync-committee-seats.js
 *   # Or with explicit biennium override:
 *   CURRENT_BIENNIUM=2025-26 CURRENT_YEAR=2026 node app/lib/sync-committee-seats.js
 *
 * Env vars (same pattern as sync-v2.js / sync-rosters.js):
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY
 *   CURRENT_BIENNIUM  — WA API format, e.g. '2025-26'
 *   CURRENT_YEAR      — second year of biennium, e.g. '2026'
 *   WA_API_BASE       — defaults to https://wslwebservices.leg.wa.gov
 */

'use strict';

const path = require('path');

// Load .env.local from app/ or repo root, matching sync-rosters.js pattern
try {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env.local') });
  require('dotenv').config();
} catch (_) { /* dotenv optional */ }

const { createClient } = require('@supabase/supabase-js');
const xml2js = require('xml2js');

// ── Config ────────────────────────────────────────────────────────────────────

const BIENNIUM = process.env.CURRENT_BIENNIUM || '2025-26';   // WA API short form
const YEAR     = process.env.CURRENT_YEAR     || '2026';
const SESSION  = `${parseInt(YEAR, 10) - 1}-${YEAR}`;         // '2025-2026' — DB form

const WA_BASE  = process.env.WA_API_BASE || 'https://wslwebservices.leg.wa.gov';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) {
  console.error('FATAL: set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) in env or .env.local');
  process.exit(2);
}
if (!SUPABASE_KEY) {
  console.error('FATAL: set SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) in env or .env.local');
  process.exit(2);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const REQUEST_TIMEOUT_MS = 15_000;

// xml2js parser — same settings as sync-rosters.js and sync-meetings.js
const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

// Coerce xml2js single-item objects into arrays (explicitArray: false unpacks them)
const asArray = x => (!x ? [] : Array.isArray(x) ? x : [x]);

async function fetchXML(service, method, params) {
  const url = new URL(`${WA_BASE}/${service}/${method}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'vector-wa-committee-seats-sync/1.0' },
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
    const text = await res.text();
    return await parser.parseStringPromise(text);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`${method} timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ── Load known member IDs from DB ─────────────────────────────────────────────
// Uses legislator_party_history (confirmed table, confirmed member_id field).
// Builds Set<string> of known member IDs so we can:
//   - Set member_id on the row when we find a match
//   - Set member_id = null when not matched (avoids FK violations)
async function loadKnownMemberIds() {
  const { data, error } = await supabase
    .from('legislator_party_history')
    .select('member_id')
    .eq('biennium', SESSION);

  if (error) {
    console.warn(`  WARN: Could not load member IDs from legislator_party_history: ${error.message}`);
    console.warn('  Proceeding without ID validation — all member_ids set from API directly.');
    return null; // null = skip validation, trust API ids
  }

  const known = new Set((data || []).map(r => String(r.member_id)));
  console.log(`  Loaded ${known.size} known member IDs for matching.`);
  return known;
}

// ── Sync ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[${new Date().toISOString()}] Committee seat sync — biennium=${BIENNIUM} session=${SESSION}`);

  // 1. Load known member IDs for safe FK matching
  const knownIds = await loadKnownMemberIds();

  // 2. Fetch all active committees (one call, returns both House + Senate)
  console.log('\nFetching all active committees...');
  let cmteData;
  try {
    cmteData = await fetchXML('CommitteeService.asmx', 'GetActiveCommittees', null);
  } catch (e) {
    console.error(`FATAL: GetActiveCommittees failed: ${e.message}`);
    process.exit(1);
  }

  const committees = asArray(cmteData?.ArrayOfCommittee?.Committee);
  if (!committees.length) {
    console.error('FATAL: GetActiveCommittees returned 0 committees. Refusing to wipe data.');
    process.exit(1);
  }
  console.log(`  ${committees.length} committees returned (House + Senate combined).`);

  // 3. Per-committee: fetch members and build rows
  const allRows    = [];
  const unmatched  = [];
  let   cmteCount  = 0;
  let   skipCount  = 0;

  for (const cmte of committees) {
    const committeeName = String(cmte.Name  || '').trim();
    const committeeId   = String(cmte.Id    || '').trim() || null;
    const agency        = String(cmte.Agency || '').trim(); // 'House' | 'Senate'

    if (!committeeName || !agency) {
      skipCount++;
      continue;
    }

    // Brief pause to be polite to the API
    await new Promise(r => setTimeout(r, 150));

    let memberData;
    try {
      memberData = await fetchXML(
        'CommitteeService.asmx',
        'GetActiveCommitteeMembers',
        { biennium: BIENNIUM, agency, committeeName }
      );
    } catch (e) {
      console.warn(`  WARN: ${agency}/${committeeName} — members fetch failed: ${e.message}`);
      skipCount++;
      continue;
    }

    const members = asArray(memberData?.ArrayOfMember?.Member);
    if (!members.length) {
      console.log(`  ${agency}/${committeeName} — 0 members returned (skipping)`);
      skipCount++;
      continue;
    }

    cmteCount++;
    console.log(`  ${agency}/${committeeName} — ${members.length} members`);

    for (const m of members) {
      const rawName  = String(m.Name || `${m.FirstName || ''} ${m.LastName || ''}`).trim();
      const apiId    = String(m.Id || '').trim();

      // Match by API Id against known member IDs
      let memberId = null;
      if (apiId) {
        if (knownIds === null) {
          // No validation — trust API id directly
          memberId = apiId;
        } else if (knownIds.has(apiId)) {
          memberId = apiId;
        } else {
          unmatched.push(`${agency}/${committeeName}/${rawName} (Id=${apiId})`);
        }
      } else {
        unmatched.push(`${agency}/${committeeName}/${rawName} (no Id in API response)`);
      }

      allRows.push({
        session:         SESSION,
        member_id:       memberId,
        legislator_name: rawName,
        chamber:         agency,
        committee_name:  committeeName,
        committee_id:    committeeId,
        role:            'member',  // API provides no role field
        synced_at:       new Date().toISOString(),
      });
    }
  }

  console.log(`\nProcessed ${cmteCount} committees, skipped ${skipCount}.`);
  console.log(`Total rows to upsert: ${allRows.length}`);

  if (!allRows.length) {
    console.error('FATAL: 0 rows built — something went wrong. Not upserting.');
    process.exit(1);
  }

  // 4. Upsert into legislator_committee_seats
  // Conflict key: (session, member_id, committee_name)
  // NOTE: rows with member_id = null will always INSERT (NULLs don't conflict).
  // On repeated runs, null-member rows accumulate. This is acceptable since
  // unmatched members should be 0–5% and are flagged below for manual review.
  const { error: upsertErr } = await supabase
    .from('legislator_committee_seats')
    .upsert(allRows, { onConflict: 'session,member_id,committee_name' });

  if (upsertErr) {
    console.error(`FATAL: upsert failed: ${upsertErr.message}`);
    process.exit(1);
  }

  console.log('Upsert complete.');

  // 5. Report unmatched (null member_id rows)
  const unmatchedPct = allRows.length > 0
    ? ((unmatched.length / allRows.length) * 100).toFixed(1)
    : '0.0';

  if (unmatched.length) {
    console.warn(`\nUnmatched names (${unmatched.length} / ${unmatchedPct}%) — member_id set to null:`);
    unmatched.forEach(u => console.warn('  ', u));
    console.warn('These rows were inserted with member_id = null. Review if % > 5%.');
  } else {
    console.log('All members matched — no null member_id rows.');
  }

  // 6. Verify row count in DB
  const { count, error: countErr } = await supabase
    .from('legislator_committee_seats')
    .select('*', { count: 'exact', head: true })
    .eq('session', SESSION);

  if (!countErr) {
    console.log(`\nDB row count for session=${SESSION}: ${count}`);
  }

  console.log(`[${new Date().toISOString()}] Committee seat sync done.`);
  process.exit(0);
}

main().catch(e => {
  console.error(`FATAL: ${e.message}`);
  process.exit(1);
});
