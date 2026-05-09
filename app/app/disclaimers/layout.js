/**
 * Disclaimers route metadata (Phase 5 polish, 2026-05-01).
 *
 * Created when disclaimers/page.js converted to a 'use client' component
 * to match the about / methodology / install shell pattern (sticky
 * locked HEADER for authed viewers, conditional PublicNav for anon).
 * 'use client' files cannot export `metadata`, so the SEO export lives
 * here in the segment layout instead. Same effective output -- Next.js
 * merges layout metadata into the page metadata at build time.
 */
export const metadata = {
  title: 'Disclaimers - Vector | WA',
  description: 'Data sources, methodology, limitations, and contact for Vector | WA.',
}

export default function DisclaimersLayout({ children }) {
  return children
}
