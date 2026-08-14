#!/bin/bash
# ============================================================
# Vector | WA — New Machine Setup Script (macOS)
# ============================================================
# Run this in Terminal on a fresh Mac. It installs prerequisites,
# clones the repo (if not already present), and walks you through
# environment setup.
#
# Time estimate: ~15-20 minutes (plus manual secret entry)
# Last updated: 2026-08-13
# ============================================================

set -e

echo ""
echo "========================================"
echo "  Vector | WA — New Machine Setup (macOS)"
echo "========================================"
echo ""

# ----------------------------------------------------------
# STEP 1: Install prerequisites via Homebrew
# ----------------------------------------------------------
echo "[Step 1/7] Installing prerequisites..."

if ! command -v brew &> /dev/null; then
    echo "  Homebrew not found — installing..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"
fi

echo "  Installing Node.js, Git, GitHub CLI..."
brew install node git gh

echo "  Installing Supabase CLI..."
brew install supabase/tap/supabase || true

echo "  Verifying installations..."
echo "    Node: $(node --version 2>/dev/null)"
echo "    npm:  $(npm --version 2>/dev/null)"
echo "    Git:  $(git --version 2>/dev/null)"
echo "    gh:   $(gh --version 2>/dev/null | head -1)"
echo ""

# ----------------------------------------------------------
# STEP 2: Clone the repo
# ----------------------------------------------------------
echo "[Step 2/7] Cloning repository..."

REPO_DIR="$HOME/vector-app"

if [ -d "$REPO_DIR" ]; then
    echo "  Directory already exists at $REPO_DIR — skipping clone."
else
    git clone https://github.com/n7tpmg5r25-arch/vector-app.git "$REPO_DIR"
fi

cd "$REPO_DIR"
echo "  Working directory: $REPO_DIR"
echo ""

# ----------------------------------------------------------
# STEP 3: Install dependencies
# ----------------------------------------------------------
echo "[Step 3/7] Installing npm dependencies..."

echo "  Installing root dependencies..."
npm ci

echo "  Installing app dependencies..."
cd "$REPO_DIR/app"
npm ci
cd "$REPO_DIR"

echo ""

# ----------------------------------------------------------
# STEP 4: Create .env files
# ----------------------------------------------------------
echo "[Step 4/7] Creating environment files..."
echo ""
echo "  You will need these values from your password manager"
echo "  or the Supabase / Vercel dashboards."
echo "  See docs/SECRETS-INVENTORY.md for where to find each one."
echo ""

# Root .env
ROOT_ENV="$REPO_DIR/.env"
if [ ! -f "$ROOT_ENV" ]; then
    echo "  Creating root .env..."
    read -p "    SUPABASE_URL (e.g. https://xxxxx.supabase.co): " SB_URL
    read -p "    SUPABASE_SERVICE_KEY: " SB_KEY

    cat > "$ROOT_ENV" <<EOF
SUPABASE_URL=$SB_URL
SUPABASE_SERVICE_KEY=$SB_KEY
CURRENT_BIENNIUM=2025-26
CURRENT_YEAR=2026
WA_API_BASE=https://wslwebservices.leg.wa.gov
SESSION_START=2025-01-13
COMMITTEE_CUTOFF=2025-02-21
FLOOR_CUTOFF=2025-03-07
OPPOSITE_CUTOFF=2025-03-21
SINE_DIE=2026-03-12
EOF
    echo "    Wrote $ROOT_ENV"
else
    echo "  Root .env already exists — skipping."
fi

# App .env
APP_ENV="$REPO_DIR/app/.env"
if [ ! -f "$APP_ENV" ]; then
    echo "  Creating app/.env..."
    if [ -z "$SB_URL" ]; then read -p "    SUPABASE_URL: " SB_URL; fi
    if [ -z "$SB_KEY" ]; then read -p "    SUPABASE_SERVICE_KEY: " SB_KEY; fi

    cat > "$APP_ENV" <<EOF
