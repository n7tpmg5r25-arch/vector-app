# Vector WA - Bulk backfill script
# Runs AI summaries and committee backfill until complete
# Usage: Open PowerShell and run:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\Col\Documents\Claude\Projects\Vector - WA\run-backfills.ps1"

$baseUrl = "https://skuedssejrbrxycgdcfw.supabase.co/functions/v1"

# Phase 5C.0: Edge functions now require a shared secret header.
# Set the FUNCTION_SECRET environment variable before running this script:
#   $env:FUNCTION_SECRET = "vwa_..."
if (-not $env:FUNCTION_SECRET) {
    Write-Host "ERROR: FUNCTION_SECRET environment variable is not set." -ForegroundColor Red
    Write-Host "Set it with: `$env:FUNCTION_SECRET = 'vwa_...'" -ForegroundColor Yellow
    exit 1
}
$headers = @{ "x-function-secret" = $env:FUNCTION_SECRET }

Write-Host ""
Write-Host "=== PHASE 1: AI Summaries ===" -ForegroundColor Cyan
$totalSummarized = 0
$calls = 0
$maxCalls = 80

while ($calls -lt $maxCalls) {
    $calls++
    Write-Host "  Call $calls... " -NoNewline
    try {
        $response = Invoke-RestMethod -Uri "$baseUrl/summarize-bills" -Method Get -TimeoutSec 180 -Headers $headers
        $count = $response.summarized
        $totalSummarized += $count
        Write-Host "$count bills summarized (total: $totalSummarized)" -ForegroundColor Green

        if ($count -eq 0 -or $response.remaining -eq 0) {
            Write-Host "  All summaries complete!" -ForegroundColor Yellow
            break
        }
        Start-Sleep -Seconds 2
    }
    catch {
        Write-Host "Error: $_" -ForegroundColor Red
        Write-Host "  Waiting 10 seconds and retrying..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
    }
}

Write-Host ""
Write-Host "=== PHASE 2: Committee Backfill ===" -ForegroundColor Cyan
$totalCommittees = 0
$calls = 0
$maxCalls = 100

while ($calls -lt $maxCalls) {
    $calls++
    Write-Host "  Call $calls... " -NoNewline
    try {
        $response = Invoke-RestMethod -Uri "$baseUrl/backfill-committees" -Method Get -TimeoutSec 120 -Headers $headers
        $count = $response.updated
        $notFound = $response.not_found
        $totalCommittees += $count
        Write-Host "$count updated, $notFound not found (total: $totalCommittees)" -ForegroundColor Green

        if ($response.remaining -eq 0) {
            Write-Host "  All committees complete!" -ForegroundColor Yellow
            break
        }
        if ($count -eq 0 -and $notFound -eq $response.attempted) {
            Write-Host "  Remaining bills have no committee in API history - stopping." -ForegroundColor Yellow
            break
        }
        Start-Sleep -Seconds 1
    }
    catch {
        Write-Host "Error: $_" -ForegroundColor Red
        Write-Host "  Waiting 10 seconds and retrying..." -ForegroundColor Yellow
        Start-Sleep -Seconds 10
    }
}

Write-Host ""
Write-Host "=== DONE ===" -ForegroundColor Cyan
Write-Host "  AI summaries added: $totalSummarized"
Write-Host "  Committees added: $totalCommittees"
Write-Host ""
Read-Host "Press Enter to close"
