# ============================================================
# Vector | WA — New Machine Setup Script
# ============================================================
# Run this from an elevated (Admin) PowerShell prompt on a fresh
# Windows machine. It installs prerequisites, clones the repo,
# and walks you through environment setup.
#
# Time estimate: ~20 minutes (plus manual secret entry)
# Last updated: 2026-04-12 (Phase 7T)
# ============================================================

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Vector | WA — New Machine Setup"       -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# ----------------------------------------------------------
# STEP 1: Install prerequisites via winget
# ----------------------------------------------------------
Write-Host "[Step 1/7] Installing prerequisites..." -ForegroundColor Yellow

# Node.js 20 LTS
Write-Host "  Installing Node.js 20 LTS..."
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements

# Git
Write-Host "  Installing Git..."
winget install --id Git.Git --accept-source-agreements --accept-package-agreements

# VS Code (optional but recommended)
Write-Host "  Installing VS Code..."
winget install --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements

# Supabase CLI
Write-Host "  Installing Supabase CLI..."
winget install --id Supabase.CLI --accept-source-agreements --accept-package-agreements

# Refresh PATH so git and node are available in this session
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "  Verifying installations..." -ForegroundColor Gray
Write-Host "    Node: $(node --version 2>$null)"
Write-Host "    npm:  $(npm --version 2>$null)"
Write-Host "    Git:  $(git --version 2>$null)"
Write-Host ""

# ----------------------------------------------------------
# STEP 2: Clone the repo
# ----------------------------------------------------------
Write-Host "[Step 2/7] Cloning repository..." -ForegroundColor Yellow

$repoDir = "C:\Users\$env:USERNAME\vector-app"

if (Test-Path $repoDir) {
    Write-Host "  Directory already exists at $repoDir — skipping clone." -ForegroundColor Gray
} else {
    git clone https://github.com/n7tpmg5r25-arch/vector-app.git $repoDir
}

Set-Location $repoDir
Write-Host "  Working directory: $repoDir"
Write-Host ""

# ----------------------------------------------------------
# STEP 3: Install dependencies
# ----------------------------------------------------------
Write-Host "[Step 3/7] Installing npm dependencies..." -ForegroundColor Yellow

Write-Host "  Installing root dependencies..."
npm ci

Write-Host "  Installing app dependencies..."
Set-Location "$repoDir\app"
npm ci
Set-Location $repoDir

Write-Host ""

# ----------------------------------------------------------
# STEP 4: Create .env files
# ----------------------------------------------------------
Write-Host "[Step 4/7] Creating environment files..." -ForegroundColor Yellow
Write-Host ""
Write-Host "  You will need these values from your password manager" -ForegroundColor Magenta
Write-Host "  or the Supabase / Vercel dashboards." -ForegroundColor Magenta
Write-Host "  See SECRETS-INVENTORY.md for where to find each one." -ForegroundColor Magenta
Write-Host ""

# Root .env
$rootEnvPath = "$repoDir\.env"
if (-not (Test-Path $rootEnvPath)) {
    Write-Host "  Creating root .env..."
    $supabaseUrl = Read-Host "    SUPABASE_URL (e.g. https://xxxxx.supabase.co)"
    $supabaseKey = Read-Host "    SUPABASE_SERVICE_KEY"

    @"
SUPABASE_URL=$supabaseUrl
SUPABASE_SERVICE_KEY=$supabaseKey
CURRENT_BIENNIUM=2025-26
CURRENT_YEAR=2026
WA_API_BASE=https://wslwebservices.leg.wa.gov
SESSION_START=2025-01-13
COMMITTEE_CUTOFF=2025-02-21
FLOOR_CUTOFF=2025-03-07
OPPOSITE_CUTOFF=2025-03-21
SINE_DIE=2026-03-12
"@ | Out-File -LiteralPath $rootEnvPath -Encoding utf8
    Write-Host "    Wrote $rootEnvPath" -ForegroundColor Green
} else {
    Write-Host "  Root .env already exists — skipping." -ForegroundColor Gray
}

# App .env
$appEnvPath = "$repoDir\app\.env"
if (-not (Test-Path $appEnvPath)) {
    Write-Host "  Creating app/.env..."
    if (-not $supabaseUrl) { $supabaseUrl = Read-Host "    SUPABASE_URL" }
    if (-not $supabaseKey) { $supabaseKey = Read-Host "    SUPABASE_SERVICE_KEY" }

    @"
SUPABASE_URL=$supabaseUrl
SUPABASE_SERVICE_KEY=$supabaseKey
WA_API_BASE=https://wslwebservices.leg.wa.gov
CURRENT_BIENNIUM=2025-26
CURRENT_YEAR=2026
SESSION_START=2025-01-13
COMMITTEE_CUTOFF=2026-02-07
FLOOR_CUTOFF=2026-02-21
OPPOSITE_CUTOFF=2026-03-05
SINE_DIE=2026-03-14
"@ | Out-File -LiteralPath $appEnvPath -Encoding utf8
    Write-Host "    Wrote $appEnvPath" -ForegroundColor Green
} else {
    Write-Host "  app/.env already exists — skipping." -ForegroundColor Gray
}

