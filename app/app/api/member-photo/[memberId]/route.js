/**
 * Vector | WA — Member Photo Proxy
 *
 * Thread 112 fix: params is a Promise in Next.js 15 — must be awaited
 * before destructuring memberId. Previously always returned 400 "Invalid member ID".
 */

export async function GET(request, { params }) {
  const { memberId } = await params   // ← Next.js 15: params is a Promise

  if (!memberId || !/^\d+$/.test(memberId)) {
    return new Response('Invalid member ID', { status: 400 })
  }

  try {
    const upstream = await fetch(
      `https://leg.wa.gov/memberphoto/${memberId}.jpg`,
      {
        headers: {
          'User-Agent': 'VectorWA/1.0 (+https://vectorwa.com)',
          Accept: 'image/jpeg,image/*',
        },
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
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
      },
    })
  } catch (err) {
    return new Response('Upstream error', { status: 502 })
  }
}
