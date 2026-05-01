# Vector | WA â€” Claude Context

## Recovery Mode
If the user says "recover vector", "set up new machine", "disaster recovery", or anything about restoring the project from scratch: read `docs/DISASTER-RECOVERY.md` first, then walk them through it step by step. The setup script is `setup-new-machine.ps1` at the repo root.

## Project Overview
Vector | WA is a legislative intelligence app for Washington State, built by Colin Foote. It tracks ~3,400 bills with predictive trajectory scoring.

**Stack:** Next.js (app/) on Vercel, Supabase (PostgreSQL + Auth + Edge Functions), GitHub Actions (nightly/midday sync), Resend (email), WA Legislature API, Claude API (bill summaries).

## Key Documentation
- `docs/PORTABILITY.md` â€” full architecture map, service inventory, repo layout, data flow
- `docs/SECRETS-INVENTORY.md` â€” every secret, where it lives, how to rotate (values redacted, safe to commit)
- `docs/DISASTER-RECOVERY.md` â€” new-machine playbook, 45-minute target
- `setup-new-machine.ps1` â€” automated Windows setup script

## App Directory Structure
Live pages are in `app/app/`, NOT `app/`. Shared infrastructure stays at `app/` level:
- `app/app/` â€” all page routes (watchlist, bill/[id], search, etc.) and components (Nav, ScoreBadge, etc.)
- `app/lib/` â€” shared utilities (supabase, session-config, generate-pdf, sync, etc.)
- `app/layout.js` + `app/globals.css` â€” root layout and styles
- `app/auth/callback/` â€” server-side auth route

**When editing pages or components, always edit files in `app/app/`, never at the `app/` level.**

## Important Rules
- Vercel deploys from the repo root, NOT from `app/` subfolder
- Supabase edge functions are deployed via MCP/dashboard, not git push. Re-inline `_shared/email-template.ts` before deploying.
- The `summarize-bills` edge function source is NOT in the repo â€” it was deployed via Supabase MCP.
- Colin is not a developer. Use plain language, give step-by-step instructions, avoid jargon.
- Deliver PowerShell as copy-paste blocks in chat, not as saved .ps1 files (except the setup script).
- Never include rollback commands in the same response as success confirmations.
- Session dates canonical source: `app/lib/session-config.js`
- **Mobile-only by design (2026-04-25 onward).** The app is intentionally built for the 480-px mobile column. Do NOT add `@media (min-width: 1024px)` rules, 2-col grids, side rails, top-bar nav swaps, or any other desktop responsive treatment to new or existing pages. Threads 7 + 8 + 10 of the implementation plan attempted this and were reverted/skipped to keep focus on the launch backlog. Revival kit (full Thread 7 + Thread 8 patches) preserved at `C:\Users\Col\Documents\Claude\Projects\Vector - WA\DESKTOP_RESPONSIVE_DEFERRED.md` — re-introduce only when Colin explicitly opens a desktop thread.
- Brand system: **Vector | WA Brand Guide v1.2** (anchor: `C:\Users\Col\Documents\Claude\Projects\Vector - WA\Vector_WA_Brand_Guide_v1.2.pdf`, adopted 2026-04-30; supersedes the Shorepine GR v4.6 brand previously codified here). Vector | WA is the only brand in the system — there is no parent firm. App UI uses the Vector | WA palette: Dark Neutral `#0e1014` (`--bg`), Card `#171921` (`--bg-card`), Brass `#b8975a` (`--teal` legacy name), Brass Light `#d4b47a` (`--gold` legacy name), Cream `#e8e9ec` (`--text-primary`), Text Mid `#a8acb4`, Text Muted `#6c7078`, Border `#2a2d38`. Functional colors are semantic-only: Sage / Deep Teal / Amber / Stone / Rust + D Blue / R Red (brand guide §02). Type is a three-voice system: **Playfair Display** for display headings (bill titles, dashboard numbers), **Karla** for body and UI, **DM Mono** for metadata labels (CALIBRATION COHORT, X FACTORS, ROLL-CALL HISTORY) and structured-data captions. All three load globally. **Logos** live in `app/public/logos/` — 4-file canonical set (`vector-wa-primary.svg`, `-reverse.svg`, `-knockout.svg`, `-mark.svg`); files unchanged from v4.6 → v1.2. Logo usage is documented in §02 of the v1.2 brand guide PDF.
- **Three-tier rule (Public / Registered / Team).** Per brand guide §08, the app has three audience tiers, all under one Vector | WA brand. Data is always free; sign-in only adds personal workflow and team collaboration on top. Defined canonically in `app/lib/viewer-capabilities.js` and enforced in `app/proxy.js`. Every thread spec MUST declare which tier(s) it touches.
  - **Public tier** (`role === 'public'`, `!user`). Anon-reachable routes: `/`, `/search`, `/bill/[id]`, `/members`, `/committees`, `/committees/[slug]`, `/hearings`, `/methodology`, `/outcomes`, `/how-it-works`, `/about`, plus `/login`, `/disclaimers` (always public). Full Vector | WA brand. No firm attribution, no upsell. Free public launch mid 2027.
  - **Registered tier** (`role === 'owner'`; the `'owner'` symbol is preserved in `viewer-capabilities.js` for code-level safety — there's no user-visible "owner" label, and the v1.2 conceptual name is "Registered"). Routes: `/watchlist`, `/settings`, `/admin/*`, `/auth/callback`, plus the global home `/` when authed. Same Vector | WA brand. Adds personal watchlist, custom tags, watchlist PDF brief, saved-search alerts (planned).
  - **Team tier** (`role === 'client'`; the `'client'` symbol is preserved for code/route/DB safety — see carve-out below). Routes: `/c/[slug]/*`. Same Vector | WA brand. Adds curated bill set (RLS-fenced per team), shared analyst notes, multi-bill PDF brief, read-only briefing surface for team members.
  - **Routes + DB schema keep their `client` names** — `/c/[slug]/*`, the `clients` / `client_users` tables, `tracked_bills.client_id`, `useClient()`, `DownloadBriefingButton`, etc. all stay as-is for SEO / link / schema stability. The rename is **user-visible vocabulary only**: page titles, header chips, button labels, alert text, Admin chip text — anywhere user-visible JSX text says "client", flip to "team" (sweep tracked in `BRAND_COMPLIANCE_PLAN.md` Thread 45).
  - **No firm-side brand surface across any tier** in the v1.2 target state — no Shorepine, no Cormorant Garamond, no Forest/Parchment palette. Residual code (`app/lib/shorepine.js`, the Cormorant load on `app/app/c/[slug]/layout.js`, and the three PDF generators `app/lib/generate-pdf.js` / `pdf-shared.js` / `generate-public-pdf.js`) migrates to Vector | WA palette + Playfair Display in `BRAND_COMPLIANCE_PLAN.md` Threads 43-44. Until those ship, that residual code is the gap and CLAUDE.md describes the v1.2 target state.
  - Codified after Thread 19 + 19.1 (2026-04-26 public-vs-internal split, since superseded — Footer.js's viewer-aware branch from 19.1 stays load-bearing for layered rendering, but the Shorepine attribution it once carried is gone in the v1.2 target state) and Thread 42 (2026-04-30 v1.2 brand adoption + Public/Registered/Team rename).
- DO NOT touch scoreBill() during 2027 session (Janâ€“Apr 2027). Frozen for calibration.
