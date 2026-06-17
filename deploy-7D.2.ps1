# ════════════════════════════════════════════════════════════════════
# Phase 7D.2 — Deploy v2.5 patches + re-sync historical sessions
# ════════════════════════════════════════════════════════════════════
#
# What this does:
#   1. Backs up sync-v2.js (timestamped .bak)
#   2. Patches 5 targeted changes for 7D.1 data integrity into the
#      EXISTING sync-v2.js (preserves all 7W companion features)
#   3. Re-syncs 2021-2022 biennium
#   4. Re-syncs 2023-2024 biennium
#
# Run from PowerShell:
#   cd C:\Users\Col\vector-app
#   Copy-Item "C:\Users\Col\Documents\Claude\Projects\Vector - WA\deploy-7D.2.ps1" .
#   .\deploy-7D.2.ps1
#
# Expected runtime: 30-60 minutes (the re-syncs hit the WA Legislature API)
# ════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Col\vector-app'
$syncPath = Join-Path $repo 'app\lib\sync-v2.js'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'

Write-Host ''
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  Phase 7D.2 — Data Integrity Patches'     -ForegroundColor Cyan
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $syncPath)) {
  Write-Host "[FAIL] sync-v2.js not found at: $syncPath" -ForegroundColor Red
  exit 1
}

# ── 1. BACKUP ──────────────────────────────────────────────────────
Write-Host 'Step 1/6  Backing up sync-v2.js'
Copy-Item -LiteralPath $syncPath "$syncPath.$stamp.bak"
Write-Host "  backup: $syncPath.$stamp.bak" -ForegroundColor DarkGray
Write-Host ''

$sync = Get-Content -LiteralPath $syncPath -Raw

# ── 2. PATCH: Governor-signed detection ────────────────────────────
Write-Host 'Step 2/6  Patching governor-signed detection'

$oldGovCheck = "const signedByGov = joined.includes('signed by governor') || joined.includes('effective date') || joined.includes('chaptered');"
$newGovCheck = @"
// Phase 7D.1 FIX: WSL API returns "Governor signed." not "signed by governor"
  // Old check missed bills without an "effective date" entry. Now matches both word orders + veto variants.
  const signedByGov = joined.includes('governor signed') || joined.includes('signed by governor') || joined.includes('effective date') || joined.includes('chaptered');
  const vetoedByGov = joined.includes('governor vetoed') || joined.includes('vetoed by governor');
  const partialVeto = joined.includes('governor partially vetoed') || joined.includes('partially vetoed by governor');

  // Phase 7D.1: governor_action — signed trumps partial_veto trumps vetoed
  let governorAction = null;
  if (signedByGov) governorAction = 'signed';
  if (partialVeto) governorAction = 'partial_veto';
  if (vetoedByGov && !partialVeto) governorAction = 'vetoed';
"@

if ($sync.Contains($oldGovCheck)) {
  $sync = $sync.Replace($oldGovCheck, $newGovCheck)
  Write-Host '  governor detection patched' -ForegroundColor Green
} elseif ($sync.Contains("joined.includes('governor signed')")) {
  Write-Host '  already patched (governor signed check present) — skipping' -ForegroundColor Yellow
} else {
  Write-Host '  [FAIL] could not find expected signedByGov line' -ForegroundColor Red
  Write-Host '  Expected: const signedByGov = joined.includes(''signed by governor'')...' -ForegroundColor Red
  exit 1
}

# ── 3. PATCH: Add governor_action to extractFeatures return ────────
Write-Host 'Step 3/6  Adding governor_action to features return'

$oldReturn = "    last_action: lastAction,  // Phase 5A: now populated"
$newReturn = @"
    last_action: lastAction,  // Phase 5A: now populated
    governor_action: governorAction,  // Phase 7D.1: signed/vetoed/partial_veto/null
"@

if ($sync.Contains($oldReturn)) {
  $sync = $sync.Replace($oldReturn, $newReturn)
  Write-Host '  governor_action added to features' -ForegroundColor Green
} elseif ($sync.Contains('governor_action: governorAction')) {
  Write-Host '  already patched — skipping' -ForegroundColor Yellow
} else {
  Write-Host '  [FAIL] could not find last_action return line' -ForegroundColor Red
  exit 1
}

# ── 4. PATCH: Add _introYear tagging in getAllBillsSummary ─────────
Write-Host 'Step 4/6  Adding introduction_year tagging'

