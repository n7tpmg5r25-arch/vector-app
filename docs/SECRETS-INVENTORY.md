# SECRETS-INVENTORY.md — Vector | WA

> Last updated: 2026-08-13 (refreshed for the Windows → Mac move; supersedes the 2026-04-12 Phase 7T version)
> All values redacted. This file is safe to commit.

---

## Quick Reference

| Secret | What it does | Where to get a new one |
|--------|-------------|----------------------|
| SUPABASE_URL | Database + API endpoint | Supabase dashboard → Settings → API |
| SUPABASE_SERVICE_KEY | Full DB access (bypasses RLS) | Supabase dashboard → Settings → API → service_role key |
| NEXT_PUBLIC_SUPABASE_URL | Same URL, exposed to browser | Same as SUPABASE_URL |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Browser-safe key (respects RLS) | Supabase dashboard → Settings → API → anon key |
| FUNCTION_SECRET | Auth header for edge function calls | Self-generated. Any long random string works. |
| RESEND_API_KEY | Email delivery API key | Resend dashboard → API Keys |
| RESEND_FROM_EMAIL | Sender address for all emails | **Verify current value in Resend dashboard** — see note below |
| ANTHROPIC_API_KEY | Claude API for bill summaries | Anthropic console → API Keys |
| CRON_SECRET | Legacy cron auth (vercel.json) | Self-generated. Any long random string. |

**⚠ Unverified as of this refresh:** the app's user-facing corrections mailbox is `corrections@vectorwa.com` (confirmed live in the app code), but this file's original DNS section (below) still names `shorepinegr.com` for Resend's DKIM/SPF/MX/DMARC records. It's unconfirmed whether the *sending* domain in Resend actually migrated to vectorwa.com or only the displayed reply-to address did. **First time you touch email recovery, check Resend → Domains to see which domain is actually verified there, and correct this file to match** — don't assume either answer.

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
- Vercel Environment Variables (for the send-test-email proxy route)
- GitHub Actions Secrets (`FUNCTION_SECRET`)

### 6. RESEND_API_KEY
- Supabase Edge Function Secrets (used by `send-alerts` and `weekly-digest`)
- GitHub Actions Secrets (`RESEND_API_KEY` — used in curl to edge functions)

### 7. RESEND_FROM_EMAIL
- Supabase Edge Function Secrets
- Value: **verify in Resend dashboard** (see unverified-domain note above)

### 8. ANTHROPIC_API_KEY
- Supabase Edge Function Secrets (used by `summarize-bills` edge function)

### 9. CRON_SECRET
- Root `.env`
- Legacy — used by vercel.json cron routes. May not be actively needed since sync moved to GitHub Actions.

---

## Session Date Variables (Not Secrets, But Important)

These live in `.env` files and workflow files, but the **canonical source of truth is `app/lib/session-config.js`** — if these ever look wrong, trust that file, not this table.

| Variable | Value as of 2026-08-13 | Where |
|----------|--------------|-------|
| CURRENT_BIENNIUM | `2025-26` | .env (root), .env (app), workflow files |
| CURRENT_YEAR | `2026` | .env (root), .env (app), workflow files |
| SESSION_START | `2025-01-13` | .env files, workflow files |
| SINE_DIE | `2026-03-12` | .env (root) — app/.env may show a slightly different cutoff date; reconcile against session-config.js if unsure |

**Forward warning:** the 2027-2028 rollover (T121) must ship before Dec 1, 2026. After that ships, every value in this table changes — re-verify against session-config.js rather than trusting this table if it's after that date.

---

## DNS Records (Porkbun)

Not secrets, but critical for email delivery. **Domain needs re-verification per the note at the top of this file** — historically these lived at `shorepinegr.com`:
- **DKIM:** TXT record at `resend._domainkey.<domain>`
- **SPF:** TXT record at `send.<domain>`
- **MX:** MX record at `send.<domain>`
- **DMARC:** TXT record at `_dmarc.<domain>`

If these are deleted, Resend emails will fail or land in spam. Recreate from Resend dashboard → Domains → (your domain) → View DNS Records.

---

## Rotation Checklist

If you need to rotate a secret (compromise, new machine, etc.):

1. **SUPABASE keys** — Regenerate in Supabase dashboard → Settings → API. Update in: both .env files, .env.local, GitHub Actions secrets, Vercel env vars.
2. **FUNCTION_SECRET** — Generate a new random string. Update in: .env.local, Supabase edge function secrets, Vercel env vars, GitHub Actions secrets.
3. **RESEND_API_KEY** — Regenerate in Resend dashboard. Update in: Supabase edge function secrets, GitHub Actions secrets.
4. **ANTHROPIC_API_KEY** — Regenerate in Anthropic console. Update in: Supabase edge function secrets.

---

## History

Legacy Supabase service_role JWT was rotated off in April 2026 (all surfaces now use `sb_publishable_`/`sb_secret_` key format). A leaked legacy key was found in git history when the repo went public (2026-06-15) but was already inert by then — confirmed via full history scan.
