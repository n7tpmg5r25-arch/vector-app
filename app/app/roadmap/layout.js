// Thread 85 (2026-05-12) — per-segment metadata for /roadmap.
// roadmap/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Roadmap — Vector | WA" in the browser tab.

export const metadata = {
  title: 'Roadmap',
  description: 'What has shipped and what is coming next for Vector | WA.',
  openGraph: {
    title: 'Roadmap — Vector | WA',
    description: 'What has shipped and what is coming next for Vector | WA.',
    url: 'https://vectorwa.com/roadmap',
  },
  twitter: {
    title: 'Roadmap — Vector | WA',
    description: 'What has shipped and what is coming next for Vector | WA.',
  },
}

export default function RoadmapLayout({ children }) {
  return children
}
