#!/usr/bin/env node
/**
 * VECTOR | WA — Visual Hotfix Batch 1 (Fix C)
 * scripts/backfill-truncated-titles.js
 *
 * Fixes bills whose `title` column was clipped at 200 chars by the old
 * sync-v2.js:1096 `title.slice(0, 200)` bug. Prior to the 2026-04-18 fix,
 * any bill title longer than 200 chars (e.g. HB 1397 ending "mental hea")
 * was stored truncated. The fix stopped the bleeding; this script heals
 * the scar tissue.
 *
 * Strategy: bills.raw_data.summary.LongDescription (captured untouched on
 * every sync) holds the full original title. For any row where
 * length(title) = 200 AND the raw title is longer, overwrite title with
 * the raw value. No WA API call — purely local data repair.
 *
 * Safe to run multiple times. Idempotent: once title < 200 or title
 * already matches raw, the row is skipped.
 *
 * Usage:
 *   node scripts/backfill-truncated-titles.js           # dry run (default)
 *   node scripts/backfill-truncated-titles.js --apply   # actually write
 *
 * Dependencies: same as other scripts — reads SUPABASE_URL and
 * SUPABASE_SERVICE_KEY from .env.
 */

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const APPLY = process.argv.includes('--apply')

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  console.log(`[backfill-titles] mode: ${APPLY ? 'APPLY' : 'DRY RUN (use --apply to commit)'}`)

  // Pull all bills where the stored title is exactly 200 chars — those are
  // the rows most likely truncated. Some genuinely-200-char titles will be
  // caught too; the raw_data check below filters them out.
  let rows = []
  let page = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, bill_number, session, title, raw_data')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) { console.error(error); process.exit(1) }
    if (!data || data.length === 0) break
    rows = rows.concat(data.filter(r => (r.title || '').length === 200))
    if (data.length < PAGE_SIZE) break
    page++
  }

  console.log(`[backfill-titles] candidates with title length = 200: ${rows.length}`)

  let fixed = 0
  let skipped = 0
  let missing = 0
  const examples = []

  for (const row of rows) {
    const raw = row.raw_data?.summary || {}
    const fullTitle = raw.LongDescription || raw.ShortDescription || null
    if (!fullTitle) {
      missing++
      continue
    }
    if (fullTitle.length <= 200 || fullTitle === row.title) {
      // Not truncated (or already fixed)
      skipped++
      continue
    }

    // This row needs healing
    fixed++
    if (examples.length < 5) {
      examples.push({
        bill_id: row.bill_id,
        number: `${row.session}-${row.bill_number}`,
        old_tail: row.title.slice(-30),
        new_length: fullTitle.length,
        new_tail: fullTitle.slice(-30),
      })
    }

    if (APPLY) {
      const { error: upErr } = await supabase
        .from('bills')
        .update({ title: fullTitle })
        .eq('bill_id', row.bill_id)
      if (upErr) {
        console.error(`[backfill-titles] update failed for ${row.bill_id}:`, upErr.message)
      }
    }
  }

  console.log('')
  console.log(`[backfill-titles] summary`)
  console.log(`  fixed    : ${fixed}`)
  console.log(`  skipped  : ${skipped} (already correct)`)
  console.log(`  missing  : ${missing} (raw_data.summary has no description — needs re-sync)`)
  console.log('')
  console.log('Examples:')
  for (const ex of examples) {
    console.log(`  ${ex.number}  ...${ex.old_tail}  →  [${ex.new_length} chars] ...${ex.new_tail}`)
  }
  if (!APPLY && fixed > 0) {
    console.log('')
    console.log('Dry run. Re-run with --apply to write.')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
