import './globals.css'
import { Analytics } from '@vercel/analytics/next'
import RegisterSW from './components/RegisterSW'
import Footer from './components/Footer'
import SessionBanner from './components/SessionBanner'
import PublicBottomNav from './components/PublicBottomNav'

export const metadata = {
  metadataBase: new URL('https://vector-app-liard.vercel.app'),
  title: 'Vector | WA',
  description: 'Washington State legislative intelligence',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vector | WA',
  },
  openGraph: {
    title: 'Vector | WA',
    description: 'Washington State legislative intelligence',
    siteName: 'Vector | WA',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Vector | WA — Free legislative intelligence for Washington State' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-image.png'],
    title: 'Vector | WA',
    description: 'Washington State legislative intelligence',
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
