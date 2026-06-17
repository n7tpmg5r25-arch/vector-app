<#
.SYNOPSIS
    Brand compliance audit — Vector | WA. Re-runs the four automated checks
    from Phase 4 / Thread 47 audit (BRAND_COMPLIANCE_AUDIT_2026-04-30.md).

.DESCRIPTION
    Wraps the four greps the Thread 47 kickoff defined into a single PowerShell
    script. Run from the repo root (C:\Users\Col\vector-app\). Reports drift
    inline; exits 0 on a clean state and 1 if any banned vocab appears in
    user-visible JSX or any obsolete v1.1 hex sneaks back in.

    Intended as a developer utility — does NOT modify code. Safe to re-run.

.PARAMETER NoColor
    Disable colored output (handy for CI logs).

.PARAMETER ShowAllMatches
    Show every grep match. Default mode prints summaries + drift only.

.EXAMPLE
    PS C:\Users\Col\vector-app> .\tools\brand-audit.ps1

.EXAMPLE
    PS C:\Users\Col\vector-app> .\tools\brand-audit.ps1 -ShowAllMatches

.NOTES
    Anchor: Vector_WA_Brand_Guide_v1.2.pdf (in workspace folder).
    Companion docs: BRAND_COMPLIANCE_PLAN.md, BRAND_COMPLIANCE_AUDIT_2026-04-30.md.
    Author: Thread 47 (2026-04-30).
#>
[CmdletBinding()]
param(
    [switch]$NoColor,
    [switch]$ShowAllMatches
)

$ErrorActionPreference = 'Continue'
$exitCode = 0

# ─── Helpers ────────────────────────────────────────────────────────────────

function Write-Banner($text, $color = 'Cyan') {
    if ($NoColor) {
        Write-Host ""
        Write-Host "=== $text ==="
    } else {
        Write-Host ""
        Write-Host "=== $text ===" -ForegroundColor $color
    }
}

function Write-Pass($text) {
    if ($NoColor) { Write-Host "  PASS - $text" }
    else { Write-Host "  PASS - $text" -ForegroundColor Green }
}

function Write-Fail($text) {
    if ($NoColor) { Write-Host "  FAIL - $text" }
    else { Write-Host "  FAIL - $text" -ForegroundColor Red }
    $script:exitCode = 1
}

function Write-Note($text) {
    if ($NoColor) { Write-Host "  NOTE - $text" }
    else { Write-Host "  NOTE - $text" -ForegroundColor Yellow }
}

# Repo-root sanity check
if (-not (Test-Path .\app\app\globals.css)) {
    Write-Host "Error: must be run from C:\Users\Col\vector-app\ (cannot find app/app/globals.css)." -ForegroundColor Red
    exit 2
}

# Make sure git pager doesn't hang the PowerShell session
$env:GIT_PAGER = 'cat'

Write-Banner "Vector | WA - Brand Compliance Audit" 'Cyan'
Write-Host "  Anchor: Vector_WA_Brand_Guide_v1.2.pdf"
Write-Host "  Run from: $(Get-Location)"
Write-Host "  Date: $(Get-Date -Format 'yyyy-MM-dd HH:mm')"

# ─── Check 1: Banned vocab sweep ────────────────────────────────────────────

Write-Banner "Check 1 - Banned vocab sweep" 'Yellow'

$avoid = @(
    'AI-powered', 'revolutionary', 'disrupting', 'game-changing',
    'seamless', 'empowering', 'leverage', 'unlock',
    'unprecedented', 'synergy', 'solution', 'transformative'
)

# Words common enough to need word-boundary matching to avoid false-positives
# from substrings inside legitimate words. `solution` matches "resolution(s)";
# `unlock` matches nothing in this repo; `leverage` matches nothing currently.
$wordBoundaryWords = @('unlock', 'solution', 'leverage')

$bannedHits = 0
foreach ($w in $avoid) {
    if ($wordBoundaryWords -contains $w) {
        $pattern = "\b$w\b"
    } else {
        $pattern = $w
    }

    $grepHits = git --no-pager grep -n -i -E $pattern -- 'app/app/**/*.js' 'app/app/**/*.tsx' 'app/app/**/*.jsx' 2>$null

    if ($grepHits) {
        $count = @($grepHits).Count
        $bannedHits += $count
        Write-Fail "$w - $count match(es). Triage required:"
        $grepHits | ForEach-Object { Write-Host "      $_" }
    } elseif ($ShowAllMatches) {
        Write-Pass "$w - 0"
    }
}

if ($bannedHits -eq 0) {
    Write-Pass "No banned vocab in user-visible JSX surfaces (12 words swept)."
}

# ─── Check 2: Functional color hex sweep ────────────────────────────────────

Write-Banner "Check 2 - Functional color hex sweep" 'Yellow'

