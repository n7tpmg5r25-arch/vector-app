'use client'
/**
 * SideDrawer — Phase 5 Thread 55 (2026-05-01)
 *
 * Globally-mounted, viewer-aware slide-out drawer. Triggered by the
 * HamburgerButton in Nav.js (owner/client) and PublicNav.js (public).
 * Mounted as a sibling to Footer in app/app/layout.tsx.
 *
 * Three-layer branching (G6 Layer Discipline, per CLAUDE.md):
 *   - Public  → Sign in CTA + utility links (Disclaimers / About /
 *               Methodology / How it works).
 *   - Owner   → profile chip (email + role badge) + Watchlist (with count
 *               badge) + Settings + Admin (only when isAdmin(user)) +
 *               Reference links (Disclaimers / About / Methodology /
 *               How it works) mirroring the public drawer for parity +
 *               Sign Out (Rust functional palette per Brand Guide v1.2
 *               §02; destructive treatment).
 *   - Client  → above + Team portal link to /c/[slug] resolved via a
 *               cheap client_users → clients(slug) join.
 *
 * Footer parity (Thread 58, 2026-05-01):
 *   The Footer link rail used to render Disclaimers / About / Methodology /
 *   How it works on every route across all three layers. With the registered
 *   drawer now carrying these links, Footer.js was gated to render Row 2 for
 *   role === 'public' only — owner/client surfaces get a leaner footer
 *   (legal + byline + freshness) and reach reference pages via the drawer.
 *
 * Biennium-aware subtitle (session-config.js):
 *   - Interim period → "Pre-filing opens in {N} days"
 *   - Active session → "{getCurrentSession()} active session"
 *
 * Animation: 220ms slide from left, cubic-bezier(0.4, 0, 0.2, 1).
 * Backdrop: solid rgba(14,16,20,0.7). No backdrop-filter blur — keeps
 * Android/older iOS perf cheap (Brand Guide v1.2 §02 — premium with
 * restraint; perf budget over glass effect).
 *
 * Accessibility:
 *   - role="dialog", aria-modal="true", aria-labelledby on the wordmark.
 *   - Escape closes; outside-click (on backdrop) closes.
 *   - Focus moves to first interactive on open; Tab cycles inside the
 *     drawer (focus trap); on close, focus returns to the trigger via the
 *     `vec-drawer-close` event channel (HamburgerButton listens too).
 *   - Body scroll-locked while open.
 *
 * Open/close contract:
 *   - HamburgerButton dispatches `vec-drawer-open` / `vec-drawer-close`
 *     window events.
 *   - SideDrawer listens for both, plus closes itself on route change so
 *     the drawer never persists across navigations.
 *
 * Mobile-only by design (CLAUDE.md mobile-only directive).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, usePathname } from 'next/navigation'
import { Settings as SettingsIcon } from 'lucide-react'
import { createBrowserClient } from '../../lib/supabase'
import { useViewer } from '../../lib/viewer-capabilities'
import { isAdmin } from '../../lib/admin'
import {
  isInterimPeriod,
  getCurrentSession,
  getNextBiennium,
  daysUntil,
  getAllSessions,
} from '../../lib/session-config'
import { useSession } from '../../lib/useSession'
import { getVersionLabel } from '../../lib/version'

const DRAWER_WIDTH = 300
const SLIDE_MS = 220
const SLIDE_EASE = 'cubic-bezier(0.4, 0, 0.2, 1)'

export default function SideDrawer() {
  const [open, setOpen] = useState(false)
  const [watchlistCount, setWatchlistCount] = useState(null)
  const [teamSlug, setTeamSlug] = useState(null)
  const drawerRef = useRef(null)
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createBrowserClient()
  const { user, capabilities, loading: viewerLoading } = useViewer()
  const role = capabilities?.role

  // ─── Biennium-aware subtitle ───────────────────────────────────────
  const subtitle = useMemo(() => {
    if (isInterimPeriod()) {
      const next = getNextBiennium()
      const preFile = next?.prefilingOpens
      if (preFile) {
        const days = daysUntil(preFile)
        if (days <= 0) return `Pre-filing now open`
        return `Pre-filing opens in ${days} day${days === 1 ? '' : 's'}`
      }
      return 'Interim period'
    }
    return `${getCurrentSession()} active session`
  }, [])

  // ─── Open / close event channel ────────────────────────────────────
  const close = useCallback(() => {
    setOpen(false)
    // Notify HamburgerButton (and any future listener) so aria-expanded
    // and other mirrored state stay correct even when the drawer closes
    // itself (Escape, outside-click, route change).
    window.dispatchEvent(new CustomEvent('vec-drawer-close'))
  }, [])

  useEffect(() => {
    function onOpen() { setOpen(true) }
    function onClose() { setOpen(false) }
    window.addEventListener('vec-drawer-open', onOpen)
    window.addEventListener('vec-drawer-close', onClose)
    return () => {
      window.removeEventListener('vec-drawer-open', onOpen)
      window.removeEventListener('vec-drawer-close', onClose)
    }
  }, [])

  // Auto-close on route change so the drawer never persists past a nav.
  useEffect(() => {
    if (open) close()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Escape key + body scroll-lock while open.
  useEffect(() => {
    if (!open) return
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, close])

  // Move focus into the drawer on open.
  useEffect(() => {
    if (!open || !drawerRef.current) return
    const focusable = drawerRef.current.querySelector(
      'a, button, [tabindex]:not([tabindex="-1"])'
    )
    if (focusable && typeof focusable.focus === 'function') {
      focusable.focus()
    }
  }, [open])

  // ─── Watchlist count (owner + client only) ─────────────────────────
  // head:true keeps the round-trip cheap; we only need the count, never
  // the rows. Re-fetch only when the user identity changes — lightweight
  // and avoids hammering the count query on every drawer open.
  useEffect(() => {
    let mounted = true
    if (viewerLoading || !user || (role !== 'owner' && role !== 'client')) {
      setWatchlistCount(null)
      return () => { mounted = false }
    }
    supabase
      .from('tracked_bills')
      .select('bill_id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .then(({ count, error }) => {
        if (!mounted) return
        if (error) {
          setWatchlistCount(null)
          return
        }
        setWatchlistCount(typeof count === 'number' ? count : null)
      })
    return () => { mounted = false }
  }, [user?.id, role, viewerLoading, supabase])

  // ─── Team portal slug (client tier only) ───────────────────────────
  // Mirrors the resolveLandingPath() lookup in app/auth/callback/page.js
  // so the Team portal link in the drawer always lands on the same /c/
  // route the user is provisioned against. Single client_users row +
  // joined clients(slug); RLS keeps this scoped to the viewer.
  useEffect(() => {
    let mounted = true
    if (viewerLoading || !user || role !== 'client') {
      setTeamSlug(null)
      return () => { mounted = false }
    }
    supabase
      .from('client_users')
      .select('clients(slug)')
      .order('invited_at', { ascending: true })
      .limit(1)
      .then(({ data, error }) => {
        if (!mounted) return
        if (error) {
          setTeamSlug(null)
          return
        }
        const slug = data?.[0]?.clients?.slug
        setTeamSlug(slug || null)
      })
    return () => { mounted = false }
  }, [user?.id, role, viewerLoading, supabase])

  async function handleSignOut() {
    close()
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ─── Don't render while viewer is loading (prevents content flash) ──
  // The drawer itself (its trigger) is mounted on Nav surfaces which
  // already gate on !viewerLoading, but mounting here is global so we
  // also wait for resolution before deciding what to render.
  if (viewerLoading) return null

  // ─── Render ────────────────────────────────────────────────────────
  return (
    <>
      {/* Backdrop — solid 70% opacity over the dark neutral. Click to close. */}
      <div
        aria-hidden="true"
        onClick={close}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14, 16, 20, 0.7)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: `opacity ${SLIDE_MS}ms ${SLIDE_EASE}`,
          zIndex: 998,
        }}
      />

      {/* Drawer panel — slides in from the left. */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vec-drawer-title"
        aria-hidden={!open}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: DRAWER_WIDTH,
          maxWidth: '85vw',
          background: 'var(--bg-card, #171921)',
          borderRight: '1px solid var(--border, #2a2d38)',
          boxShadow: '4px 0 24px rgba(0, 0, 0, 0.45)',
          transform: open ? 'translateX(0)' : `translateX(-${DRAWER_WIDTH + 24}px)`,
          transition: `transform ${SLIDE_MS}ms ${SLIDE_EASE}`,
          zIndex: 999,
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'var(--font-body, Karla, sans-serif)',
          overflowY: 'auto',
        }}
      >
        <DrawerHeader subtitle={subtitle} onClose={close} />

        <div style={{ padding: '8px 0 24px', flex: 1 }}>
          {role === 'public' && <PublicBody onClose={close} />}
          {role === 'owner' && (
            <AuthedBody
              user={user}
              role="owner"
              watchlistCount={watchlistCount}
              teamSlug={null}
              onSignOut={handleSignOut}
            />
          )}
          {role === 'client' && (
            <AuthedBody
              user={user}
              role="client"
              watchlistCount={watchlistCount}
              teamSlug={teamSlug}
              onSignOut={handleSignOut}
            />
          )}
        </div>
      </aside>
    </>
  )
}

