#!/usr/bin/env node
/**
 * VECTOR | WA — Phase 11.6
 * scripts/backtest-csi.js
 *
 * Backtest runner for the CSI scraper. Two modes:
 *
 *   --shape    Walks the last 30 days of 2025-26 hearings, scrapes each,
 *              asserts that ≥ 50 % return non-zero counts + at least one
 *              non-zero Pro AND one non-zero Con across the whole window.
 *              Writes results with source='archive' so they don't collide
 *              with nightly 'scrape' rows. Intended to be run once before
 *              wiring the scraper into nightly-sync.yml.
 *
 *   --fixtures  Reads tools/csi-fixtures.json (hand-picked hearings where
 *               Colin remembers the room) and checks the scraped counts
 *               against expected ranges. Use for regression on DOM churn.
 *
 * Does NOT alter scoring tables. rescore-all.js is not invoked.
 *
 * Usage:
 *   node scripts/backtest-csi.js --shape
 *   node scripts/backtest-csi.js --fixtures
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { extractCountsForBill } = require('./scrape-csi');

const CSI_BASE = process.env.CSI_BASE || 'https://app.leg.wa.gov/csi';
const YEAR = parseInt(process.env.CURRENT_YEAR || String(new Date().getUTCFullYear()), 10);
const SESSION = `${YEAR - 1}-${YEAR}`;

const MODE_SHAPE = process.argv.includes('--shape');
const MODE_FIXTURES = process.argv.includes('--fixtures');
if (!MODE_SHAPE && !MODE_FIXTURES) {
  console.error('usage: backtest-csi.js --shape | --fixtures');
  process.exit(1);
}

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function loadPlaywright() {
  const pw = require('playwright');
  const browser = await pw.chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; VectorWA-CSI-Backtest/1.0)',
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  return { browser, page };
}

function csiUrl({ chamber, date, bill }) {
  const agency = (chamber || '').toLowerCase().startsWith('s') ? 'Senate' : 'House';
  return `${CSI_BASE}?Chamber=${agency}&Year=${YEAR}` +
         `&Bill=${encodeURIComponent(bill.replace(/\s+/g, ''))}&Date=${encodeURIComponent(date)}`;
}

async function shapeBacktest() {
  const client = sb();
  const today = new Date();
  const start = new Date(today.getTime() - 30 * 864e5).toISOString().slice(0, 10);
  const end = today.toISOString().slice(0, 10);

  const { data: rows, error } = await client
    .from('meeting_agenda_items')
    .select(`
      bill_id,
      committee_meetings!inner(id, committee_id, committee_name, chamber, meeting_date)
    `)
    .gte('committee_meetings.meeting_date', start)
    .lte('committee_meetings.meeting_date', end);
  if (error) throw new Error(error.message);

  const targets = (rows || [])
    .filter(r => r.bill_id && r.committee_meetings?.meeting_date)
    .map(r => ({
      bill_id: r.bill_id,
      hearing_date: r.committee_meetings.meeting_date,
      committee_id: r.committee_meetings.committee_id,
      chamber: r.committee_meetings.chamber,
    }));

  console.log(`Shape backtest: ${targets.length} hearings from ${start} → ${end}`);
  const { browser, page } = await loadPlaywright();
  let hit = 0, zero = 0;
  let sawPro = false, sawCon = false;
  const out = [];
  for (const t of targets) {
    try {
      await page.goto(csiUrl({ chamber: t.chamber, date: t.hearing_date, bill: t.bill_id }), {
        waitUntil: 'domcontentloaded',
      });
      await page.waitForSelector('table, .no-results, [data-empty]', { timeout: 15000 }).catch(() => {});
      const r = await extractCountsForBill(page, t.bill_id);
      if (r.found) hit++;
      if ((r.pro + r.con + r.other) === 0) zero++;
      if (r.pro > 0) sawPro = true;
      if (r.con > 0) sawCon = true;
      out.push({
        bill_id: t.bill_id,
        hearing_date: t.hearing_date,
        committee_id: t.committee_id,
        pro_count: r.pro, con_count: r.con, other_count: r.other,
        source: 'archive',
      });
      await page.waitForTimeout(200);
    } catch (e) {
      console.warn('  ', t.bill_id, t.hearing_date, e.message);
    }
  }
  await browser.close();

  const zeroPct = targets.length ? zero / targets.length : 0;
  console.log(`  hit=${hit} zero=${zero} (${(zeroPct * 100).toFixed(1)}%)  sawPro=${sawPro} sawCon=${sawCon}`);

  // Write results with source='archive' so they don't mix with nightly scrape rows.
  if (out.length) {
    const { error: upErr } = await client.from('csi_sign_ins')
      .upsert(out, { onConflict: 'bill_id,hearing_date,committee_id' });
    if (upErr) console.warn('upsert:', upErr.message);
  }

  let ok = true;
  if (zeroPct > 0.5) { console.error('✗ > 50 % of hearings returned zero counts'); ok = false; }
  if (!sawPro || !sawCon) { console.error('✗ never saw a non-zero Pro AND Con — selectors likely wrong'); ok = false; }
  process.exit(ok ? 0 : 1);
}

async function fixturesBacktest() {
  const fixturesPath = path.join(__dirname, '..', 'tools', 'csi-fixtures.json');
  if (!fs.existsSync(fixturesPath)) {
    console.error(`No fixtures at ${fixturesPath}. Create it with entries like:`);
    console.error('  [{"bill_id":"HB 1589","hearing_date":"2025-01-21","chamber":"House",');
    console.error('    "pro":{"min":80,"max":200},"con":{"min":3,"max":40},"other":{"min":0,"max":20}}]');
    process.exit(1);
  }
  const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));
  const { browser, page } = await loadPlaywright();
  let fails = 0;
  for (const f of fixtures) {
    await page.goto(csiUrl({ chamber: f.chamber, date: f.hearing_date, bill: f.bill_id }), {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('table, .no-results, [data-empty]', { timeout: 15000 }).catch(() => {});
    const r = await extractCountsForBill(page, f.bill_id);
    const inRange = (n, r) => !r || (n >= (r.min ?? 0) && n <= (r.max ?? Infinity));
    const ok = inRange(r.pro, f.pro) && inRange(r.con, f.con) && inRange(r.other, f.other);
    const tag = ok ? '✓' : '✗';
    console.log(`${tag} ${f.bill_id} ${f.hearing_date}  pro=${r.pro} con=${r.con} other=${r.other}  (expected ${JSON.stringify({p:f.pro,c:f.con,o:f.other})})`);
    if (!ok) fails++;
  }
  await browser.close();
  if (fails) { console.error(`${fails} fixture(s) out of range`); process.exit(1); }
  console.log('✓ all fixtures within range');
}

(async () => {
  if (MODE_SHAPE) await shapeBacktest();
  else await fixturesBacktest();
})().catch(e => { console.error(e); process.exit(1); });
