/**
 * /committees/[slug] segment layout — per-committee metadata
 * (AUDIT-5 S2, 2026-07-09).
 *
 * page.js is 'use client', so metadata lives here. One anon read of the
 * committees row; title carries the chamber because both chambers have
 * same-named committees (Transportation, etc.) and titles must be unique.
 * Unknown slugs and fetch errors return {} (site defaults) — metadata can
 * never break the render.
 */
import { cache } from 'react'
import { supabase } from '../../../lib/supabase'

const getCommittee = cache(async (slug) => {
  try {
    const { data } = await supabase
      .from('committees')
      .select('name, chamber, slug')
      .eq('slug', slug)
      .single()
    return data || null
  } catch {
    return null
  }
})

export async function generateMetadata({ params }) {
  const { slug } = await params
  const committee = await getCommittee(slug)
  if (!committee) return {}
  const title = `${committee.name} (${committee.chamber})`
  const description = `Bills in committee, upcoming hearings, and pass-rate intelligence for the Washington State ${committee.chamber} ${committee.name} committee.`
  const path = `/committees/${slug}`
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
      images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Vector | WA' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      images: ['/og-image.png'],
    },
  }
}

export default function CommitteeSegmentLayout({ children }) {
  return children
}
