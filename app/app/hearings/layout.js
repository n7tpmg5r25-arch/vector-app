// Thread 85 (2026-05-12) — per-segment metadata for /hearings.
// hearings/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Hearings — Vector | WA" in the browser tab.

export const metadata = {
  title: 'Hearings',
  description: 'Upcoming Washington State legislative committee hearings.',
  openGraph: {
    title: 'Hearings — Vector | WA',
    description: 'Upcoming Washington State legislative committee hearings.',
    url: 'https://vectorwa.com/hearings',
  },
  twitter: {
    title: 'Hearings — Vector | WA',
    description: 'Upcoming Washington State legislative committee hearings.',
  },
}

export default function HearingsLayout({ children }) {
  return children
}
