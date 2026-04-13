# DISASTER-RECOVERY.md — Vector | WA

> Last updated: 2026-04-12 (Phase 7T)
> Scenario: Laptop is gone. You have a fresh Windows machine. Go.
> Target: Fully operational in 45 minutes.

---

## Before You Start — What You Need Access To

You need login credentials for these five services. If you use a password manager, make sure you can access it from another device (phone, browser).

1. **GitHub** — to clone the repo and check Actions secrets
2. **Supabase** — to get API keys and verify the database
3. **Vercel** — to verify deployment and env vars
4. **Resend** — to verify email API key
5. **Porkbun** — to verify DNS (only if email is broken)

Your Anthropic (Claude API) key is stored in Supabase edge function secrets — you don't need to log into Anthropic unless you need to rotate it.

---

## Phase 1: Machine Setup (~10 min)

### Option A: Run the script (recommended)

1. Open PowerShell as Administrator.
2. Clone the repo first (you need Git for this — install it manually or via winget):

```powershell
winget install --id Git.Git --accept-source-agreements --accept-package-agreements
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
git clone https://github.com/n7tpmg5r25-arch/vector-app.git C:\Users\$env:USERNAME\vector-app
```

3. Run the setup script:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
C:\Users\$env:USERNAME\vector-app\setup-new-machine.ps1
```

4. The script will install Node.js, VS Code, and Supabase CLI, install dependencies, and prompt you for secrets.

### Option B: Manual setup

```powershell
# Install prerequisites
winget install --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
winget install --id Git.Git --accept-source-agreements --accept-package-agreements
winget install --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements
winget install --id Supabase.CLI --accept-source-agreements --accept-package-agreements

# Refresh PATH (or close and reopen PowerShell)
$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

# Clone
git clone https://github.com/n7tpmg5r25-arch/vector-app.git C:\Users\$env:USERNAME\vector-app
cd C:\Users\$env:USERNAME\vector-app

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

### Create three files:

**File 1: `<repo>\.env`** (root)
```
SUPABASE_URL=https://skuedssejrbrxycgdcfw.supabase.co
SUPABASE_SERVICE_KEY=<paste service_role key>
CURRENT_BIENNIUM=2025-26
CURRENT_YEAR=2026
WA_API_BASE=https://wslwebservices.leg.wa.gov
SESSION_START=2025-01-13
COMMITTEE_CUTOFF=2025-02-21
FLOOR_CUTOFF=2025-03-07
OPPOSITE_CUTOFF=2025-03-21
SINE_DIE=2026-03-12
```

**File 2: `<repo>\app\.env`**
```
SUPABASE_URL=https://skuedssejrbrxycgdcfw.supabase.co
SUPABASE_SERVICE_KEY=<paste service_role key>
WA_API_BASE=https://wslwebservices.leg.wa.gov
CURRENT_BIENNIUM=2025-26
CURRENT_YEAR=2026
SESSION_START=2025-01-13
COMMITTEE_CUTOFF=2026-02-07
FLOOR_CUTOFF=2026-02-21
OPPOSITE_CUTOFF=2026-03-05
SINE_DIE=2026-03-14
```

**File 3: `<repo>\app\.env.local`**
```
NEXT_PUBLIC_SUPABASE_URL=https://skuedssejrbrxycgdcfw.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<paste anon key>
SUPABASE_SERVICE_KEY=<paste service_role key>
FUNCTION_SECRET=<paste function secret>
NEXTAUTH_URL=http://localhost:3000
```

---

## Phase 3: Verify Local Dev (~5 min)

```powershell
cd C:\Users\$env:USERNAME\vector-app\app
npm run dev
```

Open http://localhost:3000 in your browser. You should see the Vector | WA home page. If you see "Session Outcomes" cards (196 LAW / 70 CARRY OVER / 3,145 DEAD), the database connection is working.

Try logging in with your email — Supabase will send a magic link.