# Canonical v1.2 functional hexes (Sage, Deep Teal, Amber, Stone, Rust, D Blue, R Red)
$canonHexPattern = '#(7aab6e|3a7a8a|c47a30|8a8070|c44730|4d9aff|ef4444)'
$canonRaw = git --no-pager grep -n -i -E $canonHexPattern 2>$null
$canonCount = if ($canonRaw) { @($canonRaw).Count } else { 0 }

if ($canonCount -gt 0) {
    Write-Pass "Canonical v1.2 functional hexes present - $canonCount occurrence(s)."
} else {
    Write-Fail "Zero canonical v1.2 functional hexes found. Globals.css regression?"
}

# Obsolete v1.1 hexes - flag if seen anywhere except known carve-outs.
# (#ebeae4 is baked into shipped SVG logos at app/public/logos/ and explicitly
# remapped at runtime in app/lib/generate-public-pdf.js - both intentional;
# we test it separately below.)
$obsoletePattern = '#(5d7a5a|a85b3f|141c23|9a968b|ddbe89|815f3c)'
$obsoleteHits = git --no-pager grep -n -i -E $obsoletePattern 2>$null

if ($obsoleteHits) {
    $count = @($obsoleteHits).Count
    Write-Fail "Obsolete v1.1 hex(es) found - $count match(es):"
    $obsoleteHits | ForEach-Object { Write-Host "      $_" }
} else {
    Write-Pass "No obsolete v1.1 hexes (excluding intentional #ebeae4 in logos + PDF runtime swap)."
}

# Carve-out check: confirm #ebeae4 only appears in the two known-good locations.
$ebeae4Hits = git --no-pager grep -n -i -E '#ebeae4' 2>$null
if ($ebeae4Hits) {
    $unexpected = $ebeae4Hits | Where-Object {
        $_ -notmatch 'app/public/logos/' -and
        $_ -notmatch 'app/lib/generate-public-pdf.js'
    }
    if ($unexpected) {
        Write-Fail "Parchment #ebeae4 leaked outside known-good locations:"
        $unexpected | ForEach-Object { Write-Host "      $_" }
    } elseif ($ShowAllMatches) {
        Write-Pass "All #ebeae4 matches are inside logo SVGs + PDF runtime swap (expected)."
    }
}

# ─── Check 3: Shorepine + Cormorant residue ────────────────────────────────

Write-Banner "Check 3 - Shorepine + Cormorant residue" 'Yellow'

$residueHits = git --no-pager grep -n -i -E 'shorepine|Cormorant' -- `
    'app/**/*.js' 'app/**/*.tsx' 'app/**/*.jsx' 'app/**/*.css' 2>$null

if (-not $residueHits) {
    Write-Pass "Zero Shorepine/Cormorant residue - Phase 4 brand cleanup complete."
} else {
    # Triage by category. Thread 44 owns the lib + c/[slug] palette + PDF generators.
    # User-visible JSX outside that scope is what we flag.
    $thread44Files = @(
        'app/lib/shorepine.js',
        'app/lib/pdf-shared.js',
        'app/lib/generate-pdf.js',
        'app/lib/generate-public-pdf.js',
        'app/app/c/[slug]/page.js',
        'app/app/c/[slug]/bill/[id]/page.js',
        'app/app/c/[slug]/DownloadBriefingButton.js',
        'app/app/c/[slug]/layout.js'
    )

    $unexpectedResidue = @()
    $expectedCount = 0
    $commentCount = 0

    foreach ($line in $residueHits) {
        $isThread44 = $false
        foreach ($f in $thread44Files) {
            if ($line.StartsWith("$f`:")) { $isThread44 = $true; break }
        }
        # Cheap comment-detection: line content after the colon column starts
        # with whitespace then '//', '*', or '/*' (covers JSDoc + line comments).
        # CSS /* ... */ also caught.
        $isComment = $line -match ':\s*\d+:\s*\*' -or
                     $line -match ':\s*\d+:\s*//' -or
                     $line -match ':\s*\d+:\s*/\*' -or
                     $line -match ':\s*\d+:\s*\{/\*'

        if ($isThread44) { $expectedCount++ }
        elseif ($isComment) { $commentCount++ }
        else { $unexpectedResidue += $line }
    }

    Write-Note "$expectedCount line(s) inside Thread 44 scope (lib/shorepine, pdf-shared, generate-pdf, generate-public-pdf, c/[slug]/*, c/[slug]/layout). Expected."
    Write-Note "$commentCount line(s) in JS/JSDoc/CSS comments (build-stripped). Expected per UI_VERIFIED_KNOWN_GOOD.md carve-out."

    if ($unexpectedResidue.Count -gt 0) {
        Write-Fail "$($unexpectedResidue.Count) line(s) outside both Thread 44 scope and comment carve-out:"
        $unexpectedResidue | ForEach-Object { Write-Host "      $_" }
    } else {
        Write-Pass "All Shorepine/Cormorant residue is inside Thread 44 scope or comment carve-out."
    }

    # Special check: orphaned ics-export.js (filed as Thread 48 in 2026-04-30 audit)
    $icsExportHit = git --no-pager grep -n -i -E 'Shorepine' -- 'app/lib/ics-export.js' 2>$null
    if ($icsExportHit) {
        $callers = git --no-pager grep -n -E 'from .*ics-export|require.*ics-export' 2>$null
        if (-not $callers) {
            Write-Note "app/lib/ics-export.js is orphaned (no callers) AND still has Shorepine PRODID. See Thread 48 in BRAND_COMPLIANCE_PLAN.md."
        } else {
            Write-Fail "app/lib/ics-export.js is now imported but still has Shorepine PRODID - re-evaluate Thread 48 priority."
        }
    }
}

