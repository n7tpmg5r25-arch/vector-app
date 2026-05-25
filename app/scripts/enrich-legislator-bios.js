/**
 * Vector | WA — Legislator Bio Enrichment Script
 * Thread 113
 *
 * Scrapes WA legislative caucus websites for all 4 caucuses,
 * sends bio text to the enrich-legislator-bios Supabase edge function
 * (which calls Haiku + upserts to DB). ANTHROPIC_API_KEY stays in
 * Supabase edge function secrets — never needed locally.
 *
 * Run from repo root:
 *   cd app && node scripts/enrich-legislator-bios.js
 *
 * Required env vars (in app/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL   (browser-safe URL, doubles as edge fn base URL)
 *   SUPABASE_SERVICE_KEY       (or SUPABASE_SERVICE_ROLE_KEY)
 *   FUNCTION_SECRET            (x-function-secret header)
 *
 * Safe to re-run — edge function uses upsert, tracks bio_last_synced_at.
 * Pass --force to re-scrape all members even if recently synced.
 * Pass --member "Marko Liias" to enrich a single member.
 */

const { createClient } = require('@supabase/supabase-js')

require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') })

const SUPABASE_URL   = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const FUNCTION_SECRET = process.env.FUNCTION_SECRET

if (!SUPABASE_URL)     { console.error('Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL'); process.exit(1) }
if (!SUPABASE_KEY)     { console.error('Missing SUPABASE_SERVICE_KEY'); process.exit(1) }
if (!FUNCTION_SECRET)  { console.error('Missing FUNCTION_SECRET'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/enrich-legislator-bios`

const SESSION   = '2025-2026'
const STALE_DAYS = 30           // Re-scrape bios older than this
const DELAY_MS  = 1200          // Polite delay between HTTP requests
const MIN_CHARS = 200           // Too short = probably a 404/redirect page
const MAX_CHARS = 8000          // Too long = pulled nav/footer garbage

const FORCE  = process.argv.includes('--force')
const SINGLE = (() => {
  const idx = process.argv.indexOf('--member')
  return idx >= 0 ? process.argv[idx + 1] : null
})()

// ── URL resolution ────────────────────────────────────────────────────────────

function normalizeAccents(str) {
  // ñ → n, é → e, etc. so Saldaña → saldana
  return (str || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function toSlug(str) {
  return normalizeAccents(str)
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/\bjr\.?\b/gi, '')
    .replace(/\biii\b/gi, '')
    .replace(/\bii\b/gi, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// For House R subdomain: "Alex Ybarra" → "alexybarra" (no separator, no special chars)
function toNoSepSlug(str) {
  return normalizeAccents(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function nameParts(fullName) {
  const parts = (fullName || '').trim().split(/\s+/)
  const lastName  = parts[parts.length - 1]
  const firstName = parts[0]
  const fullSlug  = parts.map(toSlug).filter(Boolean).join('-')
  const lastSlug  = toSlug(lastName)
  const firstSlug = toSlug(firstName)
  const firstLastSlug = [firstSlug, lastSlug].filter(Boolean).join('-')
  // House R subdomain: "Alex Ybarra" → "alexybarra" (no hyphen, no special chars)
  const noSepSlug = toNoSepSlug(firstName) + toNoSepSlug(lastName)
  return { firstName, lastName, fullSlug, lastSlug, firstSlug, firstLastSlug, noSepSlug }
}

function caucusUrls(member) {
  const { fullSlug, lastSlug, firstSlug, firstLastSlug, noSepSlug } = nameParts(member.name)
  const { chamber, party } = member

  if (chamber === 'Senate' && party === 'D') {
    return [
      `https://senatedemocrats.wa.gov/${lastSlug}/biography/`,
      `https://senatedemocrats.wa.gov/${lastSlug}/`,
      `https://senatedemocrats.wa.gov/${fullSlug}/biography/`,
      `https://senatedemocrats.wa.gov/${fullSlug}/`,
      `https://senatedemocrats.wa.gov/${firstLastSlug}/biography/`,
      // leg.wa.gov static HTML fallback (Thread 116)
      `https://leg.wa.gov/senate/senators/Pages/${lastSlug}.aspx`,
      `https://leg.wa.gov/senate/senators/Pages/${firstLastSlug}.aspx`,
    ]
  }
  if (chamber === 'Senate' && party === 'R') {
    // Each senator has a personal subdomain on src.wastateleg.org — same pattern
    // as House R on houserepublicans.wa.gov. Previous src.wa.gov URLs were a React
    // SPA that returned nothing useful (Thread 137 fix).
    // Pattern: {firstnamelastname}.src.wastateleg.org/about/
    return [
      `https://${noSepSlug}.src.wastateleg.org/about/`,
      `https://${noSepSlug}.src.wastateleg.org/`,
      // Hyphenated slug fallback for any edge-case names
      `https://${firstLastSlug}.src.wastateleg.org/about/`,
      // leg.wa.gov static HTML last-resort fallback
      `https://leg.wa.gov/senate/senators/Pages/${lastSlug}.aspx`,
      `https://leg.wa.gov/senate/senators/Pages/${firstLastSlug}.aspx`,
    ]
  }
  if (chamber === 'House' && party === 'D') {
    return [
      `https://housedemocrats.wa.gov/members/${fullSlug}/`,
      `https://housedemocrats.wa.gov/members/${lastSlug}/`,
      `https://housedemocrats.wa.gov/members/${firstLastSlug}/`,
      `https://housedemocrats.wa.gov/member/${fullSlug}/`,
      // leg.wa.gov static HTML fallback (Thread 116)
      `https://leg.wa.gov/house/representatives/Pages/${lastSlug}.aspx`,
      `https://leg.wa.gov/house/representatives/Pages/${firstLastSlug}.aspx`,
    ]
  }
  if (chamber === 'House' && party === 'R') {
    // Each member has their own subdomain: alexybarra.houserepublicans.wa.gov
    return [
      `http://${noSepSlug}.houserepublicans.wa.gov/about/`,
      `http://${noSepSlug}.houserepublicans.wa.gov/`,
      // Fallbacks for edge cases (McEntire-style names already handled by toNoSepSlug)
      `https://houserepublicans.wa.gov/representatives/${lastSlug}/`,
      `https://houserepublicans.wa.gov/representatives/${fullSlug}/`,
      // leg.wa.gov static HTML fallback (Thread 116)
      `https://leg.wa.gov/house/representatives/Pages/${lastSlug}.aspx`,
      `https://leg.wa.gov/house/representatives/Pages/${firstLastSlug}.aspx`,
    ]
  }
  return []
}

