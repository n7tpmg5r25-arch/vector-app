import { createClient } from '@supabase/supabase-js'
import { createBrowserClient as createBrowserClientSSR } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// For server components and API routes
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// For client components (with auth) — replaces createClientComponentClient
export function createBrowserClient() {
  return createBrowserClientSSR(supabaseUrl, supabaseAnonKey)
}
