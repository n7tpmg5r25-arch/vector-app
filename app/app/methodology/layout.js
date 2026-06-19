// Thread 82 (2026-05-12) — per-segment metadata for /methodology.
// methodology/page.js is 'use client' so cannot export metadata directly.
// This thin server-component layout exports it instead — Next.js App Router
// merges it with the root layout metadata, with segment values winning on
// conflicts (title, description, og:*).
// Layout has no visible UI — it just passes children through.

export const metadata = {
  title: 'Methodology',
  description: 'How Vector | WA scores Washington State bills — open-source and calibrated on 8,062 bills across three bienniums. Plain-English explanation of trajectory scoring, momentum, and signal tiers.',
  openGraph: {
    title: 'Methodology — Vector | WA',
    description: 'How Vector | WA scores Washington State bills — open-source and calibrated on 8,062 bills across three bienniums. Plain-English explanation of trajectory scoring, momentum, and signal tiers.',
    url: 'https://vectorwa.com/methodology',
  },
  twitter: {
    title: 'Methodology — Vector | WA',
    description: 'How Vector | WA scores Washington State bills — open-source and calibrated on 8,062 bills across three bienniums. Plain-English explanation of trajectory scoring, momentum, and signal tiers.',
  },
}

export default function MethodologyLayout({ children }) {
  return children
}
