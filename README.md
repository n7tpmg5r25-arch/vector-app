# Vector | WA

Free, open-source legislative intelligence for Washington State.

Vector | WA tracks every bill in the Washington State Legislature and scores its
trajectory from 0 to 99 -- a calibrated read on where a bill is headed, not just
where it is. The model is calibrated on 8,062 historical bills across three
biennia. The data is always free and public; signing in only adds a personal
watchlist and alerts.

Live at https://vectorwa.com

## Stack

- Next.js (App Router) on Vercel
- Supabase (Postgres + Auth + Edge Functions)
- GitHub Actions for the sync + alert pipeline
- Data source: the Washington State Legislature's official web services

## License

MIT -- see [LICENSE](./LICENSE).
