// Thread 85 (2026-05-12) — per-segment metadata for /changelog.
// changelog/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Changelog — Vector | WA" in the browser tab.

export const metadata = {
  title: 'Changelog',
  description: 'Release notes for Vector | WA — what changed and when.',
  openGraph: {
    title: 'Changelog — Vector | WA',
    description: 'Release notes for Vector | WA — what changed and when.',
    url: 'https://vectorwa.com/changelog',
  },
  twitter: {
    title: 'Changelog — Vector | WA',
    description: 'Release notes for Vector | WA — what changed and when.',
  },
}

export default function ChangelogLayout({ children }) {
  return children
}
