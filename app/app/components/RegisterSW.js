'use client'

import { useEffect } from 'react'

export default function RegisterSW() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failed — non-critical, app works fine without it
      })
    }
  }, [])

  return null
}
