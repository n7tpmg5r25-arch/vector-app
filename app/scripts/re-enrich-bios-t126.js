/**
 * Vector | WA — Re-enrich Legislator Bios (T126)
 *
 * Re-runs AI extraction for all legislators that already have raw_caucus_bio
 * stored in legislator_bios, using the updated edge function v3 which now
 * extracts leadership_role in addition to the existing fields.
 *
 * Run from C:\Users\Col\vector-app\app:
 *   node scripts/re-enrich-bios-t126.js
 *   node scripts/re-enrich-bios-t126.js --force   # re-run even if recently synced
 *
 * Env vars (from app/.env.local — same pattern as enrich-legislator-bios.js):
 *   NEXT_PUBLIC_SUPABASE_URL  or  SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *   FUNCTION_SECRET
 */

'use strict'
const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env.local') })
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') })
require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL    = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY    = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const FUNCTION_SECRET = process.env.FUNCTION_SECRET

if (!SUPABASE_URL)    { console.error('Missing SUPABASE_URL'); process.exit(1) }
if (!SUPABASE_KEY)    { console.error('Missing SUPABASE_SERVICE_KEY'); process.exit(1) }
if (!FUNCTION_SECRET) { console.error('Missing FUNCTION_SECRET'); process.exit(1) }

const supabase    = createClient(SUPABASE_URL, SUPABASE_KEY)
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/enrich-legislator-bios`
const DELAY_MS    = 600
const FORCE       = process.argv.includes('--force')

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  // 1. Fetch all bios with stored raw_caucus_bio
  console.log('Fetching legislators with stored raw_caucus_bio...')
  const { data: bios, error: biosErr } = await supabase
    .from('legislator_bios')
    .select('member_id, raw_caucus_bio, caucus_url, bio_last_synced_at, leadership_role')
    .not('raw_caucus_bio', 'is', null)

  if (biosErr) { console.error('DB error:', biosErr.message); process.exit(1) }
  console.log(`Found ${bios.length} legislators with bio text`)

  // 2. Fetch member names
  const { data: legRows, error: legErr } = await supabase
    .from('legislator_party_history')
    .select('member_id, full_name')
    .eq('biennium', '2025-2026')

  if (legErr) { console.error('Name fetch error:', legErr.message); process.exit(1) }
  const nameMap = Object.fromEntries(legRows.map(r => [r.member_id, r.full_name]))

  // 3. Re-enrich each
  let ok = 0, failed = 0, withRole = 0, skipped = 0
  const staleCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  for (let i = 0; i < bios.length; i++) {
    const b        = bios[i]
    const fullName = nameMap[b.member_id] || 'Unknown'
    const isStale  = !b.bio_last_synced_at || b.bio_last_synced_at < staleCutoff
    const noRole   = !b.leadership_role

    // Skip if recently synced and already has leadership_role (unless --force)
    if (!FORCE && !isStale && !noRole) {
      process.stdout.write(`[${i+1}/${bios.length}] ${fullName} — skip (fresh)\n`)
      skipped++
      continue
    }

    process.stdout.write(`[${i+1}/${bios.length}] ${fullName} (${b.member_id})...`)

    try {
      const resp = await fetch(EDGE_FN_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-function-secret': FUNCTION_SECRET },
        body:    JSON.stringify({
          member_id:  b.member_id,
          name:       fullName,
          bio_text:   b.raw_caucus_bio,
          caucus_url: b.caucus_url || '',
        }),
      })

      const result = await resp.json()
      if (!resp.ok) throw new Error(result.error || resp.status)

      if (result.leadership_role) {
        console.log(` OK  [ROLE: ${result.leadership_role}]`)
        withRole++
      } else {
        console.log(' OK')
      }
      ok++
    } catch (err) {
      console.log(` FAIL: ${err.message}`)
      failed++
    }

    await sleep(DELAY_MS)
  }

  console.log(`\n=== Done: ${ok} ok | ${failed} failed | ${skipped} skipped | ${withRole} with leadership role ===`)
}

main().catch(err => { console.error(err); process.exit(1) })
