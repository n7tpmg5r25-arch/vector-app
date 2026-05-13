'use client'
/**
 * useSession() — shared session hook for Vector | WA (Step 6D.1)
 *
 * Reads the selected session from localStorage, defaulting to the
 * current biennium from session-config.js. When the user switches
 * sessions via the SideDrawer, all mounted pages react in real time
 * without a hard reload.
 *
 * Propagation strategy (Thread 86):
 *   The native Web Storage `storage` event fires in OTHER windows/tabs
 *   but NOT in the same window that called localStorage.setItem. To
 *   propagate same-window changes we dispatch a custom window event
 *   `vec-session-change` whenever setSession() writes. Every useSession()
 *   instance that is mounted at the time (members, committees, hearings,
 *   search, etc.) receives the event and updates its local state, so
 *   pages already on screen re-render without a navigation or reload.
 *   Cross-tab sync is handled as a bonus via the native `storage` event.
 *
 * Returns: [session, setSession]
 *   session    — e.g. '2025-2026'
 *   setSession — updates localStorage + state + broadcasts to all consumers
 */
import { useState, useEffect } from 'react'
import { getCurrentSession } from './session-config'

const STORAGE_KEY = 'vector-wa-session'
const SESSION_EVENT = 'vec-session-change'

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

  // Same-window propagation: listen for vec-session-change so this
  // instance reacts when ANY other useSession() caller (e.g. SideDrawer)
  // updates the session while this page is already mounted.
  useEffect(() => {
    function onSessionChange(e) {
      const next = e.detail
      if (next && next !== session) {
        setSessionState(next)
      }
    }
    window.addEventListener(SESSION_EVENT, onSessionChange)
    return () => window.removeEventListener(SESSION_EVENT, onSessionChange)
  }, [session])

  // Cross-tab propagation: the native `storage` event fires in OTHER
  // windows when localStorage changes — keeps multi-tab use coherent.
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== STORAGE_KEY) return
      const next = e.newValue || getCurrentSession()
      setSessionState(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  function setSession(s) {
    localStorage.setItem(STORAGE_KEY, s)
    setSessionState(s)
    // Broadcast to all other mounted useSession() consumers in this window
    window.dispatchEvent(new CustomEvent(SESSION_EVENT, { detail: s }))
  }

  return [session, setSession]
}
