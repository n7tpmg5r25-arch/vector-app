#!/usr/bin/env node
/**
 * VECTOR | WA — Phase 11.9 (2026-04-21) category rebaseline shadow dry-run.
 * scripts/shadow-rescore-categories.js
 *
 * WHAT: Runs the detectCategoryByCommittee() fallback (newly added to
 * app/lib/sync-v2.js in Phase 11.9) against every bill in the live DB that
 * currently carries category='Other', and reports how many would be re-tagged
 * if the fallback were applied. DOES NOT WRITE. A true shadow pass.
 *
 * WHY: detectCategory() has been title-only in HEAD since the helper sketched
 * in Phase 6C.3 fell out of the tree. 29.5% of current-session bills land in
 * 'Other' as a result — mostly because the title uses procedural phrasing
 * ("Concerning..." / "An act relating to...") that misses every keyword list.
 * Adding a committee-based fallback recovers most of them.
 *
 * The nightly sync writes the refined categories automatically once this
 * PR lands — during interim it only writes if the comparator sees a diff,
 * which it now does because Phase 11.9 added `category` to the material-diff
 * check at sync-v2.js:~1362. One-shot heal, then the comparator goes quiet.
 *
 * HISTORICAL BIENNIA: Nightly sync only touches the current biennium (2025-26)
 * plus 2027-28 once that sync step un-gates on 2026-12-01. Historical bills
 * (2023-24, 2021-22) are NOT rewritten by nightly. Heal those via direct SQL
 * UPDATE (see the commented-out block near the bottom of this file) — but
 * only AFTER eyeballing the dry-run output and agreeing the deltas look sane.
 *
 * USAGE:
 *   node scripts/shadow-rescore-categories.js               # all biennia, dry-run
 *   node scripts/shadow-rescore-categories.js --session=2025-2026   # one biennium
 *
 * There is intentionally no --apply flag. This script is observational only.
 * The application path is the nightly sync. If you need to write directly,
 * see the SQL block at the bottom of this file.
 *
 * Dependencies: reads SUPABASE_URL, SUPABASE_SERVICE_KEY from .env.
 *
 * Reference: CATEGORY_REGRESSION_FINDINGS.md, SPRINT_2WEEK_PLAN.md Thread 6.
 */

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const argv = process.argv.slice(2)
const SESSION_FILTER = (argv.find(a => a.startsWith('--session=')) || '').split('=')[1] || null

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// Mirror of detectCategoryByCommittee() in app/lib/sync-v2.js. Keep in sync
// if the helper ever changes. Order matters — first match wins.
function detectCategoryByCommittee(committee = '') {
  if (!committee) return 'Other'
  const c = committee.toLowerCase()
  if (/ways & means|appropriations|finance|capital budget/.test(c)) return 'Budget / Appropriations'
  if (/law & justice|civil rights & judiciary|community safety|public safety/.test(c)) return 'Criminal Justice'
  if (/health|long-term care|human services/.test(c)) return 'Health'
  if (/education|early learning|k-12|postsecondary|higher education|workforce/.test(c)) return 'Education'
  if (/environment|energy/.test(c)) return 'Environment'
  if (/natural resources|fish|wildlife/.test(c)) return 'Natural Resources'
  if (/agriculture|agricultur/.test(c)) return 'Agriculture'
  if (/housing/.test(c)) return 'Housing'
  if (/transportation/.test(c)) return 'Transportation'
  if (/labor/.test(c)) return 'Employment / Labor'
  if (/business|commerce|consumer protection|trade|economic development/.test(c)) return 'Business / Commerce'
  if (/technology/.test(c)) return 'Technology'
  if (/veteran/.test(c)) return 'Veterans / Military'
  if (/local government|state government|tribal|elections/.test(c)) return 'Government Operations'
  return 'Other'
}

async function loadOtherBills() {
  const all = []
  let page = 0
  const PAGE = 1000
  while (true) {
    let q = supabase
      .from('bills')
      .select('bill_id, session, category, committee_name, title')
      .eq('category', 'Other')
      .range(page * PAGE, (page + 1) * PAGE - 1)
    if (SESSION_FILTER) q = q.eq('session', SESSION_FILTER)
    const { data, error } = await q
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE) break
    page++
  }
  return all
}

