import './globals.css'
import RegisterSW from './components/RegisterSW'

export const metadata = {
  metadataBase: new URL('https://vector-app-liard.vercel.app'),
  title: 'Vector | WA',
  description: 'WA Legislative Trajectory Intelligence',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Vector | WA',
  },
  openGraph: {
    title: 'Vector | WA',
    description: 'WA Legislative Trajectory Intelligence by Shorepine Government Relations',
    siteName: 'Vector | WA',
    type: 'website',
    images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'Vector | WA Legislative Trajectories' }],
  },
  twitter: {
    card: 'summary_large_image',
    images: ['/og-image.png'],
    title: 'Vector | WA',
    description: 'WA Legislative Trajectory Intelligence by Shorepine Government Relations',
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
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body style={{ backgroundColor: '#0e1014' }}>
        <RegisterSW />
        {children}
      </body>
    </html>
  )
}
