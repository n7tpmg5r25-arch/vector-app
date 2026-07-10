// /roadmap segment metadata — Area 5 SEO audit (AUDIT-5 S1, 2026-07-09).
// The page component is 'use client', so metadata lives in this thin server
// layout. Built by pageMeta() (app/lib/page-metadata.js), which returns the
// COMPLETE openGraph + twitter objects — Next.js replaces those objects per
// segment instead of merging fields, so the previous partial overrides
// silently dropped og:image and the large Twitter card. pageMeta() also adds
// the self-referential canonical this route was missing.
import { pageMeta } from '../../lib/page-metadata'

export const metadata = pageMeta({
  title: 'Roadmap',
  description: 'What has shipped and what is coming next for Vector | WA.',
  path: '/roadmap',
})

export default function RoadmapLayout({ children }) {
  return children
}
