import './globals.css'
import { Karla, Playfair_Display, DM_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'

// T157 perf pass: self-host the three brand fonts via next/font instead of the
// render-blocking @import that used to sit at the top of globals.css. next/font
// downloads the files at build time, serves them same-origin, preloads them,
// and exposes each as a CSS variable consumed by the --font-* tokens in
// globals.css. display:'swap' keeps text visible during load (no FOIT).
const karla = Karla({
  subsets: ['latin'],
  // AUDIT-6 S1 (2026-07-09): weight 300 dropped — zero uses repo-wide.
  weight: ['400', '500', '600', '700'],
  variable: '--font-karla',
  display: 'swap',
})
const playfair = Playfair_Display({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-playfair',
  display: 'swap',
})
const dmMono = DM_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-dm-mono',
  display: 'swap',
})
import RegisterSW from './components/RegisterSW'
import Footer from './components/Footer'
import SessionBanner from './components/SessionBanner'
import PublicBottomNav from './components/PublicBottomNav'
import SideDrawer from './components/SideDrawer'
import MergeLocalWatchlist from './components/MergeLocalWatchlist'

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
  description: 'Free, open-source legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vector | WA',
  },
  openGraph: {
    title: 'Vector | WA',
    description: 'Free, open-source legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
    siteName: 'Vector | WA',
    // AUDIT-5 S1 (2026-07-09): no site-level og:url — it stamped the homepage
    // URL onto every page that lacked its own OG override (a wrong-canonical
    // signal to social crawlers). Each page now carries its own og:url +
    // canonical via lib/page-metadata.js.
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Vector | WA — Free, open-source legislative intelligence for Washington State' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-image.png'],
    title: 'Vector | WA',
    description: 'Free, open-source legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
  },
}

// AUDIT-3 A5 (2026-07-03): the max-scale viewport cap was removed - it
// blocked pinch-zoom on Android (WCAG 1.4.4). Its original job (stopping
// iOS auto-zoom on input focus) is handled at the root cause by the T160
// 16px input floor.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0e1014',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${karla.variable} ${playfair.variable} ${dmMono.variable}`}>
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
        {/* PORTAL-4 (2026-06-11) -- register-to-sync. Mounted once here in
            the root layout, NOT /auth/callback: the OTP login path never
            visits the callback (it hard-reloads to /). Self-gates: flag
            off, signed out, or empty device list -> renders null and does
            nothing. See app/app/components/MergeLocalWatchlist.js. */}
        <MergeLocalWatchlist />
        {/* AUDIT-3 A3 (2026-07-03): main landmark so assistive tech can jump
            straight to page content past the fixed chrome. Unstyled block
            element - zero layout impact. */}
        <main>{children}</main>
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
            Tells Google who runs this site and links the canonical URL
            and logo. Renders server-side in
            the root layout so it appears on every page without JS. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'Vector | WA',
              url: 'https://vectorwa.com',
              logo: 'https://vectorwa.com/apple-touch-icon.png',
              description: 'Free, open-source legislative intelligence for Washington State. Track bills, read plain-English summaries, and see where legislation is headed in Olympia.',
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
