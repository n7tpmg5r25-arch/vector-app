# Vector | WA — Claude Context

## Recovery Mode
If the user says "recover vector", "set up new machine", "disaster recovery", or anything about restoring the project from scratch: read `docs/DISASTER-RECOVERY.md` first, then walk them through it step by step. The setup script is `setup-new-machine.ps1` at the repo root.

## Project Overview
Vector | WA is a solo-operator legislative intelligence app for Washington State, built by Colin Foote of Shorepine Government Relations. It tracks ~3,400 bills with predictive trajectory scoring.

**Stack:** Next.js (app/) on Vercel, Supabase (PostgreSQL + Auth + Edge Functions), GitHub Actions (nightly/midday sync), Resend (email), WA Legislature API, Claude API (bill summaries).

## Key Documentation
- `docs/PORTABILITY.md` — full architecture map, service inventory, repo layout, data flow
- `docs/SECRETS-INVENTORY.md` — every secret, where it lives, how to rotate (values redacted, safe to commit)
- `docs/DISASTER-RECOVERY.md` — new-machine playbook, 45-minute target
- `setup-new-machine.ps1` — automated Windows setup script

## Important Rules
- Vercel deploys from the repo root, NOT from `app/` subfolder
- Supabase edge functions are deployed via MCP/dashboard, not git push. Re-inline `_shared/email-template.ts` before deploying.
- The `summarize-bills` edge function source is NOT in the repo — it was deployed via Supabase MCP.
- Colin is not a developer. Use plain language, give step-by-step instructions, avoid jargon.
- Deliver PowerShell as copy-paste blocks in chat, not as saved .ps1 files (except the setup script).
- Never include rollback commands in the same response as success confirmations.
- Session dates canonical source: `app/lib/session-config.js`
- Brand voice: Shorepine Government Relations (NOT "Post & Policy"). See brand guide for tone.
- DO NOT touch scoreBill() during 2027 session (Jan–Apr 2027). Frozen for calibration.
