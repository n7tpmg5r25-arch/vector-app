'use client'
/**
 * useSession() — shared session hook for Vector | WA (Step 6D.1)
 *
 * Reads the selected session from localStorage, defaulting to the
 * current biennium from session-config.js. When the user switches
 * sessions via the home page dropdown, all pages pick it up on
 * their next render (or navigation).
 *
 * Returns: [session, setSession]
 *   session    — e.g. '2025-2026'
 *   setSession — updates localStorage + state
 */
import { useState, useEffect } from 'react'
import { getCurrentSession } from './session-config'

const STORAGE_KEY = 'vector-wa-session'

export function useSession() {
  const [session, setSessionState] = useState(() => {
    if (typeof window === 'undefined') return getCurrentSession()
    return localStorage.getItem(STORAGE_KEY) || getCurrentSession()
  })

  // Sync with localStorage on mount (handles SSR hydration mismatch)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && stored !== session) {
      setSessionState(stored)
    }
  }, [])

  function setSession(s) {
    localStorage.setItem(STORAGE_KEY, s)
    setSessionState(s)
  }

  return [session, setSession]
}
