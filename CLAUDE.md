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
- Brand system: **Shorepine Government Relations v4.6** (adopted 2026-04-20). Shorepine GR is the firm; Vector | WA is the product. App UI uses the Vector | WA palette (Dark Neutral `#0e1014`, Card `#171921`, Brass `#b8975a`, Brass-Lt `#d4b47a`). Firm-branded internal surfaces (PDF brief, email headers, client-portal `/c/[slug]/*`) use the Shorepine palette (Forest `#1a4a2e`, Parchment `#f5f0e6`, Slate `#4a5060`, Ink `#1c1c1c`). Type: Karla for all Vector | WA UI body; Cormorant Garamond for firm display only (PDF title, email header). Primary logo at `app/public/logos/vector-wa-primary.svg`. See `BRAND_V46_ROLLOUT_PLAN.md` and `shorepine-brand-guide-v46.pdf`.
- **Public-vs-internal brand surfaces (Phase 2 directive D1, 2026-04-26 — Thread 19).** The public-facing site (any anon-reachable page: `/`, `/search`, `/bill/[id]`, `/members`, `/committees`, `/committees/[slug]`, `/hearings`, `/how-it-works`, `/methodology`, `/outcomes`, `/disclaimers`) must NOT mention Shorepine Government Relations in any visible copy, footer, meta tag, PWA manifest, or og:* attribute. Public footer reads: `Public site launching mid 2027.` (the firm-attribution line `Vector | WA — a product of Shorepine Government Relations.` was removed in Thread 19, commit on `public-brand-reset` branch). **Internal surfaces keep the existing Shorepine v4.6 ownership line + Forest/Parchment/Slate/Ink palette + Cormorant Garamond display type:** `/c/[slug]/*` (paying-client portal), the PDF brief generator (`app/lib/generate-pdf.js`), the weekly digest email layout, and admin pages. The split exists because Shorepine GR launches Sep 2027 separately — until then, the public Vector | WA site can't claim a not-yet-launched firm as its parent. When in doubt about whether a surface is public or internal: check whether `useViewer()` returns `isAnonPublic = true` for unauthenticated visitors; if yes, it's public.
- DO NOT touch scoreBill() during 2027 session (Janâ€“Apr 2027). Frozen for calibration.