$oldPush = "    all.push(...toArr(h), ...toArr(s));"
$newPush = @"
    // Phase 7D.1: Tag each bill with its introduction year
    const hArr = toArr(h).map(b => ({ ...b, _introYear: parseInt(yr) }));
    const sArr = toArr(s).map(b => ({ ...b, _introYear: parseInt(yr) }));
    all.push(...hArr, ...sArr);
"@

if ($sync.Contains($oldPush)) {
  $sync = $sync.Replace($oldPush, $newPush)
  Write-Host '  _introYear tagging added' -ForegroundColor Green
} elseif ($sync.Contains('_introYear')) {
  Write-Host '  already patched — skipping' -ForegroundColor Yellow
} else {
  Write-Host '  [FAIL] could not find all.push line in getAllBillsSummary' -ForegroundColor Red
  exit 1
}

# ── 5. PATCH: Add legislation_type + introduction_year to bill record,
#       and outcome_passed_law/outcome_passed_chamber after scoring ──
Write-Host 'Step 5/6  Adding legislation_type, introduction_year, outcome columns'

# 5a: Add legislation_type extraction before the bill record
$oldBillRecord = "  const billRecord = {"
$newBillRecord = @"
  // Phase 7D.1: Extract legislation_type from ShortLegislationType
  const shortLegType = (raw.ShortLegislationType?.ShortLegislationType || raw.ShortLegislationType || '').toString().toUpperCase();
  const legTypeMap = { B: 'bill', R: 'resolution', JR: 'joint_resolution', JM: 'joint_memorial', CR: 'concurrent_resolution', GA: 'gubernatorial_appointment', I: 'initiative' };
  const legislationType = legTypeMap[shortLegType] || null;

  // Phase 7D.1: introduction_year tagged by getAllBillsSummary
  const introductionYear = raw._introYear || null;

  const billRecord = {
"@

if ($sync.Contains($oldBillRecord)) {
  # Only replace the FIRST occurrence (in processBill function)
  $idx = $sync.IndexOf($oldBillRecord)
  $sync = $sync.Substring(0, $idx) + $newBillRecord + $sync.Substring($idx + $oldBillRecord.Length)
  Write-Host '  legislation_type extraction added' -ForegroundColor Green
} elseif ($sync.Contains('legislationType')) {
  Write-Host '  already patched — skipping' -ForegroundColor Yellow
} else {
  Write-Host '  [FAIL] could not find billRecord opening' -ForegroundColor Red
  exit 1
}

# 5b: Add the new columns to the bill record object
$oldUpdatedAt = "    updated_at: new Date().toISOString(),"
$newUpdatedAt = @"
    legislation_type: legislationType,       // Phase 7D.1
    introduction_year: introductionYear,     // Phase 7D.1
    updated_at: new Date().toISOString(),
"@

if ($sync.Contains($oldUpdatedAt)) {
  $idx = $sync.IndexOf($oldUpdatedAt)
  $sync = $sync.Substring(0, $idx) + $newUpdatedAt + $sync.Substring($idx + $oldUpdatedAt.Length)
  Write-Host '  legislation_type + introduction_year added to bill record' -ForegroundColor Green
} elseif ($sync.Contains('legislation_type: legislationType')) {
  Write-Host '  already patched — skipping' -ForegroundColor Yellow
} else {
  Write-Host '  [FAIL] could not find updated_at line in bill record' -ForegroundColor Red
  exit 1
}

# 5c: Add outcome_passed_law / outcome_passed_chamber after scoring
$oldOutcomeLabel = "  // Outcome label"
$newOutcomeLabel = @"
  // Phase 7D.1: Always set outcome booleans from stage (was previously a one-time backfill)
  billRecord.outcome_passed_chamber = billRecord.stage >= 4;
  billRecord.outcome_passed_law = billRecord.stage >= 6;

  // Outcome label
"@

if ($sync.Contains($oldOutcomeLabel)) {
  $idx = $sync.IndexOf($oldOutcomeLabel)
  $sync = $sync.Substring(0, $idx) + $newOutcomeLabel + $sync.Substring($idx + $oldOutcomeLabel.Length)
  Write-Host '  outcome_passed_law + outcome_passed_chamber added' -ForegroundColor Green
} elseif ($sync.Contains('outcome_passed_law = billRecord.stage >= 6')) {
  Write-Host '  already patched — skipping' -ForegroundColor Yellow
} else {
  Write-Host '  [FAIL] could not find "// Outcome label" comment' -ForegroundColor Red
  exit 1
}

# ── WRITE PATCHED FILE ────────────────────────────────────────────
Set-Content -LiteralPath $syncPath -Value $sync -NoNewline
Write-Host ''
Write-Host '  sync-v2.js patched successfully' -ForegroundColor Green
Write-Host ''

# ── 6. RE-SYNC HISTORICAL SESSIONS ────────────────────────────────
Write-Host 'Step 6/6  Re-syncing historical sessions'
Write-Host ''
Write-Host '  Starting 2021-2022 re-sync (expect 10-20 minutes)...' -ForegroundColor Cyan

$env:CURRENT_BIENNIUM = '2021-22'
$env:CURRENT_YEAR     = '2022'
$env:SINE_DIE         = '2022-03-10'
$env:SESSION_START    = '2021-01-11'

Set-Location $repo
node app/lib/sync-v2.js
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [WARN] 2021-2022 sync exited with error' -ForegroundColor Yellow
}

