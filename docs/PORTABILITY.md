# PORTABILITY.md — Vector | WA

> Last updated: 2026-04-12 (Phase 7T)
> Maintainer: Colin Foote, Shorepine Civic Tech

This document maps every service, secret, file, and process that makes Vector | WA run. If you're reading this because the original laptop is gone, start with DISASTER-RECOVERY.md instead — it's the step-by-step version.

---

## 1. What Vector | WA Is

A solo-operator legislative intelligence app for Washington State. It syncs ~3,400 bills from the WA Legislature API every night, scores them with a custom trajectory engine, and serves the results as a Next.js web app. One user (Colin). One Supabase database. One Vercel deployment. Three GitHub Actions workflows.

**Live URL:** https://vector-app-liard.vercel.app

---

## 2. Service Inventory

| Service | Purpose | Account / ID | Free tier? |
|---------|---------|-------------|-----------|
| **Supabase** | PostgreSQL database, Auth (magic link), Edge Functions, RLS | Project: `skuedssejrbrxycgdcfw` | Yes (free plan) |
| **Vercel** | Next.js hosting, env vars, auto-deploy from GitHub | Team: `team_b5AzQTRWPfNwd2343M47k7D9`, Project: `prj_99D5jCeGZ46s2Qr9U50sCp1vGM7V` | Yes (Hobby plan) |
| **GitHub** | Source code, Actions (nightly + midday sync, summarization) | Repo: `n7tpmg5r25-arch/vector-app` | Yes (free Actions minutes) |
| **Resend** | Transactional email (alerts, weekly digest, test emails) | Sender: `alerts@shorepinegr.com` | Yes (100/day, 3,000/month) |
| **WA Legislature API** | Bill data, amendments, hearings, sponsors | Base: `https://wslwebservices.leg.wa.gov` | Public, no key needed |
| **Claude API (Anthropic)** | AI bill summaries via `summarize-bills` edge function | Key stored in Supabase secrets | Pay-per-use |
| **Porkbun** | DNS for `shorepinegr.com` (DKIM, SPF, MX, DMARC for Resend) | Domain registrar account | ~$10/year renewal |
| **pg_cron** (Supabase) | Triggers `weekly-digest` edge function every Monday 7 AM PT | Job ID 3, cron: `0 14 * * 1` (UTC) | Built into Supabase |

---

## 3. Repository Layout

```
C:\Users\Col\vector-app\              ← repo root (deployed from here)
│
├── .env                               ← root env: SUPABASE_URL, SERVICE_KEY, session dates
├── .github/
│   └── workflows/
│       ├── nightly-sync.yml           ← midnight PT: sync → quality check → summarize → alerts
│       ├── midday-sync.yml            ← noon PT weekdays, active session only
│       └── sync.yml                   ← LEGACY (original nightly sync, superseded by nightly-sync.yml)
│
├── package.json                       ← root deps: @supabase/supabase-js, dotenv, node-fetch, xml2js
├── vercel.json                        ← Vercel cron config (legacy, not primary sync method)
│
├── docs/                              ← portability & recovery documentation
│   ├── PORTABILITY.md                 ← this file
│   ├── SECRETS-INVENTORY.md           ← every secret, where it lives, what it does
│   └── DISASTER-RECOVERY.md           ← new-machine playbook (45-min target)
│
├── setup-new-machine.ps1              ← automated Windows setup script
│
├── supabase/
│   └── functions/
│       ├── daily-snapshot/index.ts    ← daily bill snapshot edge function
│       ├── send-alerts/index.ts       ← batched alert emails via Resend
│       ├── weekly-digest/index.ts     ← Monday digest email via Resend
│       ├── (summarize-bills)          ← AI summaries via Claude API (deployed via MCP, source NOT in repo)
│       └── _shared/
│           └── email-template.ts      ← canonical email HTML (must re-inline when deploying functions)
│
├── app/                               ← Next.js application (Vercel deploys from repo root, serves app/)
│   ├── .env                           ← app env: SUPABASE_URL, SERVICE_KEY, session dates
│   ├── .env.local                     ← app local env: NEXT_PUBLIC_* keys, FUNCTION_SECRET
│   ├── package.json                   ← app deps: next, react, @supabase/ssr, jspdf
│   ├── next.config.ts                 ← Next.js config (currently empty/default)
│   ├── tsconfig.json
│   │
│   ├── auth/
│   │   └── callback/route.js          ← Supabase magic-link callback
│   │
│   ├── lib/                           ← server-side logic (run via Node, not browser)
│   │   ├── sync-v2.js                 ← main sync engine (v2.9) — fetches WA API, scores, upserts
│   │   ├── detect-alerts.js           ← post-sync alert detection (5 event types)
│   │   ├── rescore-all.js             ← bulk rescore utility
│   │   ├── assert-sync-quality.js     ← post-sync data quality checks
│   │   ├── generate-pdf.js            ← client-side PDF export (jsPDF)
│   │   ├── session-config.js          ← biennium dates, interim detection, session helpers
│   │   ├── supabase.js                ← Supabase client init (browser + server)
│   │   ├── useSession.js              ← React hook for session selector
│   │   ├── csv-export.js              ← CSV export utility
│   │   ├── ics-export.js              ← ICS calendar export utility
│   │   └── backfill-hearings.js       ← one-time hearing backfill script
│   │
│   └── app/                           ← Next.js App Router pages
│       ├── page.js                    ← Home (session outcomes / top trajectory)
│       ├── layout.*                   ← Root layout with metadata, PWA, RegisterSW
│       ├── globals.css                ← Global styles
│       ├── login/page.js              ← Magic-link login
│       ├── search/page.js             ← Bill search with filters
│       ├── watchlist/page.js          ← Tracked bills portfolio
│       ├── bill/[id]/page.js          ← Bill detail (score, timeline, dynamics, amendments)
│       ├── members/page.js            ← Legislators (list + heatmap + career view)
│       ├── committees/page.js         ← Committee view
│       ├── hearings/page.js           ← Hearing schedule (interim: empty state)
│       ├── outcomes/page.js           ← Session outcomes (filterable)
│       ├── methodology/page.js        ← Scoring methodology explainer
│       ├── settings/page.js           ← Notification prefs, email, digest toggle
│       ├── disclaimers/page.js        ← Legal disclaimers
│       ├── api/
│       │   └── send-test-email/route.js ← proxy: browser → API route → edge function
│       └── components/
│           ├── Nav.js                 ← Main navigation (interim-aware)
│           ├── Footer.js              ← Shorepine-branded footer
│           ├── ScoreBadge.js          ← Trajectory score badge (outcome-aware)
│           ├── SessionBanner.js       ← Session transition messaging
│           └── RegisterSW.js          ← PWA service worker registration
```