/* ────────────────────────────────────────────────────────────────────
   DrawerHeader — wordmark + biennium-aware subtitle + close button.
   Wordmark uses Playfair Display per Brand Guide v1.2 §02 type system.
   ──────────────────────────────────────────────────────────────────── */
function DrawerHeader({ subtitle, onClose }) {
  return (
    <header
      style={{
        padding: '20px 20px 16px',
        borderBottom: '1px solid var(--border, #2a2d38)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span
          id="vec-drawer-title"
          style={{
            fontFamily: 'var(--font-display, "Playfair Display", serif)',
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--text-primary, #e8e9ec)',
            letterSpacing: '0.01em',
          }}
        >
          Vector | WA
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono, "DM Mono", monospace)',
            fontSize: 10,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-muted, #6c7078)',
          }}
        >
          {subtitle}
        </span>
        {/* Version pill — Phase 6 Thread 59 (2026-05-02) seeded the static
            span; Thread 60 (2026-05-02) wrapped it in a Link to /changelog
            so the pill becomes a transparency entry point. DM Mono caption
            per Brand Guide v1.2 §02 metadata voice. The Link inherits the
            mono caption styling; the inner <span> keeps the same visual
            treatment from Thread 59 so this swap is visually byte-equivalent
            outside the new hover/underline states. The drawer's pathname
            effect already auto-closes on route change, so no extra
            close-on-click is strictly required, but onClose is wired
            anyway for snappy perceived dismiss. */}
        <Link
          href="/changelog"
          onClick={onClose}
          style={{
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono, "DM Mono", monospace)',
              fontSize: 9,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--text-faint, #6c7078)',
            }}
          >
            {getVersionLabel()}
          </span>
        </Link>
      </div>
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        style={{
          width: 32,
          height: 32,
          background: 'transparent',
          border: 'none',
          borderRadius: 6,
          cursor: 'pointer',
          color: 'var(--text-muted, #6c7078)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          flexShrink: 0,
        }}
      >
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </header>
  )
}

