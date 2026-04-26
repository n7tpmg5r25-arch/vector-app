/**
 * useDebouncedValue — Vector | WA Thread 15.4 (2026-04-25)
 *
 * Tiny client-side debounce hook. Returns a value that lags `value` by
 * `delayMs`, resetting the timer on every change. Use to avoid firing a
 * fresh query on every keystroke in search inputs.
 *
 * Usage:
 *   const [query, setQuery] = useState('')
 *   const debouncedQuery = useDebouncedValue(query, 250)
 *   useEffect(() => { fetch(...) }, [debouncedQuery])
 *
 * Notes:
 *   • Caller keeps `query` for the input's `value` so typing stays
 *     responsive; only the network-driven effect reads `debouncedQuery`.
 *   • No deps beyond React; no scoring engine touch (G5 safe).
 */
'use client'
import { useEffect, useState } from 'react'

export function useDebouncedValue(value, delayMs = 250) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(t)
  }, [value, delayMs])

  return debounced
}

export default useDebouncedValue