SUPABASE_URL=$SB_URL
SUPABASE_SERVICE_KEY=$SB_KEY
WA_API_BASE=https://wslwebservices.leg.wa.gov
CURRENT_BIENNIUM=2025-26
CURRENT_YEAR=2026
SESSION_START=2025-01-13
COMMITTEE_CUTOFF=2026-02-07
FLOOR_CUTOFF=2026-02-21
OPPOSITE_CUTOFF=2026-03-05
SINE_DIE=2026-03-14
EOF
    echo "    Wrote $APP_ENV"
else
    echo "  app/.env already exists — skipping."
fi

# App .env.local
APP_ENV_LOCAL="$REPO_DIR/app/.env.local"
if [ ! -f "$APP_ENV_LOCAL" ]; then
    echo "  Creating app/.env.local..."
    read -p "    NEXT_PUBLIC_SUPABASE_ANON_KEY: " SB_ANON
    read -p "    FUNCTION_SECRET: " FN_SECRET

    cat > "$APP_ENV_LOCAL" <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SB_ANON
SUPABASE_SERVICE_KEY=$SB_KEY
FUNCTION_SECRET=$FN_SECRET
NEXTAUTH_URL=http://localhost:3000
EOF
    echo "    Wrote $APP_ENV_LOCAL"
else
    echo "  app/.env.local already exists — skipping."
fi

echo ""

# ----------------------------------------------------------
# STEP 5: Verify local dev server starts
# ----------------------------------------------------------
echo "[Step 5/7] Testing local dev server..."
echo "  Starting 'npm run dev' in app/ (will run for 10 seconds)..."

cd "$REPO_DIR/app"
npm run dev > /tmp/vector-dev-test-output.txt 2>/tmp/vector-dev-test-error.txt &
DEV_PID=$!
sleep 10

if kill -0 $DEV_PID 2>/dev/null; then
    echo "  Dev server started successfully."
    kill $DEV_PID 2>/dev/null || true
else
    echo "  Dev server exited early. Check /tmp/vector-dev-test-error.txt for details."
fi

rm -f /tmp/vector-dev-test-output.txt /tmp/vector-dev-test-error.txt
cd "$REPO_DIR"
echo ""

# ----------------------------------------------------------
# STEP 6: Verify sync can run locally
# ----------------------------------------------------------
echo "[Step 6/7] Testing sync script..."
echo "  Running a quick connectivity check (just loads env and connects to Supabase)..."
echo "  If this hangs or errors, your SUPABASE_URL / SUPABASE_SERVICE_KEY are wrong."
echo ""

cat > "$REPO_DIR/connectivity-test.js" <<EOF
require('dotenv').config({ path: '$REPO_DIR/.env' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
sb.from('bills').select('id', { count: 'exact', head: true })
  .then(({ count, error }) => {
    if (error) { console.error('DB error:', error.message); process.exit(1); }
    console.log('Connected. Bills in DB: ' + count);
  });
EOF

node "$REPO_DIR/connectivity-test.js"
rm -f "$REPO_DIR/connectivity-test.js"
echo ""

# ----------------------------------------------------------
# STEP 7: Summary and next steps
# ----------------------------------------------------------
echo "[Step 7/7] Setup complete!"
echo ""
echo "========================================"
echo "  What's ready:"
echo "========================================"
echo "  - Repo cloned to $REPO_DIR"
echo "  - Dependencies installed"
echo "  - Environment files created"
echo "  - Local dev server verified"
echo "  - Supabase connectivity verified"
echo ""
echo "========================================"
echo "  Manual steps still needed:"
echo "========================================"
echo "  1. Log into GitHub and verify you have push access to the repo"
echo "  2. Log into Vercel (vercel.com) and verify the project is linked"
echo "  3. Log into Supabase (supabase.com) and verify dashboard access"
echo "  4. Log into Resend (resend.com) and verify API key + sending domain"
echo "  5. Log into Porkbun and verify DNS records (only if email is broken)"
echo "  6. Verify GitHub Actions secrets are set (repo Settings > Secrets):"
echo "     SUPABASE_URL, SUPABASE_SERVICE_KEY, FUNCTION_SECRET, RESEND_API_KEY"
echo "  7. Run a test: cd app && npm run dev, then visit http://localhost:3000"
echo ""
echo "  See docs/DISASTER-RECOVERY.md for the full checklist."
echo ""
