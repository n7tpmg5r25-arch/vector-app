/**
 * /bill/[id] segment layout — per-bill metadata + Legislation JSON-LD
 * (AUDIT-5 S2, 2026-07-09).
 *
 * page.js is 'use client', so search metadata lives here. generateMetadata()
 * does one anonymous read of the bills row (bills is anon-readable by RLS,
 * verified in DASH-6) and returns a per-bill title, description, canonical,
 * and full social card — this puts "HB 1234 — <subject>" in the browser tab
 * today and in Google when the public layer launches. Unknown IDs and any
 * fetch error return {} so the page inherits the site defaults; metadata can
 * never break the render.
 *
 * The Legislation JSON-LD moved here from page.js (Thread 82 injected it
 * client-side) so crawlers get it server-rendered without executing JS.
 * React cache() dedupes the row read between generateMetadata() and the
 * layout body within a single request.
 */
import { cache } from 'react'
import { supabase } from '../../../lib/supabase'
import { getCurrentSession } from '../../../lib/session-config'

const getBill = cache(async (id) => {
  try {
    const { data } = await supabase
      .from('bills')
      .select('bill_id, bill_number, chamber, title, custom_summary, ai_summary, session')
      .eq('bill_id', id)
      .single()
    return data || null
  } catch {
    return null
  }
})

function billLabel(bill) {
  return `${bill.chamber === 'House' ? 'HB' : 'SB'} ${bill.bill_number}`
}

// Collapse whitespace and clip to a display budget on a clean boundary.
function clip(text, max) {
  if (!text) return ''
  const t = String(text).replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}\u2026`
}

export async function generateMetadata({ params }) {
  const { id } = await params
  const bill = await getBill(id)
  if (!bill) return {}
  const label = billLabel(bill)
  const title = clip(`${label} — ${bill.title || 'Washington State bill'}`, 70)
  const description = clip(
    bill.custom_summary || bill.ai_summary || bill.title || `Washington State bill ${label}`,
    155
  )
  const path = `/bill/${id}`
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

export default async function BillSegmentLayout({ children, params }) {
  const { id } = await params
  const bill = await getBill(id)
  // Same leg.wa.gov link rule as page.js (G4): bill.session first, current
  // session helper as fallback, never a hardcoded biennium literal.
  const sessionYear = bill ? String(bill.session || getCurrentSession()).split('-')[0] : null
  const jsonLd = bill ? {
    '@context': 'https://schema.org',
    '@type': 'Legislation',
    name: `${billLabel(bill)}: ${bill.title || ''}`,
    description: bill.custom_summary || bill.title || `Washington State bill ${bill.bill_number}`,
    legislationType: 'Bill',
    jurisdiction: {
      '@type': 'AdministrativeArea',
      name: 'Washington State',
    },
    url: `https://vectorwa.com/bill/${id}`,
    sameAs: `https://app.leg.wa.gov/billsummary?BillNumber=${bill.bill_number}&Year=${sessionYear}`,
  } : null
  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}
      {children}
    </>
  )
}
