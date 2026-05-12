// Thread 82 (2026-05-12) — per-segment metadata for /about.
// about/page.js is 'use client' so cannot export metadata directly.
// This thin server-component layout exports it instead — Next.js App Router
// merges it with the root layout metadata, with segment values winning on
// conflicts (title, description, og:*).
// Layout has no visible UI — it just passes children through.

export const metadata = {
  title: 'About',
  description: 'Vector | WA is free legislative intelligence for Washington State — built by one person to make Olympia readable for everyone.',
  openGraph: {
    title: 'About — Vector | WA',
    description: 'Vector | WA is free legislative intelligence for Washington State — built by one person to make Olympia readable for everyone.',
    url: 'https://vectorwa.com/about',
  },
  twitter: {
    title: 'About — Vector | WA',
    description: 'Vector | WA is free legislative intelligence for Washington State — built by one person to make Olympia readable for everyone.',
  },
}

export default function AboutLayout({ children }) {
  return children
}
