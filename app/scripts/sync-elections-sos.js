/**
 * Vector | WA — WA SOS Election Results Sync (T126)
 *
 * Downloads certified general election results from WA Secretary of State,
 * aggregates county-level rows into statewide totals per candidate per race,
 * computes winner margin, matches to member_id by last name + district + chamber,
 * and upserts into legislator_elections.
 *
 * Run from C:\Users\Col\vector-app\app:
 *   node scripts/sync-elections-sos.js          # 2024 general
 *   node scripts/sync-elections-sos.js 2022     # 2022 general (Senate odd districts)
 *
 * Env vars (from app/.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL  or  SUPABASE_URL
 *   SUPABASE_SERVICE_KEY
 *
 * WA SOS CSV columns: Race, Candidate, Party, Votes, PercentageOfTotalVotes, JurisdictionName
 * Each row = one candidate's votes in one county. Must aggregate by Race+Candidate first.
 */

'use strict'
const path  = require('path')
const https = require('https')
const fs    = require('fs')
require('dotenv').config({ path: path.join(__dirname, '../.env.local') })
require('dotenv').config({ path: path.join(__dirname, '../../.env.local') })
require('dotenv').config()

const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL) { console.error('Missing SUPABASE_URL'); process.exit(1) }
if (!SUPABASE_KEY) { console.error('Missing SUPABASE_SERVICE_KEY'); process.exit(1) }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const YEAR = parseInt(process.argv[2] || '2024', 10)
const ELECTION_DATES = { 2024: '20241105', 2022: '20221108', 2020: '20201103' }
const electionDate = ELECTION_DATES[YEAR]
if (!electionDate) { console.error(`Unsupported year: ${YEAR}`); process.exit(1) }

const CSV_URL = `https://results.vote.wa.gov/results/${electionDate}/export/${electionDate}_legislative.csv`

// ── Download helper ───────────────────────────────────────────────────────────
function download(url) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const req = https.get(url, res => {
      // Follow one redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve).catch(reject)
      }
      res.on('data', c => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
  })
}

// ── CSV parser (handles quoted fields) ───────────────────────────────────────
function parseCsv(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  const headers = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim())

  return lines.slice(1).map(line => {
    const cols = []
    let cur = '', inQuote = false
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    cols.push(cur.trim())
    const row = {}
    headers.forEach((h, i) => { row[h] = (cols[i] || '').replace(/^"|"$/g, '').trim() })
    return row
  })
}