// ── HTML → plain text ─────────────────────────────────────────────────────────

function stripHtml(str) {
  return str
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function extractBioText(html) {
  const contentPatterns = [
    /<(?:div|section)[^>]+class="[^"]*(?:entry-content|bio|biography|content|main-content|page-content)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/i,
    /<(?:article|main)[^>]*>([\s\S]*?)<\/(?:article|main)>/i,
    /<div[^>]+id="[^"]*(?:content|main|bio)[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ]

  // Check stripped text length, not raw HTML length — a structural div can
  // have 1500 bytes of nested tags but zero visible text after stripping.
  for (const pattern of contentPatterns) {
    const m = html.match(pattern)
    if (m && m[1]) {
      const stripped = stripHtml(m[1])
      if (stripped.length > 300) return stripped
    }
  }

  // Fall back to the full page
  return stripHtml(html)
}

// ── Fetch with fallback URLs ──────────────────────────────────────────────────

async function fetchBioPage(member) {
  const urls = caucusUrls(member)
  if (!urls.length) return null

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'VectorWA/1.0 (+https://vectorwa.com; legislative research)',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(12000),
      })

      if (!res.ok) continue

      const html = await res.text()
      const text = extractBioText(html)

      if (text.length < MIN_CHARS) continue

      return { url, text: text.slice(0, MAX_CHARS) }
    } catch {
      // Try next URL
    }
    await sleep(300)
  }

  return null
}

