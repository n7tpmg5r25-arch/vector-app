#!/usr/bin/env node
/**
 * VECTOR | WA — Phase 11.6
 * scripts/assert-csi-freshness.js
 *
 * Breakage-detection assertion for the CSI scraper. Reads the most recent
 * row of `csi_scrape_log` and fails (exit 1) if:
 *   • the scraper didn't run in the last 36 hours, OR
 *   • the scraper ran but > 50 % of expected sign-in pages returned zero
 *     counts (`ok=false` in the log row).
 *
 * Wired in via .github/workflows/nightly-sync.yml after scrape-csi.js.
 * Keeping the "did it work" decision in SQL lets a human inspect the log
 * table directly without grepping Actions output.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set');
    process.exit(1);
  }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const { data, error } = await sb
    .from('csi_scrape_log')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(1);
  if (error) { console.error(error.message); process.exit(1); }
  if (!data || !data.length) {
    console.error('✗ no csi_scrape_log rows — scraper never ran');
    process.exit(1);
  }
  const row = data[0];
  const ageHr = (Date.now() - new Date(row.ran_at).getTime()) / 36e5;

  console.log(`latest csi_scrape_log row: ran_at=${row.ran_at} (${ageHr.toFixed(1)}h ago)`);
  console.log(`  hearings_expected=${row.hearings_expected} scraped=${row.hearings_scraped} zero=${row.rows_with_zero} upserted=${row.rows_upserted} ok=${row.ok}`);

  if (ageHr > 36) {
    console.error(`✗ stale: last scrape was ${ageHr.toFixed(1)}h ago (> 36h)`);
    process.exit(1);
  }
  if (!row.ok) {
    console.error('✗ last scrape flagged ok=false (> 50 % zero-count hearings) — CSI markup likely changed');
    process.exit(1);
  }
  console.log('✓ CSI scraper healthy');
}

main().catch(e => { console.error(e); process.exit(1); });
