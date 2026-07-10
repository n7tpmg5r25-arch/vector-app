/**
 * page-metadata.js — shared per-page metadata builder (AUDIT-5 S1, 2026-07-09).
 *
 * Next.js metadata merging is a shallow REPLACE per top-level key: when a
 * segment layout exports its own `openGraph` or `twitter` object, the root
 * layout's object is discarded wholesale — not merged field-by-field. The
 * Thread 82/85 segment overrides set only title/description/url, which
 * silently dropped og:image, og:type, og:site_name, og:locale, twitter:image,
 * and downgraded the Twitter card to bare "summary" on nine routes
 * (live-confirmed in the Area 5 SEO audit, 2026-07-09).
 *
 * This helper returns the COMPLETE objects so a page can never lose the
 * shared fields again, and adds the self-referential canonical every page
 * was missing. Relative URLs resolve against metadataBase
 * (https://vectorwa.com) set in the root layout.
 *
 * Usage (server-component segment layout):
 *   import { pageMeta } from '../../lib/page-metadata'
 *   export const metadata = pageMeta({
 *     title: 'Methodology',          // root template appends — Vector | WA
 *     description: '...',            // keep <= 155 chars for SERP display
 *     path: '/methodology',
 *   })
 */

const OG_IMAGE = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'Vector | WA — Free, open-source legislative intelligence for Washington State',
}

export function pageMeta({ title, description, path }) {
  const fullTitle = `${title} — Vector | WA`
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: fullTitle,
      description,
      url: path,
      siteName: 'Vector | WA',
      type: 'website',
      locale: 'en_US',
      images: [OG_IMAGE],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: ['/og-image.png'],
    },
  }
}
