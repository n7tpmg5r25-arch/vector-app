import './globals.css'
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
        {/* iOS Add-to-Home-Screen icon. iOS 14+ supports SVG here; older iOS
            versions fall back to favicon. The SVG is the same square mark
            referenced by manifest.json (PWA install icon) so iOS + Android +
            desktop home-screen icons all match. */}
        <link rel="apple-touch-icon" href="/logos/vector-wa-app-icon.svg" />
        <link rel="apple-touch-icon" sizes="180x180" href="/logos/vector-wa-app-icon.svg" type="image/svg+xml" />
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
      </body>
    </html>
  )
}
