'use client'

import { useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

export default function LoginPage() {
const [email, setEmail] = useState('')
const [sent, setSent] = useState(false)
const [error, setError] = useState(null)
const [loading, setLoading] = useState(false)

const supabase = createBrowserClient(
process.env.NEXT_PUBLIC_SUPABASE_URL,
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

async function handleLogin(e) {
e.preventDefault()
setLoading(true)
setError(null)

const { error } = await supabase.auth.signInWithOtp({
email,
options: {
emailRedirectTo: `${window.location.origin}/auth/callback`,
},
})

if (error) {
setError(error.message)
setLoading(false)
} else {
setSent(true)
}
}

return (
<div style={{
minHeight: '100vh',
display: 'flex',
alignItems: 'center',
justifyContent: 'center',
backgroundColor: '#1e3a2f',
fontFamily: 'sans-serif'
}}>
<div style={{
backgroundColor: '#f5f0e8',
padding: '2rem',
borderRadius: '8px',
width: '100%',
maxWidth: '400px',
boxShadow: '0 4px 24px rgba(0,0,0,0.3)'
}}>
<h1 style={{ color: '#1e3a2f', marginBottom: '0.25rem', fontSize: '1.5rem', fontWeight: 'bold' }}>
VECTOR | WA
</h1>
<p style={{ color: '#5a6e63', marginBottom: '2rem', fontSize: '0.9rem' }}>
WA Legislature Intelligence
</p>

{sent ? (
<div style={{ textAlign: 'center' }}>
<p style={{ color: '#1e3a2f', fontWeight: 'bold', marginBottom: '0.5rem' }}>Check your email</p>
<p style={{ color: '#5a6e63', fontSize: '0.9rem' }}>We sent a magic link to {email}</p>
</div>
) : (
<form onSubmit={handleLogin}>
<div style={{ marginBottom: '1rem' }}>
<label style={{ color: '#1a1a1a', display: 'block', marginBottom: '0.4rem', fontSize: '0.85rem' }}>
Email
</label>
<input
type="email"
value={email}
onChange={(e) => setEmail(e.target.value)}
required
placeholder="your@email.com"
style={{
width: '100%',
padding: '0.6rem 0.75rem',
borderRadius: '4px',
border: '1px solid #d9d0c4',
backgroundColor: '#fff',
color: '#1a1a1a',
fontSize: '1rem',
boxSizing: 'border-box'
}}
/>
</div>

{error && (
<p style={{ color: '#b85c3a', marginBottom: '1rem', fontSize: '0.85rem' }}>
{error}
</p>
)}

<button
type="submit"
disabled={loading}
style={{
width: '100%',
padding: '0.75rem',
backgroundColor: loading ? '#5a6e63' : '#1e3a2f',
color: '#f5f0e8',
border: 'none',
borderRadius: '4px',
fontSize: '1rem',
cursor: loading ? 'not-allowed' : 'pointer'
}}
>
{loading ? 'Sending...' : 'Send Magic Link'}
</button>
</form>
)}
</div>
</div>
)
}