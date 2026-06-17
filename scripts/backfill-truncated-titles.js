#!/usr/bin/env node
/**
 * VECTOR | WA — Visual Hotfix Batch 1 (Fix C), v2
 * scripts/backfill-truncated-titles.js
 *
 * Fixes bills whose `title` column was clipped at 200 chars by the old
 * sync-v2.js:1096 `title.slice(0, 200)` bug. Prior to the 2026-04-18 fix,
 * any bill title longer than 200 chars (e.g. HB 2655 ending "at lea")
 * was stored truncated.
 *
 * NOTE on v1: initial backfill read from bills.raw_data.summary.LongDescription,
 * but that JSON holds the GetBillsSummary response which only has BillId /
 * BillNumber / Active / etc. — no descriptions. The full title only appears
 * in the separate GetLegislation endpoint, whose response isn't persisted.
 *
 * v2 therefore calls GetLegislation via the WSL SOAP-ish XML service the
 * same way sync-v2.js does. Per-bill API cost is one call — 197 total.
 *
 * Safe to run multiple times. Idempotent: once title < 200 OR the API
 * returns <= 200 char title, the row is skipped.
 *
 * Usage:
 *   node scripts/backfill-truncated-titles.js           # dry run (default)
 *   node scripts/backfill-truncated-titles.js --apply   # actually write
 *
 * Dependencies: reads SUPABASE_URL, SUPABASE_SERVICE_KEY, and WA_API_BASE
 * from .env.
 */

require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')
const xml2js = require('xml2js')

const APPLY = process.argv.includes('--apply')
const WA_BASE = process.env.WA_API_BASE || 'https://wslwebservices.leg.wa.gov'
const API_TIMEOUT_MS = 10000
const THROTTLE_MS = 150  // be polite to wsl

// ── session → biennium mapping (matches sync-v2.js) ──
function sessionToBiennium(session) {
  // '2025-2026' → '2025-26', '2023-2024' → '2023-24', etc.
  const [start, end] = session.split('-')
  return `${start}-${end.slice(-2)}`
}

// ── WSL API helper (mirrors sync-v2.js fetchXML / getLegislation) ──
async function fetchXML(service, endpoint, params) {
  const url = new URL(`${WA_BASE}/${service}/${endpoint}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS)
  try {
    const res = await fetch(url.toString(), { headers: { Accept: 'text/xml' }, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const text = await res.text()
    const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: true })
    return parser.parseStringPromise(text)
  } finally {
    clearTimeout(timeout)
  }
}

async function getLegislation(biennium, billNumber) {
  try {
    const data = await fetchXML('LegislationService.asmx', 'GetLegislation', { biennium, billNumber })
    const items = data?.ArrayOfLegislation?.Legislation
    const arr = Array.isArray(items) ? items : (items ? [items] : [])
    if (arr.length === 0) return null
    // Pick the most-advanced version (highest SubstituteVersion → EngrossedVersion)
    return arr.reduce((best, cur) => {
      const bestSub = parseInt(best.SubstituteVersion || '0')
      const curSub  = parseInt(cur.SubstituteVersion  || '0')
      const bestEng = parseInt(best.EngrossedVersion  || '0')
      const curEng  = parseInt(cur.EngrossedVersion   || '0')
      return (curSub > bestSub || (curSub === bestSub && curEng > bestEng)) ? cur : best
    })
  } catch (e) {
    return null
  }
}

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment')
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  console.log(`[backfill-titles] mode: ${APPLY ? 'APPLY' : 'DRY RUN (use --apply to commit)'}`)
  console.log(`[backfill-titles] WA API: ${WA_BASE}`)

  // Pull every bill with title length exactly 200. Some are genuine 200-char
  // titles; the API check below filters them.
  let rows = []
  let page = 0
  const PAGE_SIZE = 1000
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('bill_id, bill_number, session, title')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (error) { console.error(error); process.exit(1) }
    if (!data || data.length === 0) break
    rows = rows.concat(data.filter(r => (r.title || '').length === 200))
    if (data.length < PAGE_SIZE) break
    page++
  }

  console.log(`[backfill-titles] candidates with title length = 200: ${rows.length}`)
  console.log('')

  let fixed = 0
  let skipped = 0
  let apiMiss = 0
  let errored = 0
  const examples = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const biennium = sessionToBiennium(row.session)
    const legis = await getLegislation(biennium, row.bill_number)
    await new Promise(r => setTimeout(r, THROTTLE_MS))

    if (!legis) {
      apiMiss++
      if ((i + 1) % 20 === 0) console.log(`  [${i + 1}/${rows.length}] processed...`)
      continue
    }

    const fullTitle = legis.LongDescription || legis.ShortDescription || null
    if (!fullTitle) {
      apiMiss++
      continue
    }
    if (fullTitle.length <= 200 || fullTitle === row.title) {
      skipped++
      continue
    }

    fixed++
    if (examples.length < 5) {
      examples.push({
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
        console.error(`  [!] update failed for ${row.bill_id}:`, upErr.message)
        errored++
      }
    }

    if ((i + 1) % 20 === 0) console.log(`  [${i + 1}/${rows.length}] processed — ${fixed} fixed so far`)
  }

  console.log('')
  console.log('[backfill-titles] summary')
  console.log(`  fixed    : ${fixed}`)
  console.log(`  skipped  : ${skipped} (title <= 200 or already matches)`)
  console.log(`  api miss : ${apiMiss} (WSL returned nothing — try again later)`)
  console.log(`  errors   : ${errored}`)
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