async function main() {
  const bills = await loadOtherBills()
  const scope = SESSION_FILTER ? `session=${SESSION_FILTER}` : 'all biennia'
  console.log(`\nShadow dry-run — Phase 11.9 category rebaseline (${scope})`)
  console.log(`Loaded ${bills.length} bills currently tagged 'Other'\n`)

  const bySession = new Map()            // session -> { changed, stayedOther, total }
  const byNewCategory = new Map()        // new category -> count
  const byCommitteeStillOther = new Map() // committee_name -> count (why they stayed Other)

  for (const b of bills) {
    const newCat = detectCategoryByCommittee(b.committee_name || '')
    const slot = bySession.get(b.session) || { changed: 0, stayedOther: 0, total: 0 }
    slot.total++
    if (newCat !== 'Other') slot.changed++
    else slot.stayedOther++
    bySession.set(b.session, slot)

    byNewCategory.set(newCat, (byNewCategory.get(newCat) || 0) + 1)

    if (newCat === 'Other') {
      const key = b.committee_name || '(empty)'
      byCommitteeStillOther.set(key, (byCommitteeStillOther.get(key) || 0) + 1)
    }
  }

  console.log('Per-session rescue count:')
  for (const [session, slot] of [...bySession.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const pct = (100 * slot.changed / slot.total).toFixed(1)
    console.log(`  ${session}: ${slot.changed} rescued, ${slot.stayedOther} still Other, ${slot.total} total  (${pct}% recovery)`)
  }

  console.log('\nNew category distribution (destination of rescued bills):')
  for (const [cat, n] of [...byNewCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat.padEnd(28)} ${n}`)
  }

  console.log('\nTop committees whose bills will still be Other (need future investigation):')
  const top = [...byCommitteeStillOther.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  for (const [cmte, n] of top) {
    console.log(`  ${cmte.padEnd(42)} ${n}`)
  }

  console.log('\nNo writes performed. Production path is the next nightly sync.')
}

main().catch(err => { console.error(err); process.exit(1) })

/*
 * HISTORICAL BIENNIUM HEAL — direct SQL (run only after agreeing on the
 * dry-run above). The nightly sync does not touch 2023-2024 or 2021-2022.
 * Uncomment, paste into Supabase SQL editor (or execute via MCP) to apply.
 *
 * -- Preview first
 * SELECT session, old_category, new_category, count(*) FROM (
 *   SELECT session, category AS old_category,
 *     CASE
 *       WHEN committee_name = '' OR committee_name IS NULL THEN 'Other'
 *       WHEN committee_name ~* '(ways & means|appropriations|finance|capital budget)' THEN 'Budget / Appropriations'
 *       WHEN committee_name ~* '(law & justice|civil rights & judiciary|community safety|public safety)' THEN 'Criminal Justice'
 *       WHEN committee_name ~* '(health|long-term care|human services)' THEN 'Health'
 *       WHEN committee_name ~* '(education|early learning|k-12|postsecondary|higher education|workforce)' THEN 'Education'
 *       WHEN committee_name ~* '(environment|energy)' THEN 'Environment'
 *       WHEN committee_name ~* '(natural resources|fish|wildlife)' THEN 'Natural Resources'
 *       WHEN committee_name ~* '(agriculture)' THEN 'Agriculture'
 *       WHEN committee_name ~* '(housing)' THEN 'Housing'
 *       WHEN committee_name ~* '(transportation)' THEN 'Transportation'
 *       WHEN committee_name ~* '(labor)' THEN 'Employment / Labor'
 *       WHEN committee_name ~* '(business|commerce|consumer protection|trade|economic development)' THEN 'Business / Commerce'
 *       WHEN committee_name ~* '(technology)' THEN 'Technology'
 *       WHEN committee_name ~* '(veteran)' THEN 'Veterans / Military'
 *       WHEN committee_name ~* '(local government|state government|tribal|elections)' THEN 'Government Operations'
 *       ELSE 'Other'
 *     END AS new_category
 *   FROM public.bills
 *   WHERE category = 'Other' AND session IN ('2023-2024','2021-2022')
 * ) t
 * WHERE new_category <> old_category
 * GROUP BY session, old_category, new_category
 * ORDER BY session, count(*) DESC;
 *
 * -- Apply (only after reviewing the preview)
 * -- UPDATE public.bills
 * -- SET category = <the CASE expression above>
 * -- WHERE category = 'Other'
 * --   AND session IN ('2023-2024','2021-2022')
 * --   AND <the CASE expression above> <> 'Other';
 */
