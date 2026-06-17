# ════════════════════════════════════════════════════════════════════
# Fix duplicate 7D.1 declarations in sync-v2.js
# The deploy-7D.2.ps1 patch added code that the repo already had.
# This removes the duplicates, then re-runs the historical syncs.
# ════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Col\vector-app'
$syncPath = Join-Path $repo 'app\lib\sync-v2.js'

Write-Host ''
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  Fixing duplicate declarations'            -ForegroundColor Cyan
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''

$sync = Get-Content -LiteralPath $syncPath -Raw

# ── FIX 1: Remove duplicate shortLegType / legislationType / introductionYear block ──
# The repo already has this at ~line 773. My patch added a second copy at ~line 781.
$dupBlock1 = @"

  // Phase 7D.1: Extract legislation_type from ShortLegislationType
  const shortLegType = (raw.ShortLegislationType?.ShortLegislationType || raw.ShortLegislationType || '').toString().toUpperCase();
  const legTypeMap = { B: 'bill', R: 'resolution', JR: 'joint_resolution', JM: 'joint_memorial', CR: 'concurrent_resolution', GA: 'gubernatorial_appointment', I: 'initiative' };
  const legislationType = legTypeMap[shortLegType] || null;

  // Phase 7D.1: introduction_year tagged by getAllBillsSummary
  const introductionYear = raw._introYear || null;

  const billRecord = {
"@

$keepBlock1 = @"

  const billRecord = {
"@

if ($sync.Contains($dupBlock1)) {
  $sync = $sync.Replace($dupBlock1, $keepBlock1)
  Write-Host '  Removed duplicate shortLegType/legislationType/introductionYear block' -ForegroundColor Green
} else {
  Write-Host '  Duplicate block 1 not found (may have different whitespace)' -ForegroundColor Yellow
  Write-Host '  Trying line-by-line removal...' -ForegroundColor Yellow

  # Fallback: remove individual duplicate lines
  $lines = $sync -split "`n"
  $seen = @{}
  $newLines = @()
  foreach ($line in $lines) {
    $trimmed = $line.Trim()
    # Skip exact duplicate declarations (keep the FIRST occurrence)
    if ($trimmed -match "^const shortLegType = " -or
        $trimmed -match "^const introductionYear = raw\._introYear" -or
        ($trimmed -match "^const legTypeMap = " -and $trimmed -match "bill.*resolution")) {
      if ($seen[$trimmed]) {
        Write-Host "    Removed duplicate: $($trimmed.Substring(0, [Math]::Min(60, $trimmed.Length)))..." -ForegroundColor DarkGray
        continue
      }
      $seen[$trimmed] = $true
    }
    # Skip duplicate comment lines for the duplicate block
    if ($trimmed -eq "// Phase 7D.1: Extract legislation_type from ShortLegislationType" -and $seen[$trimmed]) {
      continue
    }
    if ($trimmed -eq "// Phase 7D.1: Extract legislation_type from ShortLegislationType") {
      $seen[$trimmed] = $true
    }
    if ($trimmed -eq "// Phase 7D.1: introduction_year tagged by getAllBillsSummary" -and $seen[$trimmed]) {
      continue
    }
    if ($trimmed -eq "// Phase 7D.1: introduction_year tagged by getAllBillsSummary") {
      $seen[$trimmed] = $true
    }
    $newLines += $line
  }
  $sync = $newLines -join "`n"
  Write-Host '  Line-by-line dedup done' -ForegroundColor Green
}

# ── FIX 2: Remove duplicate legislation_type / introduction_year in billRecord ──
# The repo already has these inside the billRecord object. My patch added them again
# right before updated_at.
$dupProps = @"
    legislation_type: legislationType,       // Phase 7D.1
    introduction_year: introductionYear,     // Phase 7D.1
    updated_at: new Date().toISOString(),
"@

$keepProps = @"
    updated_at: new Date().toISOString(),
"@

if ($sync.Contains($dupProps)) {
  $sync = $sync.Replace($dupProps, $keepProps)
  Write-Host '  Removed duplicate legislation_type/introduction_year from billRecord' -ForegroundColor Green
} else {
  Write-Host '  Duplicate properties not found with exact match — checking variants...' -ForegroundColor Yellow
  # Try with different spacing
  $dupProps2 = "    legislation_type: legislationType,       // Phase 7D.1`n    introduction_year: introductionYear,     // Phase 7D.1`n"
  if ($sync.Contains($dupProps2)) {
    $sync = $sync.Replace($dupProps2, "")
    Write-Host '  Removed duplicate properties (variant match)' -ForegroundColor Green
  } else {
    Write-Host '  [WARN] Could not find duplicate properties to remove' -ForegroundColor Yellow
    Write-Host '  The billRecord may have two copies of legislation_type/introduction_year' -ForegroundColor Yellow
    Write-Host '  This is harmless (JS object last-key-wins) but untidy' -ForegroundColor Yellow
  }
}

# ── WRITE FIXED FILE ──────────────────────────────────────────────
Set-Content -LiteralPath $syncPath -Value $sync -NoNewline
Write-Host ''

# ── VERIFY: Check no duplicate const declarations remain ──────────
Write-Host 'Verifying no duplicate declarations...'
$check = Get-Content -LiteralPath $syncPath -Raw
$shortLegCount = ([regex]::Matches($check, 'const shortLegType\s*=')).Count
$introYearCount = ([regex]::Matches($check, 'const introductionYear\s*=')).Count
$legTypeMapCount = ([regex]::Matches($check, 'const legTypeMap\s*=')).Count

if ($shortLegCount -eq 1 -and $introYearCount -eq 1 -and $legTypeMapCount -eq 1) {
  Write-Host "  All clean: shortLegType=$shortLegCount, introductionYear=$introYearCount, legTypeMap=$legTypeMapCount" -ForegroundColor Green
} else {
  Write-Host "  [WARN] Counts: shortLegType=$shortLegCount, introductionYear=$introYearCount, legTypeMap=$legTypeMapCount" -ForegroundColor Yellow
  Write-Host "  Each should be exactly 1. If not, manual edit needed." -ForegroundColor Yellow
  exit 1
}

# ── RE-RUN SYNCS ──────────────────────────────────────────────────
Write-Host ''
Write-Host 'Starting 2021-2022 re-sync...' -ForegroundColor Cyan

$env:CURRENT_BIENNIUM = '2021-22'
$env:CURRENT_YEAR     = '2022'
$env:SINE_DIE         = '2022-03-10'
$env:SESSION_START    = '2021-01-11'

Set-Location $repo
node app/lib/sync-v2.js
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [WARN] 2021-2022 sync exited with error' -ForegroundColor Yellow
}

Write-Host '  Fixing CARRY OVER -> DEAD for 2021-2022...'
node -e "require('dotenv').config(); const { createClient } = require('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); (async()=>{ const {data,error} = await sb.from('bills').update({confidence_label:'DEAD',pass_probability:0}).eq('session','2021-2022').eq('confidence_label','CARRY OVER'); console.log(error ? '  [WARN] ' + error.message : '  CARRY OVER -> DEAD done for 2021-2022'); })()"

Write-Host ''
Write-Host 'Starting 2023-2024 re-sync...' -ForegroundColor Cyan

$env:CURRENT_BIENNIUM = '2023-24'
$env:CURRENT_YEAR     = '2024'
$env:SINE_DIE         = '2024-03-07'
$env:SESSION_START    = '2023-01-09'

node app/lib/sync-v2.js
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [WARN] 2023-2024 sync exited with error' -ForegroundColor Yellow
}

Write-Host '  Fixing CARRY OVER -> DEAD for 2023-2024...'
node -e "require('dotenv').config(); const { createClient } = require('@supabase/supabase-js'); const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY); (async()=>{ const {data,error} = await sb.from('bills').update({confidence_label:'DEAD',pass_probability:0}).eq('session','2023-2024').eq('confidence_label','CARRY OVER'); console.log(error ? '  [WARN] ' + error.message : '  CARRY OVER -> DEAD done for 2023-2024'); })()"

Remove-Item env:CURRENT_BIENNIUM -ErrorAction SilentlyContinue
Remove-Item env:CURRENT_YEAR -ErrorAction SilentlyContinue
Remove-Item env:SINE_DIE -ErrorAction SilentlyContinue
Remove-Item env:SESSION_START -ErrorAction SilentlyContinue

Write-Host ''
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  Fix + re-sync complete'                    -ForegroundColor Green
Write-Host '══════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Run the verification queries from the previous script output.' -ForegroundColor White
Write-Host ''
