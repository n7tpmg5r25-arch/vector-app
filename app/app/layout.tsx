import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import RegisterSW from './components/RegisterSW'
import Footer from './components/Footer'
import SessionBanner from './components/SessionBanner'
import PublicBottomNav from './components/PublicBottomNav'
import SideDrawer from './components/SideDrawer'

// Thread 82 (2026-05-12): metadataBase was pointing at the Vercel preview
// URL (vector-app-liard.vercel.app), which broke all og:url values in
// production. Fixed to canonical domain. Template added so per-page titles
// render as "Page — Vector | WA" without repeating the suffix in each file.
export const metadata = {
  metadataBase: new URL('https://vectorwa.com'),
  title: {
    default: 'Vector | WA',
    template: '%s — Vector | WA',
  },
  description: 'Free legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vector | WA',
  },
  openGraph: {
    title: 'Vector | WA',
    description: 'Free legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
    siteName: 'Vector | WA',
    url: 'https://vectorwa.com',
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Vector | WA — Free legislative intelligence for Washington State' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-image.png'],
    title: 'Vector | WA',
    description: 'Free legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0e1014',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* iOS Add-to-Home-Screen icon. iOS spec is PNG-only in practice -
            SVG support is technically there since iOS 14 but inconsistent
            and silently falls back to a default icon for many install flows.
            PNG is the reliable path. The PNG is rasterized from
            /logos/vector-wa-app-icon.svg at 180x180 (Apple's recommended size). */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body style={{ backgroundColor: '#0e1014' }}>
        <RegisterSW />
        <SessionBanner />
        {children}
        <Footer />
        {/* Thread 29 (2026-04-27) — anon bottom-nav. Globally mounted but
            self-gates per layer (G6): renders only when role === 'public'
            AND pathname is a public-layer surface. Owner + client viewers
            see nothing here so the existing authed Nav.js / portal segment
            chrome is not doubled. See app/app/components/PublicBottomNav.js. */}
        <PublicBottomNav />
        {/* Thread 55 (2026-05-01) — globally-mounted slide-out drawer.
            Triggered by HamburgerButton in Nav.js (owner/client) and
            PublicNav.js (public). Self-gates on viewer role per G6:
            renders Public / Owner / Client bodies branched by
            useViewer().capabilities.role. Closed by default; opens on
            `vec-drawer-open` window event; closes on Escape, outside
            click, route change, or `vec-drawer-close` event.
            See app/app/components/SideDrawer.js. */}
        <SideDrawer />
        {/* Thread 82 (2026-05-12) — Organization JSON-LD structured data.
            Tells Google who runs this site and links the canonical URL,
            social profiles, and sameAs entries. Renders server-side in
            the root layout so it appears on every page without JS. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Vector | WA',
              url: 'https://vectorwa.com',
              description: 'Free legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
              areaServed: {
                '@type': 'AdministrativeArea',
                name: 'Washington State',
              },
            }),
          }}
        />
        {/* Vercel Analytics (2026-04-29) — first-party page-view tracking.
            Privacy-friendly (no cookies, no PII). Free tier on Hobby plan
            covers 2,500 events/month, ample headroom for pre-launch
            traffic. Mounted last in <body> per Vercel docs to avoid
            blocking page hydration. Pulls config from VERCEL_* env vars
            automatically — no manual setup needed. */}
        <Analytics />
      </body>
    </html>
  )
}