# Fix: The sync labels stage 4-5 as CARRY OVER, but these bienniums are
# concluded — nothing carries over. Convert to DEAD.
Write-Host '  Fixing CARRY OVER -> DEAD for 2021-2022 (concluded biennium)...'
node -e "require('dotenv').config(); const { createClient } = require('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); (async()=>{ const {data,error} = await sb.from('bills').update({confidence_label:'DEAD',pass_probability:0}).eq('session','2021-2022').eq('confidence_label','CARRY OVER'); console.log(error ? '  [WARN] ' + error.message : '  CARRY OVER -> DEAD done for 2021-2022'); })()"

Write-Host ''
Write-Host '  Starting 2023-2024 re-sync (expect 10-20 minutes)...' -ForegroundColor Cyan

$env:CURRENT_BIENNIUM = '2023-24'
$env:CURRENT_YEAR     = '2024'
$env:SINE_DIE         = '2024-03-07'
$env:SESSION_START    = '2023-01-09'

node app/lib/sync-v2.js
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [WARN] 2023-2024 sync exited with error' -ForegroundColor Yellow
}

Write-Host '  Fixing CARRY OVER -> DEAD for 2023-2024 (concluded biennium)...'
node -e "require('dotenv').config(); const { createClient } = require('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); (async()=>{ const {data,error} = await sb.from('bills').update({confidence_label:'DEAD',pass_probability:0}).eq('session','2023-2024').eq('confidence_label','CARRY OVER'); console.log(error ? '  [WARN] ' + error.message : '  CARRY OVER -> DEAD done for 2023-2024'); })()"

# Clear the env overrides so nightly sync uses defaults
Remove-Item env:CURRENT_BIENNIUM -ErrorAction SilentlyContinue
Remove-Item env:CURRENT_YEAR -ErrorAction SilentlyContinue
Remove-Item env:SINE_DIE -ErrorAction SilentlyContinue
Remove-Item env:SESSION_START -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  Phase 7D.2 complete'                      -ForegroundColor Green
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Paste these queries into the Supabase SQL editor to verify:' -ForegroundColor White
Write-Host ''
Write-Host @"

-- 7D.2 VERIFICATION QUERIES
-- Run each one in the Supabase SQL Editor

-- 1. LAW counts by session (compare against pre-sync baseline)
SELECT session, confidence_label, COUNT(*)
FROM bills
WHERE confidence_label = 'LAW'
GROUP BY session, confidence_label
ORDER BY session;

-- 2. Governor action distribution
SELECT session, governor_action, COUNT(*)
FROM bills
WHERE stage = 6
GROUP BY session, governor_action
ORDER BY session, governor_action;

-- 3. Introduction year populated?
SELECT session, introduction_year, COUNT(*)
FROM bills
GROUP BY session, introduction_year
ORDER BY session, introduction_year;

-- 4. Legislation type breakdown (bills vs non-bills)
SELECT session, legislation_type, COUNT(*), COUNT(*) FILTER (WHERE stage = 6) as laws
FROM bills
GROUP BY session, legislation_type
ORDER BY session, legislation_type;

-- 5. Any stage-5 bills with governor text? (should be 0 now)
SELECT session, bill_number, stage, last_action
FROM bills
WHERE stage = 5 AND last_action ILIKE '%governor%';

"@ -ForegroundColor DarkGray
Write-Host 'Send me the results and I''ll verify + update the implementation plan.' -ForegroundColor White
Write-Host ''
