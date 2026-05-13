// Thread 85 (2026-05-12) — per-segment metadata for /login.
// login/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Sign In — Vector | WA" in the browser tab.
// No OG or Twitter overrides — root layout OG is correct for auth-adjacent pages.

export const metadata = {
  title: 'Sign In',
  description: 'Sign in to Vector | WA to track bills, set alerts, and access your watchlist.',
}

export default function LoginLayout({ children }) {
  return children
}
