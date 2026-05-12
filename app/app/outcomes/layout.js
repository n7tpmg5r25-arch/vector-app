// Thread 82 (2026-05-12) — per-segment metadata for /outcomes.
// outcomes/page.js is 'use client' so cannot export metadata directly.
// This thin server-component layout exports it instead — Next.js App Router
// merges it with the root layout metadata, with segment values winning on
// conflicts (title, description, og:*).
// Layout has no visible UI — it just passes children through.
//
// Note: /outcomes is currently behind the public-layer flag in production
// (isPublicLayerRoute in proxy.js). Metadata ships now so Google picks it up
// immediately when the flag turns on at the Aug 2027 public launch.

export const metadata = {
  title: 'Outcomes',
  description: 'Browse Washington State bill outcomes by session — filter by chamber, final status, and score tier. See which bills became law, passed their chamber, or died in committee.',
  openGraph: {
    title: 'Outcomes — Vector | WA',
    description: 'Browse Washington State bill outcomes by session — filter by chamber, final status, and score tier. See which bills became law, passed their chamber, or died in committee.',
    url: 'https://vectorwa.com/outcomes',
  },
  twitter: {
    title: 'Outcomes — Vector | WA',
    description: 'Browse Washington State bill outcomes by session — filter by chamber, final status, and score tier. See which bills became law, passed their chamber, or died in committee.',
  },
}

export default function OutcomesLayout({ children }) {
  return children
}
