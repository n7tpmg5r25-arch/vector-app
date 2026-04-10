import './globals.css'

export const metadata = {
  title: 'Vector | WA',
  description: 'WA Legislative Trajectory Intelligence',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Vector | WA',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    title: 'Vector | WA',
    description: 'WA Legislative Trajectory Intelligence by Shorepine Government Relations',
    siteName: 'Vector | WA',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Vector | WA',
    description: 'WA Legislative Trajectory Intelligence by Shorepine Government Relations',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0b1a12',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body style={{ backgroundColor: '#0b1a12' }}>{children}</body>
    </html>
  )
}
