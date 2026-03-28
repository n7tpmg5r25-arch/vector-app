'use client'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Home() {
  const [count, setCount] = useState(null)

  useEffect(() => {
    supabase
      .from('bills')
      .select('*', { count: 'exact', head: true })
      .eq('session', '2025-2026')
      .then(({ count, error }) => {
        if (error) setCount('Error: ' + error.message)
        else setCount(count)
      })
  }, [])

  return (
    <div style={{padding: 40, fontFamily: 'sans-serif'}}>
      <h1>Vector WA</h1>
      <p>Bills in database: {count === null ? 'Loading...' : count}</p>
    </div>
  )
}