/* ────────────────────────────────────────────────────────────────────
   PublicBody — Sign in CTA + utility links. No upsell (Brand v1.2 §08).
   ──────────────────────────────────────────────────────────────────── */
function PublicBody({ onClose }) {
  return (
    <nav aria-label="Public menu" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Sign in — primary CTA, brass treatment */}
      <div style={{ padding: '12px 20px 16px' }}>
        <Link
          href="/login"
          onClick={onClose}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            padding: '10px 16px',
            background: 'var(--brass, var(--teal))',
            border: '1px solid var(--brass, var(--teal))',
            borderRadius: 6,
            color: 'var(--bg, #0e1014)',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          Sign in
        </Link>
      </div>

      <SectionDivider />

      <DrawerLink href="/disclaimers" onClose={onClose}>Disclaimers</DrawerLink>
      <DrawerLink href="/about" onClose={onClose}>About</DrawerLink>
      <DrawerLink href="/roadmap" onClose={onClose}>Roadmap</DrawerLink>
      <DrawerLink href="/methodology" onClose={onClose}>Methodology</DrawerLink>
      <DrawerLink href="/install" onClose={onClose}>Install</DrawerLink>
    </nav>
  )
}

/* ────────────────────────────────────────────────────────────────────
   AuthedBody — owner + client share most rows; client adds Team portal.
   Profile chip uses email + role badge for v1 (Brand v1.2 §08; full
   profile-name lift deferred to Phase 6 per Thread 55 spec).
   ──────────────────────────────────────────────────────────────────── */