---

## 4. Data Flow

```
WA Legislature API (wslwebservices.leg.wa.gov)
        │
        ▼
GitHub Actions (nightly-sync.yml / midday-sync.yml)
  runs: node app/lib/sync-v2.js
        │
        ├─ fetches bills, sponsors, amendments, committees, hearings
        ├─ scores each bill (trajectory, momentum, atmosphere)
        ├─ upserts to Supabase (bills, bill_snapshots, amendments, fiscal_note_history)
        ├─ runs assert-sync-quality.js
        ├─ calls summarize-bills edge function (Claude API) ← nightly only
        ├─ runs detect-alerts.js (inserts alert_events)
        └─ curls send-alerts edge function (batched Resend emails)

Supabase (PostgreSQL + Auth + Edge Functions)
        │
        ├─ pg_cron → weekly-digest edge function → Resend (Monday 7 AM PT)
        │
        ▼
Vercel (Next.js app)
  auto-deploys from GitHub push to main branch
  serves app/ to browser at vector-app-liard.vercel.app
```

---

## 5. Key Database Tables

The full schema lives in Supabase. Core tables:

- **bills** — one row per bill. Score, trajectory, momentum, category, outcome, amendments count, fiscal note, companions, signal_tier, confidence_label.
- **bill_snapshots** — daily score snapshots (sparkline data). One per bill per day.
- **amendments** — individual amendment rows per bill.
- **fiscal_note_history** — tracks fiscal note size changes over time.
- **tracked_bills** — user watchlist. Links user_id to bill_id with optional tag (renamed from client_tag in Brand P2, 2026-04-16).
- **bill_notes** — analyst notes per bill.
- **notification_preferences** — per-user email, digest/alert toggles.
- **alert_events** — detected events (outcome_change, imminent_hearing, rules_pull, amendment_posted, fiscal_note_change). Tracks sent_at.
- **notifications_sent** — audit trail of sent emails.
- **hearings** — committee hearing schedule.
- **members** — legislator data.

---

## 6. Deployment Details

**Vercel:** Deploys automatically on push to `main`. The Vercel project is configured to build from the repo root with the Next.js app in `app/`. No special build command override — Vercel detects the `app/` Next.js project. Environment variables are set in the Vercel dashboard (see SECRETS-INVENTORY.md).

**Supabase Edge Functions:** Deployed via Supabase MCP or dashboard — NOT via git push. The repo contains the source files in `supabase/functions/`, but deployment is manual. The `_shared/email-template.ts` must be re-inlined into each function before deploying (Supabase deploys functions in isolation, no shared imports at deploy time).

**GitHub Actions:** Triggered by cron schedule. Uses secrets stored in the GitHub repo's Settings → Secrets and Variables → Actions.

---

## 7. Session Calendar

Defined in `app/lib/session-config.js`. Currently:

- **2025-2026:** Started 2025-01-13, ended (sine die) 2026-03-12. Currently INTERIM.
- **2027-2028:** Pre-filing opens 2026-12-01, session starts 2027-01-13, ends ~2028-03-10.

The midday sync only runs during active sessions. The nightly sync runs year-round but enters interim mode (skips rescoring for unchanged bills).

---

## 8. Companion Documents

- **SECRETS-INVENTORY.md** — every secret, where it's stored, what it's for
- **DISASTER-RECOVERY.md** — step-by-step new machine setup (45-minute target)
- **setup-new-machine.ps1** — automated PowerShell setup script (repo root)

---

## 9. What's NOT in the Repo

- Supabase migrations are applied directly (no local migration files tracked in git)
- The `summarize-bills` edge function was deployed via Supabase MCP — source is NOT in the repo. It's called by nightly-sync.yml via curl at `${SUPABASE_URL}/functions/v1/summarize-bills`. Uses ANTHROPIC_API_KEY from Supabase edge function secrets.
- Actual secret values (see SECRETS-INVENTORY.md for locations)
- The Shorepine brand guide PDF (`shorepine-brand-guide-v3.pdf`) lives in the Cowork workspace, not the repo
