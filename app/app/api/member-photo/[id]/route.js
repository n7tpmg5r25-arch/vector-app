import { NextResponse } from 'next/server'

/**
 * GET /api/member-photo/[id]
 *
 * Same-origin proxy for a legislator's official photo, sourced from
 * leg.wa.gov/memberphoto/{id}.jpg. This exists ONLY so the member PDF
 * export (app/lib/generate-member-pdf.js) can draw the photo onto a
 * <canvas> and read it back out as base64 for jsPDF — leg.wa.gov doesn't
 * send CORS headers, so loading the image cross-origin taints the canvas
 * and jsPDF can't read the pixels back out. Routing it through our own
 * origin fixes that. (The on-screen member page can and does load
 * leg.wa.gov directly — plain <img> tags don't need CORS, only canvas
 * reads do.)
 *
 * Before this route existed, every PDF export silently fell back to the
 * initials tile, because the fetch to this (missing) path always 404'd
 * and loadImageAsBase64() treats any load failure as "no photo."
 */
export async function GET(request, { params }) {
  const { id } = await params

  // member_id is always a small numeric string (e.g. "34240"). Reject
  // anything else so we never forward attacker-controlled input into the
  // upstream URL.
  if (!/^\d+$/.test(id || '')) {
    return new NextResponse('Invalid member id', { status: 400 })
  }

  const upstreamUrl = `https://leg.wa.gov/memberphoto/${id}.jpg`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    const upstreamRes = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: {
        // Some WA state sites reject requests with no User-Agent.
        'User-Agent': 'Mozilla/5.0 (compatible; VectorWA/1.0; +https://vectorwa.com)',
      },
    })
    clearTimeout(timeout)

    if (!upstreamRes.ok) {
      // No photo on file for this member (or a leg.wa.gov hiccup) — let
      // the caller fall back to the initials tile instead of erroring.
      return new NextResponse('Photo not found', { status: 404 })
    }

    const imageBuffer = await upstreamRes.arrayBuffer()

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': upstreamRes.headers.get('content-type') || 'image/jpeg',
        // Member photos change rarely — cache a day in the browser and a
        // week on Vercel's edge so we're not re-fetching leg.wa.gov every
        // time someone exports a PDF.
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    })
  } catch (err) {
    console.error('/api/member-photo error:', err)
    return new NextResponse('Server error', { status: 502 })
  }
}
