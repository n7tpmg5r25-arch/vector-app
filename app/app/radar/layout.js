// Thread R3 (2026-05-31) — per-segment metadata for /radar.
// radar/page.js is 'use client' so cannot export metadata directly.
// Thin server-component layout exports it so the root layout template
// renders "Radar — Vector | WA" in the browser tab.
// Registered-tier (owner-only) page — no description, no OG, no Twitter overrides.

export const metadata = {
  title: 'Radar',
}

export default function RadarLayout({ children }) {
  return children
}
