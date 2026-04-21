import './globals.css'

const OWNER = 'Shorepine Government Relations'
const DESCRIPTION = `Free legislative intelligence for Washington State \u2014 a product of ${OWNER}.`

export const metadata = {
  title: {
    default: 'Vector | WA',
    template: '%s \u00b7 Vector | WA',
  },
  description: DESCRIPTION,
  manifest: '/manifest.json',
  applicationName: 'Vector | WA',
  authors: [{ name: OWNER }],
  creator: OWNER,
  publisher: OWNER,
  appleWebApp: {
    capable: true,
    title: 'Vector | WA',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/logos/vector-wa-primary.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'Vector | WA',
    description: DESCRIPTION,
    siteName: 'Vector | WA',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Vector | WA',
    description: DESCRIPTION,
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0e1014',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: '#0e1014' }}>{children}</body>
    </html>
  )
}
