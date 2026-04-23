'use client'
/**
 * CohortCitation — a single, live citation of the trajectory-scoring
 * calibration cohort (bill count + biennia list). Closes DATA_FRESHNESS #23.
 *
 * Replaces the three hardcoded "8,062 bills across three biennia (2021-22,
 * 2023-24, 2025-26)" prose citations that lived in settings/page.js,
 * bill/[id]/page.js, and disclaimers/page.js. All three sites now render
 * live values from fetchTotalScoredBills() in app/lib/app-stats.js.
 *
 * The hardcoded 8,062 / 3-biennia fallback matches the scoreBill()
 * calibration cohort as of the 2025-26 biennium, so the page reads
 * correctly if the query fails. scoreBill() is frozen for 2027 session
 * calibration — this component is display-only, no scoring impact.
 *
 * Variants:
 *  - "bills-first"   (default): "8,062 bills spanning three biennia (2021-22, 2023-24, and 2025-26)"
 *  - "biennia-first":           "three biennia (2021-22, 2023-24, and 2025-26 — 8,062 bills)"
 */
import { useEffect, useState } from 'react'
import { createBrowserClient } from '../../lib/supabase'
import { fetchTotalScoredBills, joinBiennia } from '../../lib/app-stats'

// Fallback matches the engine calibration cohort (scoreBill() as of 2025-26).
const FALLBACK_TOTAL = 8062
const FALLBACK_BIENNIA = ['2021-2022', '2023-2024', '2025-2026']

// "3" for three-biennia copy. If you ever recalibrate across 2 or 4, this
// string-to-number helper keeps the prose grammatical.
const COUNT_WORDS = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six' }
function biennaCountWord(n) {
  return COUNT_WORDS[n] || String(n)
}

function formatTotal(n) {
  return typeof n === 'number' ? n.toLocaleString('en-US') : String(n)
}

export default function CohortCitation({ variant = 'bills-first' }) {
  const [total, setTotal] = useState(FALLBACK_TOTAL)
  const [biennia, setBiennia] = useState(FALLBACK_BIENNIA)

  useEffect(() => {
    let cancelled = false
    const sb = createBrowserClient()
    fetchTotalScoredBills(sb)
      .then((stats) => {
        if (cancelled) return
        if (stats && stats.ok && stats.total > 0 && stats.biennia.length > 0) {
          setTotal(stats.total)
          setBiennia(stats.biennia)
        }
      })
      .catch(() => { /* keep fallback */ })
    return () => { cancelled = true }
  }, [])

  const countWord = biennaCountWord(biennia.length)
  const biennaList = joinBiennia(biennia)
  const totalStr = formatTotal(total)

  if (variant === 'biennia-first') {
    return <span>{countWord} biennia ({biennaList} &mdash; {totalStr} bills)</span>
  }
  // default: bills-first
  return <span>{totalStr} bills spanning {countWord} biennia ({biennaList})</span>
}