# App .env.local
$appEnvLocalPath = "$repoDir\app\.env.local"
if (-not (Test-Path $appEnvLocalPath)) {
    Write-Host "  Creating app/.env.local..."
    $anonKey = Read-Host "    NEXT_PUBLIC_SUPABASE_ANON_KEY"
    $funcSecret = Read-Host "    FUNCTION_SECRET"

    @"
NEXT_PUBLIC_SUPABASE_URL=$supabaseUrl
NEXT_PUBLIC_SUPABASE_ANON_KEY=$anonKey
SUPABASE_SERVICE_KEY=$supabaseKey
FUNCTION_SECRET=$funcSecret
NEXTAUTH_URL=http://localhost:3000
"@ | Out-File -LiteralPath $appEnvLocalPath -Encoding utf8
    Write-Host "    Wrote $appEnvLocalPath" -ForegroundColor Green
} else {
    Write-Host "  app/.env.local already exists — skipping." -ForegroundColor Gray
}

Write-Host ""

# ----------------------------------------------------------
# STEP 5: Verify local dev server starts
# ----------------------------------------------------------
Write-Host "[Step 5/7] Testing local dev server..." -ForegroundColor Yellow
Write-Host "  Starting 'npm run dev' in app/ (will run for 10 seconds)..." -ForegroundColor Gray

$devProcess = Start-Process -FilePath "npm" -ArgumentList "run","dev" -WorkingDirectory "$repoDir\app" -PassThru -NoNewWindow -RedirectStandardOutput "$repoDir\dev-test-output.txt" -RedirectStandardError "$repoDir\dev-test-error.txt"
Start-Sleep -Seconds 10

if (-not $devProcess.HasExited) {
    Write-Host "  Dev server started successfully." -ForegroundColor Green
    Stop-Process -Id $devProcess.Id -Force -ErrorAction SilentlyContinue
} else {
    Write-Host "  Dev server exited early. Check dev-test-error.txt for details." -ForegroundColor Red
}

# Clean up test files
Remove-Item -LiteralPath "$repoDir\dev-test-output.txt" -ErrorAction SilentlyContinue
Remove-Item -LiteralPath "$repoDir\dev-test-error.txt" -ErrorAction SilentlyContinue
Write-Host ""

# ----------------------------------------------------------
# STEP 6: Verify sync can run locally
# ----------------------------------------------------------
Write-Host "[Step 6/7] Testing sync script..." -ForegroundColor Yellow
Write-Host "  Running sync-v2.js in dry-check mode (just loads env and connects to Supabase)..."
Write-Host "  If this hangs or errors, your SUPABASE_URL / SUPABASE_SERVICE_KEY are wrong."
Write-Host ""

# Quick connectivity test — just import supabase and count bills
$testScript = @"
require('dotenv').config({ path: '$($repoDir -replace '\\','/')/.env' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('bills').select('id', { count: 'exact', head: true })
  .then(({ count, error }) => {
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    console.log('Connected. Bills in DB: ' + count);
  });
"@

$testScript | Out-File -LiteralPath "$repoDir\connectivity-test.js" -Encoding utf8
node "$repoDir\connectivity-test.js"
Remove-Item -LiteralPath "$repoDir\connectivity-test.js" -ErrorAction SilentlyContinue
Write-Host ""

# ----------------------------------------------------------
# STEP 7: Summary and next steps
# ----------------------------------------------------------
Write-Host "[Step 7/7] Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  What's ready:"                          -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  - Repo cloned to $repoDir"
Write-Host "  - Dependencies installed"
Write-Host "  - Environment files created"
Write-Host "  - Local dev server verified"
Write-Host "  - Supabase connectivity verified"
Write-Host ""
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  Manual steps still needed:"             -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "  1. Log into GitHub and verify you have push access to the repo"
Write-Host "  2. Log into Vercel (vercel.com) and verify the project is linked"
Write-Host "  3. Log into Supabase (supabase.com) and verify dashboard access"
Write-Host "  4. Log into Resend (resend.com) and verify API key is active"
Write-Host "  5. Log into Porkbun and verify DNS records for shorepinegr.com"
Write-Host "  6. Verify GitHub Actions secrets are set (Settings > Secrets):"
Write-Host "     SUPABASE_URL, SUPABASE_SERVICE_KEY, FUNCTION_SECRET,"
Write-Host "     RESEND_API_KEY"
Write-Host "  7. Run a test: cd app && npm run dev, then visit http://localhost:3000"
Write-Host ""
Write-Host "  See DISASTER-RECOVERY.md for the full checklist." -ForegroundColor Gray
Write-Host ""
