/**
 * Vector | WA — Member photo proxy
 *
 * Thread 112: leg.wa.gov does not set CORS headers, so the browser's canvas
 * security model rejects toDataURL() on images loaded from that origin
 * (taints the canvas). This route handler fetches the photo server-to-server
 * (no CORS) and re-serves it same-origin so the PDF generator can draw it
 * without a security error.
 *
 * Route:  GET /api/member-photo/{memberId}
 * Proxies: https://leg.wa.gov/memberphoto/{memberId}.jpg
 *
 * Caches the upstream response for 7 days on the CDN edge (photos change at
 * most once per biennium — new class photos at session start).
 */
export async function GET(request, { params }) {
  const { memberId } = params

  // Validate: only numeric member IDs are valid (WA Leg uses integers)
  if (!memberId || !/^\d+$/.test(memberId)) {
    return new Response('Invalid member ID', { status: 400 })
  }

  try {
    const upstream = await fetch(
      `https://leg.wa.gov/memberphoto/${memberId}.jpg`,
      {
        headers: {
          // Identify ourselves politely — leg.wa.gov occasionally rate-limits
          // unknown user agents during high-traffic committee days
          'User-Agent': 'VectorWA/1.0 (+https://vectorwa.com)',
          Accept: 'image/jpeg,image/*',
        },
        // Next.js caches this fetch on the edge for 7 days
        next: { revalidate: 604800 },
      }
    )

    if (!upstream.ok) {
      return new Response('Photo not found', { status: 404 })
    }

    const buf = await upstream.arrayBuffer()

    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        // Edge + browser cache for 7 days; stale-while-revalidate adds 1 day
        // of grace so the PDF never blocks waiting on a cache miss
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    console.error('[member-photo] proxy error for memberId', memberId, err)
    return new Response('Upstream error', { status: 502 })
  }
}
