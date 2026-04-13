# SECRETS-INVENTORY.md — Vector | WA

> Last updated: 2026-04-12 (Phase 7T)
> All values redacted. This file is safe to commit.

---

## Quick Reference

| Secret | What it does | Where to get a new one |
|--------|-------------|----------------------|
| SUPABASE_URL | Database + API endpoint | Supabase dashboard → Settings → API |
| SUPABASE_SERVICE_KEY | Full DB access (bypasses RLS) | Supabase dashboard → Settings → API → service_role key |
| NEXT_PUBLIC_SUPABASE_URL | Same URL, exposed to browser | Same as SUPABASE_URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Browser-safe key (respects RLS) | Supabase dashboard → Settings → API → anon key |
| FUNCTION_SECRET | Auth header for edge function calls | You generated this yourself. Any long random string works. |
| RESEND_API_KEY | Email delivery API key | Resend dashboard → API Keys |
| RESEND_FROM_EMAIL | Sender address for all emails | Set to `alerts@shorepinegr.com` (must match Resend verified domain) |
| ANTHROPIC_API_KEY | Claude API for bill summaries | Anthropic console → API Keys |
| CRON_SECRET | Legacy cron auth (vercel.json) | Self-generated. Any long random string. |

---

## Where Each Secret Lives

### 1. SUPABASE_URL
- Root `.env` (used by sync scripts)
- `app/.env` (used by sync scripts run from app/lib/)
- GitHub Actions Secrets (`SUPABASE_URL`)
- Vercel Environment Variables (all environments)

### 2. SUPABASE_SERVICE_KEY
**This is the most sensitive secret.** It bypasses all Row Level Security.
- Root `.env`
- `app/.env`
- `app/.env.local`
- GitHub Actions Secrets (`SUPABASE_SERVICE_KEY`)
- **NOT** in Vercel env vars (the app uses the anon key for browser requests)

### 3. NEXT_PUBLIC_SUPABASE_URL
- `app/.env.local`
- Vercel Environment Variables (all environments)

### 4. NEXT_PUBLIC_SUPABASE_ANON_KEY
- `app/.env.local`
- Vercel Environment Variables (all environments)

### 5. FUNCTION_SECRET
Shared secret between the Next.js API route, GitHub Actions, and Supabase edge functions. Used as `x-function-secret` header.
- `app/.env.local`
- Supabase Edge Function Secrets (set via dashboard or CLI)
- Vercel Environment Variables (for `/api/send-test-email` proxy route)
- GitHub Actions Secrets (`FUNCTION_SECRET`)

### 6. RESEND_API_KEY
- Supabase Edge Function Secrets (used by `send-alerts` and `weekly-digest`)
- GitHub Actions Secrets (`RESEND_API_KEY` — used in curl to edge functions)

### 7. RESEND_FROM_EMAIL
- Supabase Edge Function Secrets
- Value: `alerts@shorepinegr.com`

### 8. ANTHROPIC_API_KEY
- Supabase Edge Function Secrets (used by `summarize-bills` edge function)

### 9. CRON_SECRET
- Root `.env`
- Legacy — used by vercel.json cron routes. May not be actively needed since sync moved to GitHub Actions.

---

## Session Date Variables (Not Secrets, But Important)

These are hardcoded in workflow files and .env files. They change each biennium.

| Variable | Current Value | Where |
|----------|--------------|-------|
| CURRENT_BIENNIUM | `2025-26` | .env (root), .env (app), nightly-sync.yml |
| CURRENT_YEAR | `2026` | .env (root), .env (app), nightly-sync.yml |
| SESSION_START | `2025-01-13` | .env files, nightly-sync.yml |
| COMMITTEE_CUTOFF | varies by file | .env (root) vs .env (app) have different values — see note |
| FLOOR_CUTOFF | varies by file | same |
| OPPOSITE_CUTOFF | varies by file | same |
| SINE_DIE | `2026-03-12` or `2026-03-14` | varies — nightly-sync.yml uses 03-12 |

**Note:** The root `.env` and `app/.env` have slightly different cutoff dates. The GitHub Actions workflows have their own hardcoded dates. The canonical source of truth for session dates is `app/lib/session-config.js`.

---

## DNS Records (Porkbun — shorepinegr.com)

Not secrets, but critical for email delivery:
- **DKIM:** TXT record at `resend._domainkey.shorepinegr.com`
- **SPF:** TXT record at `send.shorepinegr.com`
- **MX:** MX record at `send.shorepinegr.com`
- **DMARC:** TXT record at `_dmarc.shorepinegr.com`

If these are deleted, Resend emails will fail or land in spam. Recreate from Resend dashboard → Domains → shorepinegr.com → View DNS Records.

---

## Rotation Checklist

If you need to rotate a secret (compromise, new machine, etc.):

1. **SUPABASE keys** — Regenerate in Supabase dashboard → Settings → API. Update in: both .env files, .env.local, GitHub Actions secrets, Vercel env vars.
2. **FUNCTION_SECRET** — Generate a new random string. Update in: .env.local, Supabase edge function secrets, Vercel env vars, GitHub Actions secrets.
3. **RESEND_API_KEY** — Regenerate in Resend dashboard. Update in: Supabase edge function secrets, GitHub Actions secrets.
4. **ANTHROPIC_API_KEY** — Regenerate in Anthropic console. Update in: Supabase edge function secrets.
