import './globals.css'

export const metadata = {
  title: 'Vector | WA',
  description: 'Free legislative intelligence for Washington State',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Vector | WA',
    statusBarStyle: 'black-translucent',
  },
  openGraph: {
    title: 'Vector | WA',
    description: 'Free legislative intelligence for Washington State — by Shorepine Civic Tech',
    siteName: 'Vector | WA',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'Vector | WA',
    description: 'Free legislative intelligence for Washington State — by Shorepine Civic Tech',
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
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body style={{ backgroundColor: '#0e1014' }}>{children}</body>
    </html>
  )
}