// ── Call edge function ────────────────────────────────────────────────────────

async function callEnrichEdgeFn(member, bioText, caucusUrl) {
  const res = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-function-secret': FUNCTION_SECRET,
    },
    body: JSON.stringify({
      member_id: member.member_id,
      name: member.name,
      bio_text: bioText,
      caucus_url: caucusUrl,
    }),
    signal: AbortSignal.timeout(20000),
  })

  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `Edge fn ${res.status}`)
  return data
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isStale(row) {
  if (!row?.bio_last_synced_at) return true
  const age = Date.now() - new Date(row.bio_last_synced_at).getTime()
  return age > STALE_DAYS * 24 * 60 * 60 * 1000
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\nVector | WA — Legislator Bio Enrichment`)
  console.log(`Edge function: ${EDGE_FN_URL}`)
  console.log(`Session: ${SESSION}`)
  console.log(`Mode: ${FORCE ? 'FORCE (re-scrape all)' : `incremental (stale > ${STALE_DAYS} days)`}`)
  if (SINGLE) console.log(`Single member: ${SINGLE}`)
  console.log('─'.repeat(50))

  // Load existing bios for staleness check
  const { data: existingBios } = await supabase
    .from('legislator_bios')
    .select('member_id, bio_last_synced_at')

  const bioMap = {}
  for (const row of existingBios || []) bioMap[row.member_id] = row

  // Load members from view
  let query = supabase
    .from('v_member_stats_by_session')
    .select('name, chamber, party, member_id')
    .eq('session', SESSION)
    .eq('currently_seated', true)

  if (SINGLE) query = query.ilike('name', `%${SINGLE}%`)

  const { data: members, error } = await query
  if (error) { console.error('Failed to load members:', error); process.exit(1) }

  console.log(`Loaded ${members.length} members from DB\n`)

  let processed = 0, skipped = 0, failed = 0, noPage = 0

  for (const member of members) {
    const existing = bioMap[member.member_id]

    if (!FORCE && !SINGLE && !isStale(existing)) {
      skipped++
      continue
    }

    process.stdout.write(`${member.name} (${member.chamber} ${member.party})... `)

    // Fetch bio page
    const result = await fetchBioPage(member)
    await sleep(DELAY_MS)

    if (!result) {
      console.log('✗ no page found')
      noPage++

      // Upsert minimal record so we know we tried (no edge fn call needed)
      await supabase.from('legislator_bios').upsert({
        member_id: member.member_id,
        caucus_url: null,
        raw_caucus_bio: null,
        bio_last_synced_at: new Date().toISOString(),
        haiku_model: null,
      }, { onConflict: 'member_id' })
      continue
    }

    // Call edge function (handles Haiku + DB upsert)
    try {
      const result2 = await callEnrichEdgeFn(member, result.text, result.url)
      const prio = (result2.priorities || []).slice(0, 3).join(', ')
      console.log(`✓  [${prio || 'no priorities'}]`)
      processed++
    } catch (err) {
      console.log(`✗ edge fn error: ${err.message}`)
      failed++
    }
  }

  console.log('\n' + '─'.repeat(50))
  console.log(`Done.`)
  console.log(`  Enriched:        ${processed}`)
  console.log(`  Skipped (fresh): ${skipped}`)
  console.log(`  No page:         ${noPage}`)
  console.log(`  Errors:          ${failed}`)

  if (noPage > 15 && !SINGLE) {
    console.warn(`\n⚠ WARNING: ${noPage} members had no caucus page found.`)
    console.warn(`  This may indicate a URL pattern change. Check caucusUrls() in the script.`)
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
