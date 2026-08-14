# PORTABILITY.md — Vector | WA

> Last updated: 2026-08-13 (refreshed for the Windows → Mac move; supersedes the 2026-04-12 Phase 7T version)
> Maintainer: Colin Foote

This document maps every service, secret, file, and process that makes Vector | WA run. If you're reading this because the original laptop is gone, start with DISASTER-RECOVERY.md instead — it's the step-by-step version.

---

## 1. What Vector | WA Is

A solo-operator legislative intelligence app for Washington State. It syncs ~3,400 bills from the WA Legislature API, scores them with a custom trajectory engine, and serves the results as a Next.js web app. One user (Colin). One Supabase database. One Vercel deployment. GitHub Actions run the pipeline.

**Live URL:** https://vectorwa.com
**Repo:** https://github.com/n7tpmg5r25-arch/vector-app — **public** (flipped 2026-06-15). Actions run free and unlimited; anyone (including a fresh Claude session with no local access) can read code/commits/PRs via the GitHub API with no auth.

---

## 2. Service Inventory

| Service | Purpose | Account / ID | Free tier? |
|---------|---------|-------------|-----------|
| **Supabase** | PostgreSQL database, Auth (magic link), Edge Functions, RLS | Project: `skuedssejrbrxycgdcfw` | Yes (free plan, 500MB DB cap — see data-lifecycle policy in CLAUDE.md) |
| **Vercel** | Next.js hosting, env vars, auto-deploy from GitHub | Team: `team_b5AzQTRWPfNwd2343M47k7D9`, Project: `prj_99D5jCeGZ46s2Qr9U50sCp1vGM7V` | Yes (Hobby plan) |
| **GitHub** | Source code, Actions (sync pipeline, bio enrichment) | Repo: `n7tpmg5r25-arch/vector-app` (public) | Yes — public repo, Actions free/unlimited |
| **Resend** | Transactional email (alerts, weekly digest) | Sender domain: **verify current domain in Resend dashboard** — app code now sends user-facing mail from `corrections@vectorwa.com`; confirm whether the Resend *sending* domain also moved off `shorepinegr.com` or just the reply-to address did | Yes (100/day, 3,000/month) |
| **WA Legislature API** | Bill data, amendments, hearings, sponsors | Base: `https://wslwebservices.leg.wa.gov` | Public, no key needed |
| **Claude API (Anthropic)** | AI bill summaries via `summarize-bills` edge function | Key stored in Supabase secrets | Pay-per-use |
| **Porkbun** | DNS for the app's domain(s) | Domain registrar account | ~$10-15/year renewal |
| **pg_cron** (Supabase) | Scheduled jobs: `weekly-digest`, `snapshot-retention-prune` (nightly 09:30 UTC) | Built into Supabase | Built into Supabase |

**Cost ceiling:** ~$100/year all-in (domain + API pulls + hosting) per project brief. Don't add recurring spend without checking against this.

---

## 3. Repository Layout

```
vector-app/                             ← repo root (deployed from here; was C:\Users\Col\vector-app on Windows)
│
├── .env                               ← root env: SUPABASE_URL, SERVICE_KEY, session dates (NOT committed — see SECRETS-INVENTORY.md)
├── .github/
│   └── workflows/
│       ├── nightly-sync.yml           ← heavy nightly run: sync → quality check → summarize → alerts
│       ├── pipeline-frequent.yml      ← light sync→alerts→radar→send; cron-gated (hourly in-session/Dec run-up, every 4h interim)
│       ├── pipeline-watchdog.yml      ← daily 16:00 UTC; fails+emails if sync_log looks stale or a run fetched 0 bills
│       └── bio-sync.yml               ← legislator bio enrichment
│
├── package.json                       ← root deps: @supabase/supabase-js, dotenv, node-fetch, xml2js
├── vercel.json                        ← Vercel cron config (legacy, not primary sync method)
│
├── docs/                              ← portability & recovery documentation
│   ├── PORTABILITY.md                 ← this file
│   ├── SECRETS-INVENTORY.md           ← every secret, where it lives, what it does
│   └── DISASTER-RECOVERY.md           ← new-machine playbook
│
├── setup-new-machine.sh               ← automated macOS setup script (current — see note below)
├── setup-new-machine.ps1              ← automated Windows setup script (kept for reference; Windows is retired as of 2026-08)
│
├── supabase/
│   └── functions/
│       ├── daily-snapshot/index.ts    ← daily bill snapshot edge function
│       ├── send-alerts/index.ts       ← batched alert emails via Resend
│       ├── weekly-digest/index.ts     ← Monday digest email via Resend
│       ├── waitlist-signup/index.ts   ← closed-beta waitlist signup handler
│       ├── (summarize-bills)          ← AI summaries via Claude API (deployed via MCP, source NOT in repo)
│       └── _shared/
│           └── email-template.ts      ← canonical email HTML (must re-inline when deploying functions)
│
└── app/                               ← Next.js application (Vercel deploys from repo root, serves app/)
    ├── .env / .env.local              ← app env + local secrets (NOT committed)
    ├── package.json                   ← app deps: next, react, @supabase/ssr, jspdf
    ├── lib/                           ← server-side logic: sync-v2.js (main engine), session-config.js
    │                                     (canonical session dates), viewer-capabilities.js (tier logic),
    │                                     data-lifecycle.js, generate-pdf.js + generate-public-pdf.js + pdf-shared.js
    ├── proxy.js                       ← auth/anon gate (renamed from middleware.js)
    └── app/                           ← Next.js App Router pages + components (Nav, Footer, ScoreBadge, etc.)
```