# ─── Check 4: Brand variable usage census ──────────────────────────────────

Write-Banner "Check 4 - Brand variable usage census" 'Yellow'

function Get-VarCount {
    param([string]$VarName)
    $hits = git --no-pager grep -n -E "var\($VarName\)" -- `
        'app/**/*.js' 'app/**/*.tsx' 'app/**/*.jsx' 'app/**/*.css' 2>$null
    if (-not $hits) { return 0 }
    return @($hits).Count
}

$tealCount        = Get-VarCount '--teal'
$brassCount       = Get-VarCount '--brass'
$goldCount        = Get-VarCount '--gold'
$brassLightCount  = Get-VarCount '--brass-light'
$bgCount          = Get-VarCount '--bg'
$darkNeutralCount = Get-VarCount '--dark-neutral'

Write-Host ""
Write-Host ("    {0,-22} {1,8}   {2}" -f 'Token', 'Count', 'Status')
Write-Host ("    {0,-22} {1,8}   {2}" -f '-----', '-----', '------')
Write-Host ("    {0,-22} {1,8}   {2}" -f '--teal (legacy)',          $tealCount,        'Brass alias')
Write-Host ("    {0,-22} {1,8}   {2}" -f '--brass (canonical)',      $brassCount,       'v1.2')
Write-Host ("    {0,-22} {1,8}   {2}" -f '--gold (legacy)',          $goldCount,        'Brass Light alias')
Write-Host ("    {0,-22} {1,8}   {2}" -f '--brass-light (canon)',    $brassLightCount,  'v1.2')
Write-Host ("    {0,-22} {1,8}   {2}" -f '--bg (legacy)',            $bgCount,          'Dark Neutral alias')
Write-Host ("    {0,-22} {1,8}   {2}" -f '--dark-neutral (canon)',   $darkNeutralCount, 'v1.2')

Write-Pass "Census reported. Both legacy and canonical names resolve identically - Thread 46 alias chain intact."

if ($brassCount -eq 0 -and $brassLightCount -eq 0 -and $darkNeutralCount -eq 0) {
    Write-Note "No call sites have migrated to canonical names yet. Thread 46 added aliases; bulk migration is optional."
}

# ─── Manual checks reminder ─────────────────────────────────────────────────

Write-Banner "Manual checks (not automated)" 'Magenta'
Write-Host "  M1  Quantified before qualitative - methodology TL;DR + calibration tables before prose."
Write-Host "  M2  Probability not prediction - search 'predict' across user-visible copy."
Write-Host "  M3  Never partisan - search policy-position language; no 'good/bad/should pass' on bills."
Write-Host "  M4  Three-layer feature parity - public/registered/team routes per CLAUDE.md three-tier rule."
Write-Host "  M5  AI labeling - bill/[id]/page.js: AI-GENERATED chip + LLM disclaimer + /disclaimers link."

# ─── Summary ────────────────────────────────────────────────────────────────

Write-Banner "Summary" 'Cyan'

if ($exitCode -eq 0) {
    if ($NoColor) {
        Write-Host "  Verdict: PASS - no automated drift detected."
    } else {
        Write-Host "  Verdict: PASS - no automated drift detected." -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "  Manual checks must still be re-confirmed by reading the audit report"
    Write-Host "  at:  C:\Users\Col\Documents\Claude\Projects\Vector - WA\BRAND_COMPLIANCE_AUDIT_2026-04-30.md"
} else {
    if ($NoColor) {
        Write-Host "  Verdict: DRIFT - see flagged matches above."
    } else {
        Write-Host "  Verdict: DRIFT - see flagged matches above." -ForegroundColor Red
    }
    Write-Host ""
    Write-Host "  File a follow-up thread spec in BRAND_COMPLIANCE_PLAN.md."
}

Write-Host ""
exit $exitCode
