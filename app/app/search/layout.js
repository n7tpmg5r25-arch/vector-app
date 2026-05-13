// Thread 85 (2026-05-12) — per-segment metadata for /search.
// search/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Search — Vector | WA" in the browser tab.

export const metadata = {
  title: 'Search',
  description: 'Search and filter all bills in the Washington State Legislature by category, stage, and trajectory score.',
  openGraph: {
    title: 'Search — Vector | WA',
    description: 'Search and filter all bills in the Washington State Legislature by category, stage, and trajectory score.',
    url: 'https://vectorwa.com/search',
  },
  twitter: {
    title: 'Search — Vector | WA',
    description: 'Search and filter all bills in the Washington State Legislature by category, stage, and trajectory score.',
  },
}

export default function SearchLayout({ children }) {
  return children
}
