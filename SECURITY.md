# Security

## Reporting a vulnerability
Please email security concerns to **corrections@vectorwa.com** rather than opening a public issue.

## How secrets are handled
No credentials are stored in this repository. All secrets — the Supabase `service_role` key, the function secret, and third-party API keys (Resend, Anthropic) — live as **GitHub Actions secrets** and **Supabase / Vercel environment variables**, never in code.

The Supabase **anon / publishable** key shipped in the client is public by design; every database read/write is enforced by **Postgres Row-Level Security**, so the public key alone cannot reach another user's data.

## Automated protections
- **GitHub secret scanning + push protection** block known credential formats from being pushed.
- A **local pre-commit hook** (`.githooks/secret-scan.js`) scans staged changes for secrets and `.env` files before any commit. Enable it on a fresh clone with: `git config core.hooksPath .githooks`
