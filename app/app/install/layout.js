// Thread 85 (2026-05-12) — per-segment metadata for /install.
// install/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Install — Vector | WA" in the browser tab.

export const metadata = {
  title: 'Install',
  description: 'Install Vector | WA as a Progressive Web App on iOS, Android, or desktop.',
  openGraph: {
    title: 'Install — Vector | WA',
    description: 'Install Vector | WA as a Progressive Web App on iOS, Android, or desktop.',
    url: 'https://vectorwa.com/install',
  },
  twitter: {
    title: 'Install — Vector | WA',
    description: 'Install Vector | WA as a Progressive Web App on iOS, Android, or desktop.',
  },
}

export default function InstallLayout({ children }) {
  return children
}
