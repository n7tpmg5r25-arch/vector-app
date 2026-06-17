'use client'
import HamburgerButton from './HamburgerButton'

/**
 * TopHamburger — Thread 64 (2026-05-03)
 *
 * Lightweight client-component wrapper that renders ONLY the
 * fixed-position HamburgerButton in the top-left of the 480-px column.
 * Use this on surfaces that need drawer access but don't want the full
 * Nav component (with its bottom-tab bar).
 *
 * Where it's used: Admin pages (/admin/clients, /admin/clients/[id],
 * /admin/waitlist) — these are owner-only configuration surfaces, not
 * day-to-day surfaces, so the bottom-tab Nav adds chrome without value.
 * Without TopHamburger, admin pages have no path to the SideDrawer
 * (Settings, Reference links, Sign out).
 *
 * Why a separate component vs importing Nav: Nav is a client component
 * that calls usePathname() / useRouter() on every render to drive the
 * bottom-tab active-state. Admin pages don't render the bottom-tab bar,
 * so paying for those hooks is wasted work (and adds a re-render on
 * every route change that we don't want propagating to the admin
 * surfaces).
 *
 * Layer correctness: The hamburger is placed in fixed position at
 * `left: max(6px, calc(50% - 240px + 6px))` matching Nav.js exactly so
 * the trigger anchors identically across every viewer surface — drawer
 * placement should not move when the viewer transitions
 * Public ↔ Registered ↔ Admin.
 */
export default function TopHamburger() {
  return (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
        left: 'max(6px, calc(50% - 240px + 6px))',
        width: 40,
        zIndex: 90,
        pointerEvents: 'auto',
      }}
    >
      <HamburgerButton />
    </div>
  )
}