async function main() {
  // ── 1. Download + decode CSV ────────────────────────────────────────────────
  console.log(`Downloading ${YEAR} WA SOS legislative results...`)
  const rawBuf = await download(CSV_URL)

  // Detect encoding: WA SOS uses UTF-16 LE with BOM on some exports
  let csvText
  if (rawBuf[0] === 0xFF && rawBuf[1] === 0xFE) {
    console.log('Encoding: UTF-16 LE')
    csvText = rawBuf.slice(2).swap16 ? rawBuf.slice(2).toString('utf16le') : Buffer.from(rawBuf.slice(2)).toString('utf16le')
  } else if (rawBuf[0] === 0xFE && rawBuf[1] === 0xFF) {
    console.log('Encoding: UTF-16 BE')
    // Swap bytes
    const swapped = Buffer.alloc(rawBuf.length - 2)
    for (let i = 0; i < swapped.length; i += 2) { swapped[i] = rawBuf[i+3]; swapped[i+1] = rawBuf[i+2] }
    csvText = swapped.toString('utf16le')
  } else {
    console.log('Encoding: UTF-8')
    csvText = rawBuf.toString('utf-8').replace(/^﻿/, '') // strip UTF-8 BOM if present
  }

  const rows = parseCsv(csvText)
  console.log(`Total rows: ${rows.length}`)
  if (rows.length > 0) console.log('Columns:', Object.keys(rows[0]).join(' | '))

  // ── 2. Filter legislative races ─────────────────────────────────────────────
  const legRows = rows.filter(r => /State Representative|State Senator/i.test(r.Race || ''))
  console.log(`Legislative rows: ${legRows.length}`)
  if (legRows.length === 0) { console.error('No legislative rows found — check CSV format'); process.exit(1) }

  // ── 3. Aggregate county rows → statewide totals per race+candidate ──────────
  // CSV has one row per candidate per county — sum Votes across all jurisdictions
  const raceMap = {}   // race → { candidateName → { votes, party } }
  for (const row of legRows) {
    const race      = row.Race || ''
    const candidate = row.Candidate || ''
    const votes     = parseInt((row.Votes || '0').replace(/,/g, ''), 10) || 0
    const party     = row.Party || ''
    if (!race || !candidate || /write.?in/i.test(candidate)) continue

    if (!raceMap[race]) raceMap[race] = {}
    if (!raceMap[race][candidate]) raceMap[race][candidate] = { votes: 0, party }
    raceMap[race][candidate].votes += votes
  }
  console.log(`Distinct races: ${Object.keys(raceMap).length}`)

  // ── 4. Load legislators for name matching ───────────────────────────────────
  console.log('Fetching legislators from Supabase...')
  const { data: legsAll, error: legErr } = await supabase
    .from('legislator_party_history')
    .select('member_id, full_name, last_name, agency, district')
    .in('biennium', ['2025-2026', '2023-2024', '2021-2022'])

  if (legErr) { console.error('Leg fetch error:', legErr.message); process.exit(1) }

  // Build lookup: "house-1-duerr" → member_id
  const legLookup = {}
  for (const l of legsAll) {
    const key = `${l.agency.toLowerCase()}-${l.district}-${l.last_name.toLowerCase()}`
    if (!legLookup[key]) legLookup[key] = l.member_id
  }
  console.log(`Loaded ${legsAll.length} legislator records, ${Object.keys(legLookup).length} unique keys`)

  // ── 5. Build upsert rows ─────────────────────────────────────────────────────
  const upsertRows = []
  const unmatched  = []

  for (const [raceName, candidates] of Object.entries(raceMap)) {
    const agency   = /State Representative/i.test(raceName) ? 'House' : 'Senate'
    const distMatch = raceName.match(/District\s+(\d+)/i)
    if (!distMatch) continue
    const district = distMatch[1]

    // Sort by votes descending
    const sorted = Object.entries(candidates)
      .map(([name, d]) => ({ name, votes: d.votes, party: d.party }))
      .sort((a, b) => b.votes - a.votes)

    if (sorted.length === 0) continue

    const winner    = sorted[0]
    const runnerUp  = sorted[1] || null
    const total     = sorted.reduce((s, c) => s + c.votes, 0)
    const winnerPct = total > 0 ? Math.round((winner.votes / total) * 1000) / 10 : 0
    const ruPct     = (total > 0 && runnerUp) ? Math.round((runnerUp.votes / total) * 1000) / 10 : 0
    const margin    = Math.round((winnerPct - ruPct) * 1000) / 1000
    const unopposed = sorted.length === 1

    // Extract last name from winner (handles "Last, First" or "First Last")
    const lastName = /^(.+),\s*(.+)$/.test(winner.name)
      ? winner.name.split(',')[0].trim()
      : winner.name.trim().split(/\s+/).pop()

    const lookupKey = `${agency.toLowerCase()}-${district}-${lastName.toLowerCase()}`
    const memberId  = legLookup[lookupKey]

    if (!memberId) {
      unmatched.push(`${agency} ${district} — ${winner.name} (key: ${lookupKey})`)
      continue
    }

    upsertRows.push({
      member_id:      memberId,
      election_year:  YEAR,
      race_type:      'general',
      district,
      agency,
      candidate_name: winner.name,
      vote_pct:       winnerPct,
      margin_pct:     margin,
      opponent_name:  runnerUp ? runnerUp.name : null,
      total_votes:    total,
      unopposed,
      source:         'wa-sos',
    })
  }

  console.log(`\nMatched: ${upsertRows.length} | Unmatched: ${unmatched.length}`)
  if (unmatched.length > 0) {
    console.log('Unmatched races:')
    unmatched.forEach(u => console.log(`  ${u}`))
  }

  if (upsertRows.length === 0) { console.log('Nothing to upsert.'); return }

  // ── 6. Upsert ─────────────────────────────────────────────────────────────────
  console.log(`\nUpserting ${upsertRows.length} rows to legislator_elections...`)
  const { error: upsertErr } = await supabase
    .from('legislator_elections')
    .upsert(upsertRows, { onConflict: 'member_id,election_year,race_type' })

  if (upsertErr) { console.error('Upsert error:', upsertErr.message); process.exit(1) }

  console.log(`Done. ${upsertRows.length} election records upserted for ${YEAR}.`)
  if (YEAR === 2024) console.log('Run with arg 2022 to backfill odd-district Senate seats.')
}

main().catch(err => { console.error(err); process.exit(1) })
