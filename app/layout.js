import './globals.css'

export const metadata = {
  title: 'Vector | WA',
  description: 'WA Legislative Trajectory Intelligence — Shorepine Government Relations',
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
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      </head>
      <body style={{ backgroundColor: '#0b1a12' }}>{children}</body>
    </html>
  )
}
