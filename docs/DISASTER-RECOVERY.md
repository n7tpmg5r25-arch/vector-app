# DISASTER-RECOVERY.md — Vector | WA

> Last updated: 2026-08-13 — rewritten for macOS (Colin moved off Windows this date).
> Scenario: Laptop is gone, or you're starting on a new Mac. Go.
> Target: Fully operational in ~30 minutes.

---

## Before You Start — What You Need Access To

You need login credentials for these five services. If you use a password manager, make sure you can access it from another device (phone, browser).

1. **GitHub** — to clone the repo and check Actions secrets
2. **Supabase** — to get API keys and verify the database
3. **Vercel** — to verify deployment and env vars
4. **Resend** — to verify email API key and sending domain
5. **Porkbun** — to verify DNS (only if email is broken)

Your Anthropic (Claude API) key is stored in Supabase edge function secrets — you don't need to log into Anthropic unless you need to rotate it.

---

## Phase 1: Machine Setup (~10 min)

Open **Terminal** (Applications → Utilities → Terminal, or Spotlight search "Terminal").

### Option A: Run the script (recommended)

```bash
# Install Homebrew if you don't have it yet (skip if `brew --version` already works)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install git, then clone the repo
brew install git
git clone https://github.com/n7tpmg5r25-arch/vector-app.git ~/vector-app

# Run the setup script
chmod +x ~/vector-app/setup-new-machine.sh
~/vector-app/setup-new-machine.sh
```

The script installs Node.js, GitHub CLI, and the Supabase CLI, installs dependencies, and prompts you for secrets.

### Option B: Manual setup

```bash
# Install prerequisites
brew install git node gh
brew install supabase/tap/supabase

# Clone
git clone https://github.com/n7tpmg5r25-arch/vector-app.git ~/vector-app
cd ~/vector-app

# Install deps
npm ci
cd app
npm ci
cd ..
```

---

## Phase 2: Secrets (~10 min)

Open Supabase dashboard → your project → Settings → API. You need:
- **Project URL** (this is SUPABASE_URL and NEXT_PUBLIC_SUPABASE_URL)
- **anon public key** (this is NEXT_PUBLIC_SUPABASE_ANON_KEY)
- **service_role secret key** (this is SUPABASE_SERVICE_KEY)

From your Vercel project dashboard or password manager, you need:
- **FUNCTION_SECRET** (the `x-function-secret` shared value)

### Create three files

Run each block below in Terminal — it'll ask you to paste each value, then write the file for you.

**File 1: `~/vector-app/.env`** (root)
```bash
cd ~/vector-app
read -p "SUPABASE_URL (e.g. https://xxxxx.supabase.co): " SB_URL
read -p "SUPABASE_SERVICE_KEY: " SB_KEY
cat > .env <<EOF
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
echo "Wrote .env"
```

**File 2: `~/vector-app/app/.env`**
```bash
cd ~/vector-app/app
cat > .env <<EOF
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
echo "Wrote app/.env"
```

**File 3: `~/vector-app/app/.env.local`**
```bash
cd ~/vector-app/app
read -p "NEXT_PUBLIC_SUPABASE_ANON_KEY: " SB_ANON
read -p "FUNCTION_SECRET: " FN_SECRET
cat > .env.local <<EOF
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SB_ANON
SUPABASE_SERVICE_KEY=$SB_KEY
FUNCTION_SECRET=$FN_SECRET
NEXTAUTH_URL=http://localhost:3000
EOF
echo "Wrote app/.env.local"
```

(Session-date values above are current as of 2026-08-13 — the canonical source is `app/lib/session-config.js`; check there if the app behaves like the dates are wrong.)

---

## Phase 3: Verify Local Dev (~5 min)

```bash
cd ~/vector-app/app
npm run dev
```

Open http://localhost:3000 in your browser. You should see the Vector | WA home page. If you see "Session Outcomes" cards with real numbers, the database connection is working.

Try logging in with your email — Supabase will send a magic link. Press Ctrl+C in Terminal to stop the dev server when done.

---

## Phase 4: Verify Cloud Services (~10 min)

### GitHub Actions
1. Go to https://github.com/n7tpmg5r25-arch/vector-app/actions
2. Check that the most recent `nightly-sync` run succeeded (green check).
3. Go to Settings → Secrets and Variables → Actions. Verify these exist:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `FUNCTION_SECRET`
   - `RESEND_API_KEY`
