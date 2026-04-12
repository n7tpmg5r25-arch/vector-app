# ════════════════════════════════════════════════════════════════════
# Phase 7U.2 — Run historical backfills for 2023-24 and 2021-22
# ════════════════════════════════════════════════════════════════════
# Prereqs:
#   - apply-7U-patches.ps1 has been run successfully
#   - C:\Users\Col\vector-app\app\.env.local has Supabase service role key
#
# What this does:
#   1. Smoke test: curl one 2021-22 bill from the WSL API
#   2. Backfill 2023-2024 (expect ~3,000-3,500 bills, 10-20 min)
#   3. Backfill 2021-2022 (expect ~3,000-3,500 bills, 10-20 min)
#   4. Print DB row counts for all three sessions
#
# Run from PowerShell:
#   cd C:\Users\Col\vector-app
#   .\run-7U.2-backfill.ps1
# ════════════════════════════════════════════════════════════════════

$ErrorActionPreference = 'Stop'
$repo = 'C:\Users\Col\vector-app'
Set-Location $repo

Write-Host ''
Write-Host '══════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host '  Phase 7U.2 — Historical backfill 2023-24 + 2021-22' -ForegroundColor Cyan
Write-Host '══════════════════════════════════════════════════' -ForegroundColor Cyan
Write-Host ''

# ── 1. WSL API smoke test ───────────────────────────────────────────
Write-Host 'Step 1/4  Smoke testing WSL API for biennium 2021-22...'
$smokeUrl = 'https://wslwebservices.leg.wa.gov/LegislationService.asmx/GetLegislationByYear?year=2021'
try {
  $resp = Invoke-WebRequest -Uri $smokeUrl -UseBasicParsing -TimeoutSec 30
  if ($resp.StatusCode -eq 200 -and $resp.Content.Length -gt 1000) {
    Write-Host "  WSL API OK ($($resp.Content.Length) bytes returned)" -ForegroundColor Green
  } else {
    Write-Host "  [FAIL] WSL API returned unexpected response" -ForegroundColor Red
    exit 1
  }
} catch {
  Write-Host "  [FAIL] WSL API unreachable: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
Write-Host ''

# ── 2. Backfill 2023-2024 ──────────────────────────────────────────
Write-Host 'Step 2/4  Running backfill for 2023-2024...' -ForegroundColor Cyan
Write-Host '          (expect 10-20 minutes for ~3,000 bills)' -ForegroundColor DarkGray
$env:CURRENT_BIENNIUM = '2023-24'
$env:CURRENT_YEAR     = '2024'
$env:SESSION_START    = '2023-01-09'
$env:SINE_DIE         = '2024-03-07'
$env:COMMITTEE_CUTOFF = '2024-01-31'
$env:FLOOR_CUTOFF     = '2024-02-13'
$env:OPPOSITE_CUTOFF  = '2024-02-26'

node scripts/backfill-historical.js
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [FAIL] 2023-2024 backfill exited non-zero' -ForegroundColor Red
  Write-Host '         check output above and fix before continuing' -ForegroundColor Red
  exit 1
}
Write-Host '  2023-2024 backfill complete' -ForegroundColor Green
Write-Host ''

# ── 3. Backfill 2021-2022 ──────────────────────────────────────────
Write-Host 'Step 3/4  Running backfill for 2021-2022...' -ForegroundColor Cyan
Write-Host '          (expect 10-20 minutes for ~3,000 bills)' -ForegroundColor DarkGray
$env:CURRENT_BIENNIUM = '2021-22'
$env:CURRENT_YEAR     = '2022'
$env:SESSION_START    = '2021-01-11'
$env:SINE_DIE         = '2022-03-10'
$env:COMMITTEE_CUTOFF = '2022-02-03'
$env:FLOOR_CUTOFF     = '2022-02-15'
$env:OPPOSITE_CUTOFF  = '2022-02-28'

node scripts/backfill-historical.js
if ($LASTEXITCODE -ne 0) {
  Write-Host '  [FAIL] 2021-2022 backfill exited non-zero' -ForegroundColor Red
  exit 1
}
Write-Host '  2021-2022 backfill complete' -ForegroundColor Green
Write-Host ''

# ── 4. Clear env vars ──────────────────────────────────────────────
Remove-Item Env:\CURRENT_BIENNIUM -ErrorAction SilentlyContinue
Remove-Item Env:\CURRENT_YEAR     -ErrorAction SilentlyContinue
Remove-Item Env:\SESSION_START    -ErrorAction SilentlyContinue
Remove-Item Env:\SINE_DIE         -ErrorAction SilentlyContinue
Remove-Item Env:\COMMITTEE_CUTOFF -ErrorAction SilentlyContinue
Remove-Item Env:\FLOOR_CUTOFF     -ErrorAction SilentlyContinue
Remove-Item Env:\OPPOSITE_CUTOFF  -ErrorAction SilentlyContinue

Write-Host 'Step 4/4  Backfill phase complete'                   -ForegroundColor Green
Write-Host ''
Write-Host '══════════════════════════════════════════════════'    -ForegroundColor Cyan
Write-Host '  SPOT CHECK — run these in Supabase SQL editor'       -ForegroundColor Cyan
Write-Host '══════════════════════════════════════════════════'    -ForegroundColor Cyan
Write-Host ''
Write-Host '-- row counts by session'                              -ForegroundColor White
Write-Host 'SELECT session, COUNT(*) AS bills,'                    -ForegroundColor Gray
Write-Host "       COUNT(*) FILTER (WHERE confidence_label=''LAW'') AS laws," -ForegroundColor Gray
Write-Host "       COUNT(*) FILTER (WHERE confidence_label=''DEAD'') AS dead" -ForegroundColor Gray
Write-Host 'FROM bills GROUP BY session ORDER BY session;'         -ForegroundColor Gray
Write-Host ''
Write-Host '-- 10 random bills from 2023-2024'                     -ForegroundColor White
Write-Host "SELECT bill_id, chamber, title, stage, final_score, confidence_label" -ForegroundColor Gray
Write-Host "FROM bills WHERE session='2023-2024' ORDER BY random() LIMIT 10;"    -ForegroundColor Gray
Write-Host ''
Write-Host '-- 10 random bills from 2021-2022'                     -ForegroundColor White
Write-Host "SELECT bill_id, chamber, title, stage, final_score, confidence_label" -ForegroundColor Gray
Write-Host "FROM bills WHERE session='2021-2022' ORDER BY random() LIMIT 10;"    -ForegroundColor Gray
Write-Host ''
Write-Host '-- baseline snapshot counts (one per bill expected)'   -ForegroundColor White
Write-Host 'SELECT session, COUNT(*) FROM trajectory_snapshots'    -ForegroundColor Gray
Write-Host 'GROUP BY session ORDER BY session;'                    -ForegroundColor Gray
Write-Host ''
