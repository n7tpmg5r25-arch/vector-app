#!/usr/bin/env node
/**
 * VECTOR | WA — Phase 11.6
 * scripts/scrape-csi.js
 *
 * Headless Playwright scraper for app.leg.wa.gov/CSI (Committee Sign-In).
 * Pulls pro / con / other sign-in counts per bill per hearing and upserts
 * into public.csi_sign_ins.
 *
 * DESCRIPTIVE-ONLY. scoreBill() does NOT read csi_sign_ins. Phase 11.7
 * (Jan 2027) flips the data into the UI. This script just starts laying
 * down the historical curve.
 *
 * CLI:
 *   node scripts/scrape-csi.js                       # nightly window (yesterday..today+1)
 *   node scripts/scrape-csi.js --days-back 14        # widen window (interim / catch-up)
 *   node scripts/scrape-csi.js --bill HB1294 --date 2026-01-22
 *   node scripts/scrape-csi.js --dry                 # scrape but don't write
 *
 * Env:
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY   (required)
 *   CURRENT_YEAR                          (defaults to current calendar year)
 *   CSI_BASE                              (default https://app.leg.wa.gov/csi)
 *
 * Breakage signal:
 *   Exits 0 always, but logs a row into csi_scrape_log with `ok=false` when
 *   > 50 % of expected sign-in pages returned zero counts. The nightly-sync
 *   workflow assertion step reads that row and fails loudly.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Playwright is a dev-time / CI-only dep. Require lazily so local runs that
// skip scraping (e.g. backtest against archive fixtures) don't force install.
function requirePlaywright() {
  try {
    return require('playwright');
  } catch (e) {
    throw new Error(
      'playwright not installed. Run `npm i -D playwright && npx playwright install chromium` at repo root.'
    );
  }
}

const CSI_BASE = process.env.CSI_BASE || 'https://app.leg.wa.gov/csi';
const YEAR = parseInt(process.env.CURRENT_YEAR || String(new Date().getUTCFullYear()), 10);
const SESSION = `${YEAR - 1}-${YEAR}`;

// ── CLI parsing (minimal, no dep) ─────────────────────────────────────────────
function argv(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}
const ARG_DRY = process.argv.includes('--dry');
const ARG_DAYS_BACK = parseInt(argv('--days-back', '2'), 10);
const ARG_DAYS_FWD = parseInt(argv('--days-forward', '1'), 10);
const ARG_BILL = argv('--bill', null);        // e.g. "HB 1294" or "HB1294"
const ARG_DATE = argv('--date', null);        // e.g. 2026-01-22

// ── Supabase client ───────────────────────────────────────────────────────────
function supa() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

// ── Targets: which (bill, date, committee) triples to scrape ──────────────────
// Pulled from committee_meetings + meeting_agenda_items (already synced by
// sync-meetings.js). We scrape hearings whose date falls inside the window.
async function listTargets(sb, { daysBack, daysFwd, bill, date }) {
  const today = new Date();
  const start = new Date(today.getTime() - daysBack * 864e5).toISOString().slice(0, 10);
  const end = new Date(today.getTime() + daysFwd * 864e5).toISOString().slice(0, 10);

  let q = sb
    .from('meeting_agenda_items')
    .select(`
      bill_id,
      committee_meetings!inner(
        id, committee_id, committee_name, chamber, meeting_date
      )
    `);

  if (bill) q = q.eq('bill_id', bill.replace(/\s+/g, ' ').trim());
  if (date) {
    q = q.eq('committee_meetings.meeting_date', date);
  } else {
    q = q
      .gte('committee_meetings.meeting_date', start)
      .lte('committee_meetings.meeting_date', end);
  }

  const { data, error } = await q;
  if (error) throw new Error(`listTargets: ${error.message}`);

  return (data || [])
    .filter(r => r.bill_id && r.committee_meetings?.meeting_date)
    .map(r => ({
      bill_id: r.bill_id,
      hearing_date: r.committee_meetings.meeting_date,
      committee_id: r.committee_meetings.committee_id,
      committee_name: r.committee_meetings.committee_name,
      chamber: r.committee_meetings.chamber,
    }));
}

// ── The actual Playwright scrape ─────────────────────────────────────────────
// NOTE on selectors: CSI is a server-rendered classic WebForms page. The
// sign-in summary table renders a row per bill with three numeric cells
// labeled Pro / Con / Other (a.k.a. "Other Position"). The exact DOM IDs are
// auto-generated and have historically churned between sessions, so we
// match by visible column headers first, then fall back to positional
// reads. All selector heuristics live in `extractCountsForBill()` — update
// there when CSI rev's its markup (expected every January).
async function scrapeOne(page, target) {
  const { bill_id, hearing_date, chamber } = target;
  const billNoSpaces = bill_id.replace(/\s+/g, '');
  const agency = (chamber || '').toLowerCase().startsWith('s') ? 'Senate' : 'House';

  // CSI search URL pattern (observed 2025-26 session):
  //   /CSI?Chamber=House&Year=2026&Bill=HB1294&Date=2026-01-22
  // The page responds with a results table listing each position and counts.
  const url = `${CSI_BASE}?Chamber=${encodeURIComponent(agency)}&Year=${YEAR}` +
              `&Bill=${encodeURIComponent(billNoSpaces)}&Date=${encodeURIComponent(hearing_date)}`;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // Wait for any results container OR a "no results" banner; whichever lands first.
  await page.waitForSelector('table, .no-results, [data-empty]', { timeout: 15000 }).catch(() => {});

  return await extractCountsForBill(page, bill_id);
}

async function extractCountsForBill(page, billId) {
  // The stable UX contract: a table or aggregate block shows labels
  // "Pro" / "Con" / "Other" alongside numeric counts. Everything else is
  // layout churn — we read by label, not by td index.
  //
  // Returns: { pro, con, other, found } — found=false means the page
  // loaded but no sign-in section matched; we record it as zero and let
  // the breakage assertion catch systemic failure.
  const result = await page.evaluate((bill) => {
    const txt = (el) => (el?.textContent || '').trim();
    const numFrom = (s) => {
      const m = String(s || '').match(/-?\d+/);
      return m ? parseInt(m[0], 10) : null;
    };

    // Strategy 1: labeled summary cells (`<*>Pro</*> ... <*>12</*>`)
    const labelMap = {};
    for (const el of document.querySelectorAll('td,th,span,div,li')) {
      const t = txt(el).toLowerCase();
      if (t === 'pro' || t === 'con' || t === 'other' || t === 'other position') {
        // Adjacent or next-cell numeric
        const sib = el.nextElementSibling;
        const parentRow = el.closest('tr');
        const rowNext = parentRow?.querySelectorAll('td,th');
        const candidates = [sib, ...(rowNext || [])].filter(Boolean);
        for (const c of candidates) {
          const n = numFrom(txt(c));
          if (n !== null) { labelMap[t.startsWith('other') ? 'other' : t] = n; break; }
        }
      }
    }
    if ('pro' in labelMap || 'con' in labelMap || 'other' in labelMap) {
      return {
        pro: labelMap.pro ?? 0,
        con: labelMap.con ?? 0,
        other: labelMap.other ?? 0,
        found: true,
        strategy: 'labeled',
      };
    }

    // Strategy 2: header-aligned columns (pos = header index)
    const tables = Array.from(document.querySelectorAll('table'));
    for (const tbl of tables) {
      const headers = Array.from(tbl.querySelectorAll('thead th, tr:first-child th'))
        .map(h => txt(h).toLowerCase());
      const iPro = headers.findIndex(h => h === 'pro');
      const iCon = headers.findIndex(h => h === 'con');
      const iOth = headers.findIndex(h => /^other/.test(h));
      if (iPro === -1 && iCon === -1 && iOth === -1) continue;

      // Find the row that mentions this bill number; else take the first data row.
      const rows = Array.from(tbl.querySelectorAll('tbody tr, tr'));
      const normBill = bill.replace(/\s+/g, '').toUpperCase();
      let row = rows.find(r => txt(r).replace(/\s+/g, '').toUpperCase().includes(normBill))
             || rows.find(r => r.querySelectorAll('td').length >= Math.max(iPro, iCon, iOth) + 1);
      if (!row) continue;
      const cells = row.querySelectorAll('td');
      return {
        pro:   iPro >= 0 ? (numFrom(txt(cells[iPro])) ?? 0) : 0,
        con:   iCon >= 0 ? (numFrom(txt(cells[iCon])) ?? 0) : 0,
        other: iOth >= 0 ? (numFrom(txt(cells[iOth])) ?? 0) : 0,
        found: true,
        strategy: 'table',
      };
    }

    return { pro: 0, con: 0, other: 0, found: false, strategy: 'none' };
  }, billId);

  return result;
}

// ── Upsert into Supabase ─────────────────────────────────────────────────────
async function upsertBatch(sb, rows) {
  if (!rows.length) return 0;
  const CHUNK = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await sb
      .from('csi_sign_ins')
      .upsert(slice, { onConflict: 'bill_id,hearing_date,committee_id' });
    if (error) throw new Error(`csi_sign_ins upsert: ${error.message}`);
    written += slice.length;
  }
  return written;
}

async function logRun(sb, summary) {
  const { error } = await sb.from('csi_scrape_log').insert(summary);
  if (error) console.warn('[csi_scrape_log insert failed]', error.message);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const sb = supa();
  const targets = await listTargets(sb, {
    daysBack: ARG_DAYS_BACK,
    daysFwd: ARG_DAYS_FWD,
    bill: ARG_BILL,
    date: ARG_DATE,
  });
  console.log(`CSI scrape: ${targets.length} targets (${SESSION}, window −${ARG_DAYS_BACK}d..+${ARG_DAYS_FWD}d, dry=${ARG_DRY})`);
  if (!targets.length) {
    await logRun(sb, {
      session: SESSION,
      hearings_expected: 0, hearings_scraped: 0,
      rows_with_zero: 0, rows_upserted: 0,
      ok: true, notes: 'no targets in window',
    });
    return;
  }

  const pw = requirePlaywright();
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; VectorWA-CSI-Scraper/1.0; +mailto:colin@shorepine.example)',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  const rows = [];
  let scraped = 0;
  let zeroRows = 0;
  let notFound = 0;

  for (const t of targets) {
    try {
      const r = await scrapeOne(page, t);
      scraped++;
      if (!r.found) notFound++;
      const isZero = (r.pro + r.con + r.other) === 0;
      if (isZero) zeroRows++;
      rows.push({
        bill_id: t.bill_id,
        hearing_date: t.hearing_date,
        committee_id: t.committee_id,
        pro_count: r.pro,
        con_count: r.con,
        other_count: r.other,
        source: 'scrape',
      });
      // Be polite — 250 ms between requests keeps us well under any rate ceiling.
      await page.waitForTimeout(250);
    } catch (e) {
      console.warn(`  [scrape fail] ${t.bill_id} ${t.hearing_date}: ${e.message}`);
    }
  }

  await browser.close();

  const written = ARG_DRY ? 0 : await upsertBatch(sb, rows);
  const zeroPct = targets.length ? (zeroRows / targets.length) : 0;
  const ok = zeroPct <= 0.5; // breakage threshold — plan step (5)

  console.log(
    `CSI scrape done: scraped=${scraped}/${targets.length} notFound=${notFound} ` +
    `zeroRows=${zeroRows} (${(zeroPct * 100).toFixed(1)}%) upserted=${written} dry=${ARG_DRY} ok=${ok}`
  );

  await logRun(sb, {
    session: SESSION,
    hearings_expected: targets.length,
    hearings_scraped: scraped,
    rows_with_zero: zeroRows,
    rows_upserted: written,
    ok,
    notes: ARG_DRY
      ? 'dry run, nothing written'
      : `notFound=${notFound}; zero_pct=${(zeroPct * 100).toFixed(1)}%`,
  });

  // We DO NOT exit nonzero here — the workflow assertion step inspects
  // csi_scrape_log and fails loudly so that retry logic stays in one place.
}

if (require.main === module) {
  main().catch(e => {
    console.error(e);
    // Intentional: don't fail the whole nightly job on a scraper blow-up.
    // The assertion step will catch a run of bad scrapes from csi_scrape_log.
    process.exit(0);
  });
}

module.exports = { extractCountsForBill, listTargets };