function AuthedBody({ user, role, watchlistCount, teamSlug, onSignOut }) {
  const showAdmin = isAdmin(user)
  const roleLabel = role === 'client' ? 'TEAM' : 'EARLY ACCESS'
  const email = user?.email || '—'
  const [session, setSession] = useSession()
  const sessions = getAllSessions()
  const showPicker = sessions.length > 1

  return (
    <nav
      aria-label="Account menu"
      style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
    >
      {/* Profile chip */}
      <div style={{ padding: '12px 20px 16px' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: '12px 14px',
            background: 'rgba(184,151,90,0.06)',
            border: '1px solid rgba(184,151,90,0.30)',
            borderRadius: 10,
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: '0.10em',
              textTransform: 'uppercase',
              color: 'var(--brass-light, var(--gold))',
              fontFamily: 'var(--font-mono, "DM Mono", monospace)',
              fontWeight: 600,
            }}
          >
            {roleLabel}
          </span>
          <span
            style={{
              fontSize: 13,
              color: 'var(--text-primary, #e8e9ec)',
              wordBreak: 'break-all',
              lineHeight: 1.3,
            }}
          >
            {email}
          </span>
        </div>
      </div>

      <SectionDivider />

      {role === 'client' && teamSlug && (
        <DrawerLink href={`/c/${teamSlug}`} onClose={() => {}}>
          Team portal
        </DrawerLink>
      )}

      <DrawerLink
        href="/watchlist"
        onClose={() => {}}
        rightSlot={
          typeof watchlistCount === 'number' && watchlistCount > 0 ? (
            <CountBadge value={watchlistCount} />
          ) : null
        }
      >
        Watchlist
      </DrawerLink>

      {showAdmin && (
        <DrawerLink href="/admin/clients" onClose={() => {}}>Admin</DrawerLink>
      )}

      <SectionDivider />

      {/* Session picker — only renders when more than one session exists
          (getAllSessions() grows automatically: 2027-2028 is added on
          Dec 1 2026 when prefilingOpens triggers; historical sessions
          are always present). useSession() persists the choice to
          localStorage so every page that calls useSession() picks it up.
          Thread 83: global session context. */}
      {showPicker && (
        <div style={{ padding: '10px 20px 14px' }}>
          <div style={{
            fontSize: 9,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: 'var(--text-faint, #6c7078)',
            fontFamily: 'var(--font-mono, "DM Mono", monospace)',
            fontWeight: 600,
            marginBottom: 6,
          }}>
            Session
          </div>
          {/* Native select — compact single-row control (vs. stacked buttons).
              Styled with a custom brass chevron arrow; appearance:none drops
              the OS default arrow on all browsers. Options auto-expand when
              getAllSessions() adds 2027-2028 on Dec 1 2026. */}
          <div style={{ position: 'relative' }}>
            <select
              value={session}
              onChange={e => setSession(e.target.value)}
              aria-label="Select session"
              style={{
                width: '100%',
                background: 'var(--bg, #0e1014)',
                border: '1px solid rgba(184,151,90,0.40)',
                borderRadius: 6,
                padding: '7px 32px 7px 10px',
                fontSize: 12,
                color: 'var(--brass-light, var(--gold))',
                fontFamily: 'var(--font-mono, "DM Mono", monospace)',
                letterSpacing: '0.04em',
                cursor: 'pointer',
                appearance: 'none',
                WebkitAppearance: 'none',
                outline: 'none',
              }}
            >
              {sessions.map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {/* Brass chevron — replaces OS default arrow */}
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="var(--brass-light, var(--gold))" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round"
              aria-hidden="true"
              style={{
                position: 'absolute',
                right: 10,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        </div>
      )}

      {showPicker && <SectionDivider />}

      {/* Reference section — parity with public drawer (Thread 58).
          Links removed from Footer.js Row 2 for owner+client; drawer is
          now the canonical menu surface for registered/team viewers. */}
      <DrawerLink href="/disclaimers" onClose={() => {}}>Disclaimers</DrawerLink>
      <DrawerLink href="/about" onClose={() => {}}>About</DrawerLink>
      <DrawerLink href="/roadmap" onClose={() => {}}>Roadmap</DrawerLink>
      <DrawerLink href="/methodology" onClose={() => {}}>Methodology</DrawerLink>
      <DrawerLink href="/install" onClose={() => {}}>Install</DrawerLink>

      {/* Spacer pushes the Settings + Sign Out block to the drawer footer
          (LinkedIn-style; Thread 58.5 / 2026-05-01). */}
      <div style={{ flex: 1, minHeight: 12 }} aria-hidden="true" />

      <SectionDivider />

      {/* Settings — gear-icon row pinned to the drawer footer. Visually
          subdued vs the upper nav so it reads as utility, not a primary
          surface (LinkedIn pattern). */}
      <DrawerLink
        href="/settings"
        onClose={() => {}}
        leftSlot={<SettingsIcon size={14} aria-hidden="true" />}
      >
        Settings
      </DrawerLink>

      {/* Sign out — Rust functional color, destructive treatment per
          Brand Guide v1.2 §02 functional palette + Thread 35 cta pattern. */}
      <div style={{ padding: '8px 20px 16px' }}>
        <button
          type="button"
          onClick={onSignOut}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            padding: '10px 16px',
            background: 'transparent',
            border: '1px solid #c44730',
            borderRadius: 6,
            color: '#c44730',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          Sign Out
        </button>
      </div>
    </nav>
  )
}

/* ────────────────────────────────────────────────────────────────────
   Shared row primitives.
   ──────────────────────────────────────────────────────────────────── */
function DrawerLink({ href, children, onClose, rightSlot, leftSlot }) {
  return (
    <Link
      href={href}
      onClick={onClose}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        padding: '12px 20px',
        color: 'var(--text-primary, #e8e9ec)',
        fontSize: 14,
        fontWeight: 500,
        textDecoration: 'none',
        transition: 'background 0.12s, color 0.12s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'rgba(184,151,90,0.08)'
        e.currentTarget.style.color = 'var(--brass-light, var(--gold))'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
        e.currentTarget.style.color = 'var(--text-primary, #e8e9ec)'
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        {leftSlot}
        <span>{children}</span>
      </span>
      {rightSlot}
    </Link>
  )
}

function CountBadge({ value }) {
  return (
    <span
      aria-label={`${value} watched bills`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 20,
        padding: '0 7px',
        background: 'rgba(184,151,90,0.16)',
        border: '1px solid rgba(184,151,90,0.40)',
        borderRadius: 999,
        color: 'var(--brass-light, var(--gold))',
        fontSize: 11,
        fontWeight: 600,
        fontFamily: 'var(--font-mono, "DM Mono", monospace)',
        letterSpacing: '0.02em',
      }}
    >
      {value}
    </span>
  )
}

function SectionDivider() {
  return (
    <div
      role="separator"
      aria-hidden="true"
      style={{
        height: 1,
        margin: '8px 20px',
        background: 'var(--border, #2a2d38)',
      }}
    />
  )
}
