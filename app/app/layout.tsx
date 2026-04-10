import './globals.css'
import RegisterSW from './components/RegisterSW'

export const metadata = {
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      </head>
      <body style={{ backgroundColor: '#0b1a12' }}>
        <RegisterSW />
        {children}
      </body>
    </html>
  )
}
