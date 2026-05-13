// Thread 85 (2026-05-12) — per-segment metadata for /watchlist.
// watchlist/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Watchlist — Vector | WA" in the browser tab.
// Auth-gated page — no description, no OG, no Twitter overrides.

export const metadata = {
  title: 'Watchlist',
}

export default function WatchlistLayout({ children }) {
  return children
}