4. If any are missing, add them. Values come from Supabase dashboard and Resend dashboard.

### Vercel
1. Go to https://vercel.com and open the vector-app project.
2. Check that the latest deployment (target = production) is READY.
3. Go to Settings → Environment Variables. Verify these exist:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `FUNCTION_SECRET`
4. Push a trivial commit to confirm auto-deploy still works:

```bash
cd ~/vector-app
git commit --allow-empty -m "verify deploy from new machine"
git push
```

### Supabase
1. Go to https://supabase.com/dashboard and open the project.
2. Table Editor → check that `bills` has ~3,400 rows.
3. Edge Functions → verify `send-alerts`, `weekly-digest`, `daily-snapshot`, `waitlist-signup`, and `summarize-bills` are deployed and healthy.
4. Under edge function settings, verify secrets are set: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `FUNCTION_SECRET`, and `ANTHROPIC_API_KEY`.

### Resend
1. Go to https://resend.com/domains and check which domain is verified (green checks on all DNS records) — **note it down and correct SECRETS-INVENTORY.md if it doesn't match what that file says.**
2. If DNS records are missing, log into Porkbun and recreate them from the Resend domain settings page.

---

## Phase 5: Verify Sync (~10 min)

Run the sync manually to confirm end-to-end:

```bash
cd ~/vector-app
node app/lib/sync-v2.js
```

This will take 20-85 minutes for a full sync. During interim, it should be faster (~5 min) because it skips rescoring for unchanged bills. If it connects and starts logging bill names, you're good — you can Ctrl+C after confirming it's working.

Or trigger it from GitHub Actions: go to the repo → Actions → nightly-sync → Run workflow.

---

## Troubleshooting

### "Cannot find module 'dotenv'" when running sync
You're in the wrong directory. The root `package.json` has dotenv. Run from the repo root, not from `app/`.

### Dev server shows blank page or 500 error
Check `app/.env.local` — the `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set. These are the browser-visible keys.

### Magic link email doesn't arrive
Check Supabase → Authentication → URL Configuration. The Site URL and Redirect URLs must include `https://vectorwa.com`. For local dev, also add `http://localhost:3000`.

### GitHub Actions sync fails
Check the workflow logs. Most common: expired or wrong secrets. Go to repo Settings → Secrets and re-enter the values from Supabase dashboard.

### Alert emails not sending
Verify in Supabase → Edge Functions → send-alerts that the function is deployed. Check that `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `FUNCTION_SECRET` are set in edge function secrets. Check Resend dashboard for delivery logs.

### pg_cron jobs not firing
Check Supabase SQL Editor:
```sql
SELECT * FROM cron.job;
```
Should show `weekly-digest-monday` and `snapshot-retention-prune`. If missing, recreate — see PORTABILITY.md §4 for what each job does.

### "command not found" for brew, git, node, or gh
Homebrew installs to `/opt/homebrew` on Apple Silicon Macs. If commands aren't found right after installing, close and reopen Terminal, or run:
```bash
eval "$(/opt/homebrew/bin/brew shellenv)"
```

---

## What's NOT Covered Here

This playbook assumes all cloud services are healthy. If you also need to:
- **Restore the Supabase database** — use Supabase's built-in daily backups (Settings → Database → Backups)
- **Recreate the Vercel project** — link it to the GitHub repo, set env vars, deploy
- **Recreate the GitHub repo** — push from your local copy, re-add Actions secrets
- **Recreate edge functions** — deploy from `supabase/functions/` in the repo using Supabase CLI or MCP (remember to re-inline `_shared/email-template.ts`)

These are rare scenarios. The ~30-minute target covers the common case: new laptop, all services still running.

---

## Working Pattern Going Forward (Mac vs. the old Windows habits)

Everything in this project's history before 2026-08-13 assumed Windows PowerShell — copy-paste `.ps1`-style blocks, `winget`, `C:\Users\...` paths. That's retired. Going forward:
- Ship blocks are Terminal/bash copy-paste, not PowerShell.
- Paths use `~/vector-app/...`, not `C:\Users\Col\vector-app\...`.
- `git`, `gh`, and `node` behave the same as they did on Windows — only the shell around them changed.
- Any Windows-specific gotcha in memory (PowerShell heredoc limits, .NET file I/O quirks, BOM encoding) no longer applies. New Mac-specific quirks will get logged the same way as they're discovered.