**Note on this section:** this is a hand-maintained snapshot, not auto-generated — it will drift as threads ship. If something here looks wrong, the live repo tree is the source of truth, not this file. Full re-sync of this section is tracked as a documentation-audit follow-up, not done as part of the 2026-08-13 Mac-move refresh.

---

## 4. Data Flow

```
WA Legislature API (wslwebservices.leg.wa.gov)
        │
        ▼
GitHub Actions (nightly-sync.yml heavy / pipeline-frequent.yml light)
  runs: node app/lib/sync-v2.js
        │
        ├─ fetches bills, sponsors, amendments, committees, hearings
        ├─ scores each bill (trajectory, momentum, atmosphere)
        ├─ upserts to Supabase (bills, trajectory_snapshots, amendments, fiscal_note_history)
        ├─ runs assert-sync-quality.js
        ├─ calls summarize-bills edge function (Claude API) ← nightly only
        ├─ runs detect-alerts.js / detect-radar.js (inserts alert_events / radar_matches)
        └─ curls send-alerts edge function (batched Resend emails)

Supabase (PostgreSQL + Auth + Edge Functions)
        │
        ├─ pg_cron → weekly-digest edge function → Resend (Monday)
        ├─ pg_cron → snapshot-retention-prune (nightly 09:30 UTC, lossless change-point collapse)
        │
        ▼
Vercel (Next.js app)
  auto-deploys from GitHub push to main branch
  serves app/ to browser at https://vectorwa.com
```

---

## 5. Key Database Tables

The full schema lives in Supabase. Core tables:

- **bills** — one row per bill. Score, trajectory, momentum, category, outcome, amendments count, fiscal note, companions, signal_tier, confidence_label.
- **trajectory_snapshots** / **companion_snapshots** — change-point score history (pruned nightly per data-lifecycle policy, not daily-forever).
- **amendments** — individual amendment rows per bill.
- **fiscal_note_history** — tracks fiscal note size changes over time.
- **tracked_bills** — user watchlist. Links user_id to bill_id; `client_id` links to a Team-tier client.
- **bill_notes** — analyst notes per bill.
- **notification_preferences** — per-user email, digest/alert toggles.
- **alert_events** — detected events. Tracks sent_at.
- **radar_terms** / **radar_matches** / **radar_bill_state** / **bill_text_versions** — Radar term-tracking + material-change + bill-text-diff feature.
- **news_items** — in-app news feed (7 sources, government-beat gated).
- **clients** / **client_users** — Team-tier portal.
- **calibration_weights** / **calibration_buckets** — the scoring model + materialized calibration baseline.
- **hearings**, **members** — hearing schedule, legislator data.

---

## 6. Deployment Details

**Vercel:** Deploys automatically on push to `main`. Builds from the repo root with the Next.js app in `app/`. Environment variables are set in the Vercel dashboard (see SECRETS-INVENTORY.md).

**Supabase Edge Functions:** Deployed via Supabase MCP or dashboard — NOT via git push. `_shared/email-template.ts` must be re-inlined into each function before deploying (no shared imports at deploy time).

**GitHub Actions:** Triggered by cron schedule (repo is public — no minutes cap). Uses secrets stored in the GitHub repo's Settings → Secrets and Variables → Actions.

---

## 7. Session Calendar

Defined canonically in `app/lib/session-config.js` — always read that file for current values, the numbers below can drift.

- **2025-2026:** Started 2025-01-13, sine die 2026-03-12. Currently INTERIM.
- **2027-2028:** Pre-filing opens 2026-12-01, session starts ~2027-01-13. **Rollover cutover (T121) must ship before Dec 1, 2026** — see `SESSION_CUTOVER_2027.md`.

---

## 8. Companion Documents

- **SECRETS-INVENTORY.md** — every secret, where it's stored, what it's for
- **DISASTER-RECOVERY.md** — step-by-step new machine setup
- **setup-new-machine.sh** — automated macOS setup script (repo root, current)
- **setup-new-machine.ps1** — automated Windows setup script (repo root, retired but kept)

---

## 9. What's NOT in the Repo

- Supabase migrations are applied directly (no local migration files tracked in git)
- The `summarize-bills` edge function was deployed via Supabase MCP — source is NOT in the repo. Called by nightly-sync.yml via curl at `${SUPABASE_URL}/functions/v1/summarize-bills`. Uses ANTHROPIC_API_KEY from Supabase edge function secrets.
- Actual secret values (see SECRETS-INVENTORY.md for locations)
- Planning/context docs (MASTER_PLAN.md, audit reports, the brand guide PDF) live in Colin's local Claude project folder, not this repo — those are working documents, not app dependencies, so their absence from the repo doesn't block recovery.