---

## Phase 4: Verify Cloud Services (~10 min)

### GitHub Actions
1. Go to https://github.com/n7tpmg5r25-arch/vector-app/actions
2. Check that the most recent nightly-sync run succeeded (green check).
3. Go to Settings → Secrets and Variables → Actions. Verify these exist:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `FUNCTION_SECRET`
   - `RESEND_API_KEY`
4. If any are missing (e.g., because the repo was re-created), add them. Values come from Supabase dashboard and Resend dashboard.

### Vercel
1. Go to https://vercel.com and open the vector-app project.
2. Check that the latest deployment is healthy.
3. Go to Settings → Environment Variables. Verify these exist:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `FUNCTION_SECRET`
4. Push a trivial commit to confirm auto-deploy still works:

```powershell
cd C:\Users\$env:USERNAME\vector-app
git commit --allow-empty -m "verify deploy from new machine"
git push
```

### Supabase
1. Go to https://supabase.com/dashboard and open the project.
2. Table Editor → check that `bills` has ~3,400 rows.
3. Edge Functions → verify `send-alerts`, `weekly-digest`, `daily-snapshot`, and `summarize-bills` are deployed and healthy.
4. Under edge function settings, verify secrets are set: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `FUNCTION_SECRET`, and `ANTHROPIC_API_KEY`.

### Resend
1. Go to https://resend.com/domains and verify `shorepinegr.com` is verified (green checks on all DNS records).
2. If DNS records are missing, log into Porkbun and recreate them from the Resend domain settings page.

---

## Phase 5: Verify Sync (~10 min)

Run the sync manually to confirm end-to-end:

```powershell
cd C:\Users\$env:USERNAME\vector-app
node app/lib/sync-v2.js
```

This will take 20-85 minutes for a full sync. During interim, it should be faster (~5 min) because it skips rescoring for unchanged bills. If it connects and starts logging bill names, you're good — you can Ctrl+C after confirming it's working.

Or trigger it from GitHub Actions: go to the repo → Actions → Nightly Sync → Run workflow.

---

## Troubleshooting

### "Cannot find module 'dotenv'" when running sync
You're in the wrong directory. The root `package.json` has dotenv. Run from the repo root, not from `app/`.

### Dev server shows blank page or 500 error
Check `app/.env.local` — the `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set. These are the browser-visible keys.

### Magic link email doesn't arrive
Check Supabase → Authentication → URL Configuration. The Site URL and Redirect URLs must include your Vercel domain (`https://vector-app-liard.vercel.app`). For local dev, also add `http://localhost:3000`.

### GitHub Actions sync fails
Check the workflow logs. Most common: expired or wrong secrets. Go to repo Settings → Secrets and re-enter the values from Supabase dashboard.

### Alert emails not sending
Verify in Supabase → Edge Functions → send-alerts that the function is deployed. Check that `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `FUNCTION_SECRET` are set in edge function secrets. Check Resend dashboard for delivery logs.

### pg_cron weekly digest not firing
Check Supabase SQL Editor:
```sql
SELECT * FROM cron.job WHERE jobname = 'weekly-digest-monday';
```
Should show jobid 3, schedule `0 14 * * 1`. If missing, recreate it — see the Phase 9 notes in PORTABILITY.md for the exact pg_net call.

---

## What's NOT Covered Here

This playbook assumes all cloud services are healthy. If you also need to:
- **Restore the Supabase database** — use Supabase's built-in daily backups (Settings → Database → Backups)
- **Recreate the Vercel project** — link it to the GitHub repo, set env vars, deploy
- **Recreate the GitHub repo** — push from your local copy, re-add Actions secrets
- **Recreate edge functions** — deploy from `supabase/functions/` in the repo using Supabase CLI or MCP (remember to re-inline `_shared/email-template.ts`)

These are rare scenarios. The 45-minute target covers the common case: new laptop, all services still running.
