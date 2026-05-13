// Thread 85 (2026-05-12) — per-segment metadata for /committees.
// committees/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Committees — Vector | WA" in the browser tab.
// NOTE: /committees/[slug] is a dynamic route and does NOT get a layout.js —
// dynamic per-slug metadata would need generateMetadata() in that segment.

export const metadata = {
  title: 'Committees',
  description: 'All Washington State legislative committees with bill counts, hearing schedules, and pass rates.',
  openGraph: {
    title: 'Committees — Vector | WA',
    description: 'All Washington State legislative committees with bill counts, hearing schedules, and pass rates.',
    url: 'https://vectorwa.com/committees',
  },
  twitter: {
    title: 'Committees — Vector | WA',
    description: 'All Washington State legislative committees with bill counts, hearing schedules, and pass rates.',
  },
}

export default function CommitteesLayout({ children }) {
  return children
}
