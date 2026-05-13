// Thread 85 (2026-05-12) — per-segment metadata for /members.
// members/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Members — Vector | WA" in the browser tab.

export const metadata = {
  title: 'Members',
  description: 'Every Washington State legislator ranked by legislative success, with bill sponsorship history and committee assignments.',
  openGraph: {
    title: 'Members — Vector | WA',
    description: 'Every Washington State legislator ranked by legislative success, with bill sponsorship history and committee assignments.',
    url: 'https://vectorwa.com/members',
  },
  twitter: {
    title: 'Members — Vector | WA',
    description: 'Every Washington State legislator ranked by legislative success, with bill sponsorship history and committee assignments.',
  },
}

export default function MembersLayout({ children }) {
  return children
}
